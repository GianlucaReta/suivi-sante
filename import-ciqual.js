// ─────────────────────────────────────────────────────────────
// Conversion de la table Ciqual (ANSES) pour l'import dans Supabase
// À lancer une seule fois :  node import-ciqual.js "Table Ciqual.csv"
// Produit ciqual-import.csv, à importer dans la table aliments_ciqual
// depuis le dashboard Supabase (voir README, « Importer Ciqual »).
// Aucune clé ni accès réseau : le script ne fait que convertir un fichier.
// ─────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

const entree = process.argv[2]
const sortie = process.argv[3] || path.join(__dirname, 'ciqual-import.csv')
if (!entree) {
  console.error('Usage : node import-ciqual.js "<fichier Ciqual exporté en CSV>"')
  process.exit(1)
}

// ── Lecture et décodage (UTF-8, ou Windows-1252 pour les exports Excel) ─
const brut = fs.readFileSync(entree)
let texte = new TextDecoder('utf-8').decode(brut)
if (texte.includes('�')) texte = new TextDecoder('windows-1252').decode(brut)
texte = texte.replace(/^﻿/, '')

// ── Découpage CSV (guillemets, séparateur ; , ou tabulation) ─
const premiereLigne = texte.slice(0, texte.indexOf('\n'))
const separateur = [';', '\t', ','].sort((a, b) => premiereLigne.split(b).length - premiereLigne.split(a).length)[0]

function lireCsv(t, sep) {
  const lignes = []
  let ligne = [], champ = '', guillemets = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++ }
      else if (c === '"') guillemets = false
      else champ += c
    } else if (c === '"') guillemets = true
    else if (c === sep) { ligne.push(champ); champ = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      ligne.push(champ); champ = ''
      if (ligne.some(x => x.trim() !== '')) lignes.push(ligne)
      ligne = []
    } else champ += c
  }
  if (champ || ligne.length) { ligne.push(champ); if (ligne.some(x => x.trim() !== '')) lignes.push(ligne) }
  return lignes
}

const lignes = lireCsv(texte, separateur)
const entetes = lignes[0].map(h => h.trim())
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const entetesNorm = entetes.map(norm)

function colonne(nom, ...tests) {
  const i = entetesNorm.findIndex(h => tests.some(t => typeof t === 'string' ? h === t : t(h)))
  if (i === -1) console.warn(`⚠️  Colonne introuvable : ${nom}`)
  return i
}

const C = {
  code:     colonne('code', 'alim_code'),
  nom:      colonne('nom', 'alim_nom_fr'),
  groupe:   colonne('groupe', 'alim_grp_nom_fr'),
  sousGrp:  colonne('sous-groupe', 'alim_ssgrp_nom_fr'),
  ssSsGrp:  colonne('sous-sous-groupe', 'alim_ssssgrp_nom_fr'),
  kcal:     colonne('kcal', h => h.includes('energie') && h.includes('kcal') && h.includes('1169'), h => h.includes('energie') && h.includes('kcal')),
  proteines:colonne('protéines', h => h.startsWith('proteines, n x facteur de jones'), h => h.startsWith('proteines')),
  glucides: colonne('glucides', h => h.startsWith('glucides')),
  sucres:   colonne('sucres', h => h.startsWith('sucres (') || h === 'sucres (g/100g)'),
  lipides:  colonne('lipides', h => h.startsWith('lipides')),
  fibres:   colonne('fibres', h => h.startsWith('fibres alimentaires')),
  sel:      colonne('sel', h => h.startsWith('sel chlorure de sodium'), h => h.startsWith('sel')),
}
if (C.code === -1 || C.nom === -1 || C.kcal === -1) {
  console.error('\nFichier non reconnu. Vérifie que c\'est bien la table Ciqual (avec les colonnes alim_code, alim_nom_fr et Energie … kcal).')
  console.error('Colonnes trouvées :', entetes.slice(0, 12).join(' | '), '…')
  process.exit(1)
}

