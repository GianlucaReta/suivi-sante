// ─────────────────────────────────────────────────────────────
// Import des recettes : relie chaque ingrédient de recettes.json à un code Ciqual
// et génère recettes-import.sql, à exécuter dans le SQL Editor de Supabase.
//
// À lancer après l'import de Ciqual :
//   node import-recettes.js ciqual-import.csv
// (ciqual-import.csv = le fichier produit par import-ciqual.js)
//
// Les valeurs nutritionnelles ne sont jamais écrites ici : seul le code Ciqual est
// enregistré, et le site calcule tout depuis la table aliments_ciqual.
// ─────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

const fichierCiqual = process.argv[2]
if (!fichierCiqual) {
  console.error('Usage : node import-recettes.js ciqual-import.csv')
  process.exit(1)
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/\s+/g, ' ').trim()

// ── Lecture du CSV Ciqual converti (séparateur virgule, guillemets) ─
function lireCsv(t) {
  const lignes = []
  let ligne = [], champ = '', g = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (g) { if (c === '"' && t[i + 1] === '"') { champ += '"'; i++ } else if (c === '"') g = false; else champ += c }
    else if (c === '"') g = true
    else if (c === ',') { ligne.push(champ); champ = '' }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = '' }
    else if (c !== '\r') champ += c
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne) }
  return lignes
}
const csv = lireCsv(fs.readFileSync(fichierCiqual, 'utf8').replace(/^﻿/, ''))
const tete = csv[0]
const iCode = tete.indexOf('code'), iNom = tete.indexOf('nom')
if (iCode < 0 || iNom < 0) { console.error('Ce fichier n\'est pas ciqual-import.csv (colonnes code et nom attendues).'); process.exit(1) }
const aliments = csv.slice(1).filter(l => l[iCode]).map(l => ({ code: l[iCode], nom: l[iNom], n: norm(l[iNom]) }))
const parNom = new Map(aliments.map(a => [a.n, a]))

// ── Recherche du code : nom exact, sinon le plus proche (signalé pour vérification) ─
const singulier = m => m.length > 4 ? m.replace(/(s|x)$/, '') : m
const mots = s => norm(s).replace(/[^a-z0-9% ]/g, ' ').split(' ').filter(m => m.length >= 3).map(singulier)
const premierSegment = s => mots(norm(s).split(',')[0])
const etat = s => /\bcuit|\bcuite|\bbouilli|\bgrill|\brot[iie]|\bfrit|\bvapeur/.test(norm(s)) ? 'cuit'
  : /\bcrue?s?\b|\bsec(he)?s?\b|\bseche/.test(norm(s)) ? 'cru' : null

// Règles strictes pour une correspondance approchée (une erreur fausserait les calories) :
// - tous les mots de l'aliment principal (avant la 1re virgule) doivent être dans celui du candidat
//   (« pomme de terre » ≠ « pomme ») ;
// - l'état doit être le même (le riz cru est 2,7 fois plus calorique que le riz cuit).
function trouver(nom) {
  const exact = parNom.get(norm(nom))
  if (exact) return { aliment: exact, exact: true }
  const m = mots(nom)
  const tete = premierSegment(nom)
  const etatVoulu = etat(nom)
  let meilleur = null, score = 0, proche = null, scoreProche = 0
  for (const a of aliments) {
    const ma = mots(a.nom)
    const communs = m.filter(x => ma.includes(x)).length
    if (!communs) continue
    const s = communs / Math.max(m.length, ma.length)
    if (s > scoreProche) { scoreProche = s; proche = a }
    const teteA = premierSegment(a.nom)
    if (!tete.every(x => teteA.includes(x))) continue
    const etatA = etat(a.nom)
    if (etatVoulu && etatA && etatVoulu !== etatA) continue
    if (s > score) { score = s; meilleur = a }
  }
  return score >= 0.5 ? { aliment: meilleur, exact: false, score } : { aliment: null, proche }
}

// ── Conversion ───────────────────────────────────────────────
const { recettes } = JSON.parse(fs.readFileSync(path.join(__dirname, 'recettes.json'), 'utf8'))
const TYPES = ['petit_dejeuner', 'dejeuner', 'diner', 'collation']
const q = s => `'${String(s).replace(/'/g, "''")}'`
const tab = a => `ARRAY[${(a || []).map(q).join(',')}]::text[]`
const tabInt = a => `ARRAY[${(a || []).map(Number).join(',')}]::integer[]`