// ── Valeurs : virgule décimale, « - », « traces », « < 0,5 » ─
function nombre(v) {
  if (v === undefined) return null
  const s = String(v).trim().toLowerCase().replace(',', '.')
  if (!s || s === '-' || s === 'nd' || s === 'n.d.') return null
  if (s.startsWith('traces')) return 0
  const m = s.match(/^<\s*([\d.]+)/)
  if (m) return Math.round(parseFloat(m[1]) / 2 * 1000) / 1000 // « < 0,5 » → 0,25
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// ── Classement : catégorie (repères visuels), rayon, sucres ajoutés ─
// Le sous-groupe est prioritaire : les noms de groupes Ciqual mélangent plusieurs familles
// (ex. « fruits, légumes, légumineuses et oléagineux », « viandes, œufs, poissons »).
function classer(groupe, sousGrp, ssSsGrp, nom) {
  const sous = `${norm(sousGrp)} | ${norm(ssSsGrp)}`
  const r = classerTexte(sous, nom)
  if (r.trouve) return r
  return classerTexte(norm(groupe), nom)
}

function classerTexte(tout, nom) {
  const n = norm(nom)
  const a = (...mots) => mots.some(m => tout.includes(m))
  const trouve = a('fruits a coque', 'oleagineu', 'matieres grasses', 'huiles', 'beurre', 'margarine', 'viande', 'poisson', 'oeuf',
    'charcuterie', 'mollusque', 'crustace', 'produits de la mer', 'volaille', 'gibier', 'abats', 'lait', 'fromage', 'yaourt',
    'laitier', 'creme', 'produits sucres', 'chocolat', 'confiserie', 'biscuit', 'gateau', 'patisserie', 'viennoiserie', 'glace',
    'sorbet', 'confiture', 'sucres, miels', 'dessert', 'boisson', 'eaux', 'pommes de terre', 'tubercule', 'pates, riz', 'pain',
    'cereales', 'legumineuse', 'farine', 'legume', 'fruit', 'plats composes', 'sandwich', 'pizza', 'condiment', 'sauce',
    'epice', 'herbe', 'sel')

  let categorie = 'autre'
  if (a('fruits a coque', 'oleagineu') || a('matieres grasses', 'huiles', 'beurre', 'margarine')) categorie = 'matiere_grasse'
  else if (a('viande', 'poisson', 'oeuf', 'charcuterie', 'mollusque', 'crustace', 'produits de la mer', 'volaille', 'gibier', 'abats')) categorie = 'viande_poisson'
  else if (a('lait', 'fromage', 'yaourt', 'laitier', 'creme')) categorie = 'laitier'
  else if (a('produits sucres', 'chocolat', 'confiserie', 'biscuit', 'gateau', 'patisserie', 'viennoiserie', 'glace', 'sorbet', 'confiture', 'sucres, miels', 'dessert')) categorie = 'sucre'
  else if (a('boisson', 'eaux')) categorie = 'boisson'
  else if (a('pommes de terre', 'tubercule', 'pates, riz', 'pain', 'cereales', 'legumineuse', 'farine')) categorie = 'feculent'
  else if (a('legume')) categorie = 'legume'
  else if (a('fruit')) categorie = 'fruit'

  let rayon = 'Épicerie salée'
  if (a('charcuterie')) rayon = 'Charcuterie'
  else if (a('poisson', 'mollusque', 'crustace', 'produits de la mer')) rayon = 'Poissonnerie'
  else if (a('viande', 'volaille', 'gibier', 'abats')) rayon = 'Boucherie'
  else if (a('oeuf', 'lait', 'fromage', 'yaourt', 'laitier', 'creme', 'beurre')) rayon = 'Crèmerie'
  else if (a('glace', 'sorbet')) rayon = 'Surgelés'
  else if (categorie === 'sucre' || a('cereales de petit-dejeuner')) rayon = 'Épicerie sucrée'
  else if (a('pain', 'viennoiserie')) rayon = 'Boulangerie'
  else if (a('boisson', 'eaux')) rayon = 'Boissons'
  else if (a('entrees et plats composes', 'plats composes', 'sandwich', 'pizza')) rayon = 'Traiteur'
  else if ((categorie === 'legume' || categorie === 'fruit' || a('pommes de terre')) && !/conserve|appertise|surgele|sec(he)?s?\b|seche/.test(n)) rayon = 'Fruits et légumes'
  else if (/surgele/.test(n)) rayon = 'Surgelés'

  // Sucres comptés comme « ajoutés » : produits sucrés, desserts, boissons sucrées, céréales du petit déjeuner
  const sucreAjoute = categorie === 'sucre'
    || a('cereales de petit-dejeuner', 'desserts')
    || (categorie === 'boisson' && /soda|limonade|sirop|boisson .*sucr|nectar|cola|the glace|boisson aux fruits/.test(n))
    || (categorie === 'laitier' && /sucre|aromatise|aux fruits|chocolat|vanille|creme dessert|flan|liegeois/.test(n) && !/non sucre|sans sucre/.test(n))

  return { categorie, rayon, sucreAjoute, trouve }
}

// ── Conversion ───────────────────────────────────────────────
const colonnesSortie = ['code', 'nom', 'nom_recherche', 'groupe', 'sous_groupe', 'rayon', 'categorie', 'sucre_ajoute', 'kcal', 'proteines', 'glucides', 'sucres', 'lipides', 'fibres', 'sel']
const csv = v => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const vus = new Set()
let sansKcal = 0
const sorties = []
const parCategorie = {}
for (const l of lignes.slice(1)) {
  const code = String(l[C.code] || '').trim()
  const nom = String(l[C.nom] || '').trim()
  if (!code || !nom || vus.has(code)) continue
  vus.add(code)
  const groupe = l[C.groupe]?.trim() || null
  const sousGrp = l[C.sousGrp]?.trim() || null
  const ssSsGrp = C.ssSsGrp >= 0 ? l[C.ssSsGrp]?.trim() : ''
  const { categorie, rayon, sucreAjoute } = classer(groupe, sousGrp, ssSsGrp, nom)
  const kcal = nombre(l[C.kcal])
  if (kcal === null) sansKcal++
  parCategorie[categorie] = (parCategorie[categorie] || 0) + 1
  sorties.push([
    code, nom, norm(nom), groupe, sousGrp, rayon, categorie, sucreAjoute,
    kcal, nombre(l[C.proteines]), nombre(l[C.glucides]), nombre(l[C.sucres]),
    nombre(l[C.lipides]), nombre(l[C.fibres]), C.sel >= 0 ? nombre(l[C.sel]) : null,
  ].map(csv).join(','))
}

fs.writeFileSync(sortie, colonnesSortie.join(',') + '\n' + sorties.join('\n') + '\n', 'utf8')

console.log(`✓ ${sorties.length} aliments convertis (séparateur « ${separateur === '\t' ? 'tabulation' : separateur} »)`)
console.log(`  ${sansKcal} sans valeur énergétique (resteront masqués dans la recherche)`)
console.log('  Par catégorie :', Object.entries(parCategorie).map(([k, v]) => `${k} ${v}`).join(', '))
console.log(`→ Fichier à importer : ${sortie}`)