const rapport = { approches: [], introuvables: [], erreurs: [] }
let nbIngredients = 0, nbCompletes = 0
const sql = [
  '-- Généré par import-recettes.js : ne pas modifier à la main (modifier recettes.json puis relancer).',
  'BEGIN;',
]
const ids = new Set()

for (const r of recettes) {
  if (ids.has(r.id)) { rapport.erreurs.push(`${r.id} : identifiant en double`); continue }
  ids.add(r.id)
  if (!r.types?.length || r.types.some(t => !TYPES.includes(t))) rapport.erreurs.push(`${r.id} : type de repas invalide`)
  if (!(r.temps > 0)) rapport.erreurs.push(`${r.id} : temps manquant`)

  let complete = true
  const lignes = []
  r.ingredients.forEach((ing, ordre) => {
    nbIngredients++
    const res = trouver(ing.ciqual)
    if (!res.aliment) {
      complete = complete && !!ing.optionnel
      rapport.introuvables.push(`${r.id} › ${ing.libelle} : « ${ing.ciqual} » introuvable${res.proche ? ` (le plus proche : « ${res.proche.nom} »)` : ''}`)
    } else if (!res.exact) {
      rapport.approches.push(`${r.id} › ${ing.libelle} : « ${ing.ciqual} » → « ${res.aliment.nom} » (${res.aliment.code})`)
    }
    const substituts = (ing.substituts || []).map(s => {
      const rs = trouver(s.ciqual)
      if (!rs.aliment) rapport.introuvables.push(`${r.id} › substitut ${s.libelle} : « ${s.ciqual} » introuvable`)
      else if (!rs.exact) rapport.approches.push(`${r.id} › substitut ${s.libelle} : « ${s.ciqual} » → « ${rs.aliment.nom} »`)
      return { libelle: s.libelle, ciqual_code: rs.aliment?.code || null, exclusions: s.exclusions || [] }
    })
    lignes.push(`(${q(r.id)}, ${ordre}, ${q(ing.libelle)}, ${res.aliment ? q(res.aliment.code) : 'NULL'}, ${Number(ing.g)}, ${tab(ing.exclusions)}, ${ing.optionnel ? 'true' : 'false'}, ${q(JSON.stringify(substituts))}::jsonb)`)
  })
  if (complete) nbCompletes++

  sql.push(
    `INSERT INTO public.recettes (id, nom, types_repas, temps_min, portions_base, etiquettes, mois, etapes, actif) VALUES (` +
    `${q(r.id)}, ${q(r.nom)}, ${tab(r.types)}, ${Number(r.temps)}, ${Number(r.portions || 2)}, ${tab(r.etiquettes)}, ${tabInt(r.mois)}, ${tab(r.etapes)}, true) ` +
    `ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, types_repas = EXCLUDED.types_repas, temps_min = EXCLUDED.temps_min, ` +
    `portions_base = EXCLUDED.portions_base, etiquettes = EXCLUDED.etiquettes, mois = EXCLUDED.mois, etapes = EXCLUDED.etapes, actif = true;`,
    `DELETE FROM public.recette_ingredients WHERE recette_id = ${q(r.id)};`,
    `INSERT INTO public.recette_ingredients (recette_id, ordre, libelle, ciqual_code, grammes, exclusions, optionnel, substituts) VALUES\n  ${lignes.join(',\n  ')};`,
  )
}
// Recettes retirées de recettes.json : désactivées (pas supprimées, pour garder l'historique des menus)
sql.push(`UPDATE public.recettes SET actif = false WHERE id NOT IN (${[...ids].map(q).join(',')});`, 'COMMIT;')

fs.writeFileSync(path.join(__dirname, 'recettes-import.sql'), sql.join('\n') + '\n', 'utf8')
const txt = [
  `${recettes.length} recettes, ${nbIngredients} ingrédients, ${nbCompletes} recettes complètes (proposables).`,
  '', `À VÉRIFIER : correspondances approchées (${rapport.approches.length})`, ...rapport.approches,
  '', `INTROUVABLES (${rapport.introuvables.length}) : corriger le nom « ciqual » dans recettes.json`, ...rapport.introuvables,
  '', `ERREURS (${rapport.erreurs.length})`, ...rapport.erreurs,
].join('\n')
fs.writeFileSync(path.join(__dirname, 'recettes-rapport.txt'), txt + '\n', 'utf8')
console.log(txt.split('\n').slice(0, 1).join('\n'))
console.log(`  ${rapport.approches.length} correspondance(s) approchée(s), ${rapport.introuvables.length} introuvable(s), ${rapport.erreurs.length} erreur(s)`)
console.log('→ Détail : recettes-rapport.txt · SQL à exécuter : recettes-import.sql')
