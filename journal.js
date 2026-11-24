// ─────────────────────────────────────────────────────────────
// Journal alimentaire : recherche Ciqual, scan Open Food Facts,
// quantités (grammes ou repères visuels), totaux du jour, photos
// Dépend de : app.js, calculs.js, profil.js
// ─────────────────────────────────────────────────────────────

const TYPES_REPAS = [
  ['petit_dejeuner', 'Petit déjeuner'],
  ['dejeuner', 'Déjeuner'],
  ['diner', 'Dîner'],
  ['collation', 'Collation'],
]
const libelleRepas = t => (TYPES_REPAS.find(([k]) => k === t) || [, t])[1]
const auRepas = t => t === 'collation' ? 'à la collation' : `au ${libelleRepas(t).toLowerCase()}`

const LIGNES_NUTRIMENTS = [
  ['kcal', 'Calories', 'kcal'],
  ['proteines', 'Protéines', 'g'],
  ['glucides', 'Glucides', 'g'],
  ['sucres', 'dont sucres', 'g'],
  ['lipides', 'Lipides', 'g'],
  ['fibres', 'Fibres', 'g'],
]

let journalDate = dateISO()
let entreesJour = []
let photosJour = []
let entreesVeille = []     // repas de la veille (bouton « Comme hier »)
let _repasFavoris = null   // repas favoris (null = pas encore chargés)
let saisie = null          // aliment en cours d'ajout ou de modification
let _resultats = []        // résultats de recherche affichés
let _rechercheTimer = null
let _scanner = null

function heureActuelle() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function decalerDate(iso, jours) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + jours)
  return dateISO(d)
}

function libelleDate(iso) {
  const auj = dateISO()
  if (iso === auj) return "Aujourd'hui"
  if (iso === decalerDate(auj, -1)) return 'Hier'
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ═════════════════════════════════════════════════════════════
// PAGE REPAS
// ═════════════════════════════════════════════════════════════
async function chargerJournal() {
  const [rJ, rP, rV] = await Promise.all([
    db.from('journal').select('*').eq('date', journalDate).order('heure').order('created_at'),
    db.from('photos_repas').select('*').eq('date', journalDate).order('created_at'),
    db.from('journal').select('*').eq('date', decalerDate(journalDate, -1)).order('heure'),
  ])
  entreesVeille = rV.data || []
  if (rJ.error) { gererErreur(rJ.error, 'Impossible de charger le journal.'); return }
  if (rP.error) console.error(rP.error)
  entreesJour = rJ.data || []
  photosJour = rP.data || []
  afficherJournal()
  chargerMiniatures()
}

function changerJourJournal(delta) {
  const nouvelle = decalerDate(journalDate, delta)
  if (nouvelle > dateISO()) return
  journalDate = nouvelle
  chargerJournal()
}

function totauxEntrees(entrees) {
  const t = { kcal: 0, proteines: 0, glucides: 0, sucres: 0, sucres_ajoutes: 0, lipides: 0, fibres: 0 }
  for (const e of entrees) for (const k in t) t[k] += Number(e[k]) || 0
  return t
}

function objectifsDuJour() {
  const cible = cibleKcalDuJour()
  if (!cible) return null
  return objectifsNutriments(cible, profil.cible_proteines || calculerProteines(poidsActuel()).cible)
}

function afficherJournal() {
  const el = document.getElementById('journal-contenu')
  const t = totauxEntrees(entreesJour)
  const obj = objectifsDuJour()
  const estAujourdhui = journalDate === dateISO()

  el.innerHTML = `
    <div class="nav-jour">
      <button class="btn btn-secondaire" onclick="changerJourJournal(-1)" aria-label="Jour précédent">‹</button>
      <span class="nav-jour-libelle">${libelleDate(journalDate)}</span>
      <button class="btn btn-secondaire" onclick="changerJourJournal(1)" ${estAujourdhui ? 'disabled' : ''} aria-label="Jour suivant">›</button>
    </div>

    <div class="carte">
      <div class="carte-titre">Total du jour</div>
      ${renduTotaux(t, obj)}
    </div>

    ${TYPES_REPAS.map(([type, libelle]) => renduRepas(type, libelle)).join('')}

    <p class="message-info" style="text-align:center;">Chaque repas est facultatif : note seulement ce que tu manges, quand tu le manges.</p>`
}

// Mêmes couleurs que les anneaux de la page Aujourd'hui
const COULEURS_BARRES = { kcal: 'var(--lavande)', proteines: 'var(--rose)', sucres: 'var(--jaune)' }

function renduTotaux(t, obj) {
  return LIGNES_NUTRIMENTS.map(([k, lib, unite]) => {
    const val = t[k]
    const cible = obj?.[k]
    const pct = cible ? Math.min(100, (val / cible) * 100) : 0
    const repere = k === 'sucres' ? 'repère max' : 'objectif'
    const depasse = cible && val > cible * (k === 'proteines' || k === 'fibres' ? 10 : 1.1)
    return `
      <div class="total-ligne">
        <div class="total-tete">
          <span class="${k === 'sucres' ? 'total-sous' : ''}">${lib}</span>
          <span class="total-valeur"><strong>${formatNombre(val, k === 'kcal' ? 0 : 0)}</strong>${cible ? ` / ${formatNombre(cible)} ${unite}` : ` ${unite}`}</span>
        </div>
        ${cible ? `<div class="barre" title="${repere}"><div class="barre-remplie ${depasse ? 'barre-haute' : ''} ${(k === 'proteines' && val >= cible) ? 'barre-atteinte' : ''}" style="width:${pct}%;${!depasse && COULEURS_BARRES[k] ? `background:${COULEURS_BARRES[k]};` : ''}"></div></div>` : ''}
      </div>`
  }).join('') + (t.sucres_ajoutes > 0 ? `<p class="message-info">Dont environ ${formatNombre(t.sucres_ajoutes)} g de sucres ajoutés.</p>` : '')
}

function renduRepas(type, libelle) {
  const entrees = entreesJour.filter(e => e.type_repas === type)
  const photos = photosJour.filter(p => p.type_repas === type)
  const kcal = entrees.reduce((s, e) => s + Number(e.kcal), 0)
  return `
    <div class="carte repas">
      <div class="repas-tete">
        <span class="carte-titre" style="margin:0;">${libelle}</span>
        ${entrees.length ? `<span class="repas-kcal">${formatNombre(kcal)} kcal</span>` : ''}
        <label class="btn btn-secondaire btn-icone" title="Ajouter une photo" aria-label="Ajouter une photo ${auRepas(type)}">
          ${icone('appareil')}<input type="file" accept="image/*" class="hidden" onchange="ajouterPhoto('${type}', this)" />
        </label>
        <button class="btn btn-secondaire btn-icone" onclick="ouvrirAjoutAliment('${type}')" aria-label="Ajouter ${auRepas(type)}">+</button>
      </div>
      ${entrees.map(e => `
        <button class="entree" onclick="ouvrirEntree('${e.id}')">
          <span class="entree-nom">${esc(e.nom)}</span>
          <span class="entree-detail">${esc(e.repere || formatNombre(e.quantite_g) + ' g')} · ${e.heure.slice(0, 5)}</span>
          <span class="entree-kcal">${formatNombre(e.kcal)} kcal</span>
        </button>`).join('')}
      ${photos.length ? `<div class="miniatures">${photos.map(p => `
        <button class="miniature" onclick="ouvrirPhoto('${p.id}')" aria-label="Voir la photo"><img data-chemin="${esc(p.chemin)}" alt="" /></button>`).join('')}</div>` : ''}
      ${renduActionsRepas(type, entrees)}
    </div>`
}

// ═════════════════════════════════════════════════════════════
// AJOUT D'UN ALIMENT : RECHERCHE
// ═════════════════════════════════════════════════════════════
function ouvrirAjoutAliment(type) {
  saisie = { type, heure: journalDate === dateISO() ? heureActuelle() : '12:00', entreeId: null, aliment: null }
  afficherRecherche()
}

function afficherRecherche() {
  ouvrirFeuille(`Ajouter · ${libelleRepas(saisie.type)}`, `
    <div class="recherche-barre">
      <input id="recherche-aliment" class="input" type="search" placeholder="Rechercher un aliment…" autocomplete="off"
        oninput="lancerRechercheAliment(this.value)" />
      <button class="btn btn-secondaire" onclick="ouvrirScanner()" title="Scanner un code-barres" aria-label="Scanner un code-barres">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>
      </button>
    </div>
    <div id="repas-favoris-liste"></div>
    <div id="resultats-aliments" class="resultats"></div>
    <button class="btn btn-lien btn-bloc" onclick="afficherSaisieLibre()">Je ne trouve pas : saisie libre</button>`)
  setTimeout(() => document.getElementById('recherche-aliment')?.focus(), 50)
  afficherRecents()
  afficherRepasFavorisDansRecherche()
}

async function afficherRecents() {
  const { data, error } = await db.from('journal').select('source, ref, nom').neq('source', 'libre')
    .order('created_at', { ascending: false }).limit(100)
  if (error) { console.error(error); return }
  const vus = new Set()
  _resultats = []
  for (const r of data || []) {
    const cle = r.source + ':' + r.ref
    if (vus.has(cle) || !r.ref) continue
    vus.add(cle)
    _resultats.push({ source: r.source, ref: r.ref, nom: r.nom })
    if (_resultats.length >= 12) break
  }
  const el = document.getElementById('resultats-aliments')
  if (!el || document.getElementById('recherche-aliment')?.value) return
  el.innerHTML = _resultats.length
    ? `<div class="resultats-titre">Récemment</div>` + renduResultats()
    : `<p class="message-info">Tape le nom d'un aliment (par exemple « pomme », « riz cuit », « poulet »), ou scanne un produit.</p>`
}

function lancerRechercheAliment(v) {
  clearTimeout(_rechercheTimer)
  document.getElementById('repas-favoris-liste')?.classList.toggle('hidden', !!v.trim())
  if (!v.trim()) { afficherRecents(); return }
  _rechercheTimer = setTimeout(() => rechercherAliments(v), 250)
}

// Mots de recherche nettoyés (lettres, chiffres, espaces)
function motsRecherche(q) {
  return sansAccents(q).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(m => m.length >= 2).slice(0, 5)
}

async function rechercherAliments(q) {
  const mots = motsRecherche(q)
  const el = document.getElementById('resultats-aliments')
  if (!el) return
  if (!mots.length) { el.innerHTML = ''; return }
  el.innerHTML = '<div class="spinner" style="margin:var(--sp-4) auto;"></div>'

  let reqCiqual = db.from('aliments_ciqual')
    .select('code, nom, categorie, sucre_ajoute, kcal, proteines, glucides, sucres, lipides, fibres')
    .not('kcal', 'is', null).limit(80)
  for (const m of mots) reqCiqual = reqCiqual.ilike('nom_recherche', `%${m}%`)
  const [rC, produitsTrouves] = await Promise.all([reqCiqual, rechercherProduits(mots)])
  if (document.getElementById('recherche-aliment')?.value.trim() !== q.trim()) return // saisie modifiée entre-temps
  if (rC.error) { gererErreur(rC.error, 'La recherche a échoué.'); el.innerHTML = ''; return }

  // Classement : le nom commence par le premier mot, puis les noms les plus courts
  const premier = mots[0]
  const ciqual = (rC.data || []).sort((a, b) => {
    const sa = sansAccents(a.nom).startsWith(premier) ? 0 : 1
    const sb = sansAccents(b.nom).startsWith(premier) ? 0 : 1
    return sa - sb || a.nom.length - b.nom.length
  }).slice(0, 40)

  _resultats = [
    ...produitsTrouves.map(alimentDepuisProduit),
    ...ciqual.map(alimentDepuisCiqual),
  ]
  el.innerHTML = _resultats.length ? renduResultats()
    : `<p class="message-info">Aucun résultat. Essaie un mot plus simple (« yaourt » plutôt que « yaourt grec 0 % »), scanne le produit ou utilise la saisie libre.</p>`
}

// Produits scannés : tous les mots cherchés dans « nom + marque » sans accents (sql/11).
// Classement : nombre de mots trouvés, puis le plus récemment utilisé.
async function rechercherProduits(mots) {
  const utiles = mots.filter(m => m.length >= 3)
  if (!utiles.length) return []
  const { data, error } = await db.from('produits').select('*')
    .or(utiles.map(m => `recherche.ilike.%${m}%`).join(',')).order('derniere_utilisation', { ascending: false }).limit(30)
  if (error) {
    // Ancienne base (sql/11 pas encore lancé) : recherche simple sur le nom
    const m = utiles.reduce((a, b) => (b.length > a.length ? b : a))
    const r = await db.from('produits').select('*').or(`nom.ilike.%${m}%,marque.ilike.%${m}%`).limit(10)
    return r.data || []
  }
  const score = p => utiles.filter(m => (p.recherche || '').includes(m)).length
  return (data || []).sort((a, b) => score(b) - score(a)).slice(0, 8)
}

// Mémorise l'utilisation d'un produit scanné (il reste en tête et n'est pas effacé)
function noterUtilisationProduit(id) {
  if (!id) return
  db.from('produits').update({ derniere_utilisation: new Date().toISOString() }).eq('id', id).then(({ error }) => { if (error) console.warn(error) })
}

// Produits scannés non utilisés depuis 30 jours : supprimés (une fois par jour, à l'ouverture)
const JOURS_CONSERVATION_PRODUITS = 30
async function nettoyerProduitsAnciens() {
  try { if (localStorage.getItem('ss_nettoyage_produits') === dateISO()) return } catch (e) {}
  const limite = new Date(Date.now() - JOURS_CONSERVATION_PRODUITS * 86400000).toISOString()
  const { error } = await db.from('produits').delete().lt('derniere_utilisation', limite)
  if (error) { console.warn(error); return }
  try { localStorage.setItem('ss_nettoyage_produits', dateISO()) } catch (e) {}
}

function renduResultats() {
  return _resultats.map((r, i) => `
    <button class="resultat ${r.source === 'produit' ? 'resultat-scanne' : ''}" onclick="choisirResultat(${i})">
      <span class="resultat-nom">${r.source === 'produit' ? `<span class="pastille-scan" title="Produit scanné">${icone('scanner')}</span>` : ''}${esc(r.nom)}${r.marque ? ` <span class="resultat-marque">${esc(r.marque)}</span>` : ''}</span>
      <span class="resultat-detail">${r.pour100 ? `${formatNombre(r.pour100.kcal)} kcal / 100 g` : ''}${r.source === 'produit' ? ' · déjà scanné' : ''}</span>
    </button>`).join('')
}

function alimentDepuisCiqual(c) {
  return {
    source: 'ciqual', ref: c.code, nom: c.nom, categorie: c.categorie || 'autre',
    pour100: { kcal: c.kcal, proteines: c.proteines, glucides: c.glucides, sucres: c.sucres, lipides: c.lipides, fibres: c.fibres, sucre_ajoute: c.sucre_ajoute },
  }
}

function alimentDepuisProduit(p) {
  return {
    source: 'produit', ref: p.id, nom: p.nom, marque: p.marque, categorie: p.categorie || 'autre', produit: p,
    portion_g: p.portion_g ? Number(p.portion_g) : null, portion_libelle: p.portion_libelle,
    pour100: { kcal: p.kcal, proteines: p.proteines, glucides: p.glucides, sucres: p.sucres, lipides: p.lipides, fibres: p.fibres, sucre_ajoute: p.sucre_ajoute },
  }
}

// Recharge les valeurs exactes d'un aliment (récents, modification)
async function chargerAliment(source, ref) {
  if (source === 'ciqual') {
    const { data, error } = await db.from('aliments_ciqual').select('code, nom, categorie, sucre_ajoute, kcal, proteines, glucides, sucres, lipides, fibres').eq('code', ref).maybeSingle()
    if (error) { gererErreur(error); return null }
    return data ? alimentDepuisCiqual(data) : null
  }
  if (source === 'produit') {
    const { data, error } = await db.from('produits').select('*').eq('id', ref).maybeSingle()
    if (error) { gererErreur(error); return null }
    return data ? alimentDepuisProduit(data) : null
  }
  return null
}

async function choisirResultat(i) {
  let a = _resultats[i]
  if (!a) return
  if (!a.pour100) {
    a = await chargerAliment(a.source, a.ref)
    if (!a) { afficherToast("Cet aliment n'existe plus dans la base.", true); return }
  }
  saisie.aliment = a
  if (a.source === 'produit') noterUtilisationProduit(a.ref)
  saisie.quantite = a.portion_g || 100
  saisie.repere = a.portion_g ? { cle: 'portion', nombre: 1 } : null
  afficherQuantite()
}

// ═════════════════════════════════════════════════════════════
// QUANTITÉ (grammes ou repères visuels)
// ═════════════════════════════════════════════════════════════
function afficherQuantite() {
  const a = saisie.aliment
  const modif = !!saisie.entreeId
  const reperes = [
    ...(a.portion_g ? [['portion', a.portion_libelle || 'Portion', a.portion_g]] : []),
    ...Object.entries(REPERES_VISUELS).map(([cle, r]) => [cle, r.libelle, grammesRepere(cle, a.categorie)]),
  ]
  ouvrirFeuille(modif ? 'Modifier' : `Ajouter · ${libelleRepas(saisie.type)}`, `
    <div class="aliment-tete">
      <div class="aliment-nom">${esc(a.nom)}${a.marque ? ` <span class="resultat-marque">${esc(a.marque)}</span>` : ''}</div>
      <div class="message-info" style="margin:0;">${formatNombre(a.pour100.kcal)} kcal · ${formatNombre(a.pour100.proteines, 1)} g de protéines pour 100 g</div>
      ${a.source === 'produit' ? `<button class="btn btn-lien" style="padding-left:0;" onclick="ouvrirProduitManuel(saisie.aliment.produit.code_barres, saisie.aliment.produit, true)">Corriger les valeurs du produit</button>` : ''}
    </div>

    <div class="champ">
      <span class="champ-label">Quantité</span>
      <div class="puces" style="padding-bottom:var(--sp-3);">
        ${reperes.map(([cle, lib, g]) => `<button type="button" class="puce puce-choix ${saisie.repere?.cle === cle ? 'active' : ''}" onclick="choisirRepere('${cle}')">${esc(lib)} <span class="puce-g">≈ ${formatNombre(g)} g</span></button>`).join('')}
      </div>
      ${saisie.repere ? `
        <div class="compteur" style="margin-bottom:var(--sp-3);">
          <button type="button" class="btn btn-secondaire" onclick="changerNombreRepere(-0.5)" aria-label="Moins">−</button>
          <span class="compteur-valeur">${formatNombre(saisie.repere.nombre, saisie.repere.nombre % 1 ? 1 : 0)} × ${esc(libelleRepereSaisie())}</span>
          <button type="button" class="btn btn-secondaire" onclick="changerNombreRepere(0.5)" aria-label="Plus">+</button>
        </div>` : ''}
      <div class="input-unite">
        <input id="saisie-grammes" class="input" type="text" inputmode="decimal" value="${formatNombreBrut(saisie.quantite)}" oninput="saisirGrammes(this.value)" />
        <span>g</span>
      </div>
      ${saisie.repere && saisie.repere.cle !== 'portion' ? `<p class="message-info">${esc(REPERES_VISUELS[saisie.repere.cle].aide)}. Estimation : ajuste les grammes si tu as une balance.</p>` : ''}
    </div>

    <div id="saisie-valeurs" class="valeurs">${renduValeursSaisie()}</div>

    <div class="grille-2">
      <label class="champ"><span class="champ-label">Repas</span>
        <select id="saisie-type" class="input" onchange="saisie.type = this.value">
          ${TYPES_REPAS.map(([k, l]) => `<option value="${k}" ${saisie.type === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="champ"><span class="champ-label">Heure</span>
        <input id="saisie-heure" class="input" type="time" value="${saisie.heure}" onchange="saisie.heure = this.value" /></label>
    </div>

    <div class="feuille-actions">
      ${modif ? `<button class="btn btn-danger" onclick="supprimerEntree()">Supprimer</button>` : `<button class="btn btn-secondaire" onclick="afficherRecherche()">Retour</button>`}
      <button id="btn-valider-saisie" class="btn btn-primaire" onclick="validerSaisie()">${modif ? 'Enregistrer' : 'Ajouter'}</button>
    </div>`)
}

function formatNombreBrut(n) { return n == null ? '' : String(Math.round(n * 10) / 10).replace('.', ',') }

function libelleRepereSaisie() {
  const r = saisie.repere
  if (r.cle === 'portion') return saisie.aliment.portion_libelle || 'portion'
  return REPERES_VISUELS[r.cle].libelle.toLowerCase()
}

function grammesRepereSaisie() {
  const r = saisie.repere
  if (r.cle === 'portion') return saisie.aliment.portion_g * r.nombre
  return grammesRepere(r.cle, saisie.aliment.categorie, r.nombre)
}

function choisirRepere(cle) {
  saisie.repere = saisie.repere?.cle === cle ? null : { cle, nombre: 1 }
  if (saisie.repere) saisie.quantite = grammesRepereSaisie()
  afficherQuantite()
}

function changerNombreRepere(delta) {
  saisie.repere.nombre = Math.max(0.5, Math.min(20, saisie.repere.nombre + delta))
  saisie.quantite = grammesRepereSaisie()
  afficherQuantite()
}

// Saisie directe en grammes : le repère visuel ne s'applique plus
function saisirGrammes(v) {
  const n = Number(String(v).replace(',', '.'))
  saisie.quantite = isNaN(n) ? 0 : n
  if (saisie.repere) {
    saisie.repere = null
    document.querySelectorAll('.puce-choix').forEach(p => p.classList.remove('active'))
    document.querySelector('.feuille .compteur')?.remove()
  }
  document.getElementById('saisie-valeurs').innerHTML = renduValeursSaisie()
}

function renduValeursSaisie() {
  const v = valeursPourQuantite(saisie.aliment.pour100, saisie.quantite || 0)
  return LIGNES_NUTRIMENTS.map(([k, lib, u]) => `
    <div class="valeur"><span class="valeur-nombre">${formatNombre(v[k], k === 'kcal' ? 0 : 1)}</span><span class="valeur-lib">${k === 'kcal' ? 'kcal' : `${u} ${lib.toLowerCase()}`}</span></div>`).join('')
}

async function validerSaisie() {
  const a = saisie.aliment
  const q = saisie.quantite
  if (!q || q <= 0 || q > 5000) { afficherToast('Indique une quantité entre 1 et 5 000 g.', true); return }
  if (!/^\d{2}:\d{2}/.test(saisie.heure || '')) saisie.heure = heureActuelle()

  const v = valeursPourQuantite(a.pour100, q)
  const repere = saisie.repere ? `${formatNombre(saisie.repere.nombre, saisie.repere.nombre % 1 ? 1 : 0)} ${libelleRepereSaisie()} (≈ ${formatNombre(q)} g)` : null
  const ligne = {
    date: saisie.date || journalDate, heure: saisie.heure, type_repas: saisie.type,
    source: a.source, ref: a.ref, nom: a.marque ? `${a.nom} (${a.marque})` : a.nom,
    quantite_g: q, repere, ...v,
  }

  const btn = document.getElementById('btn-valider-saisie')
  btn.disabled = true
  const { error } = saisie.entreeId
    ? await db.from('journal').update(ligne).eq('id', saisie.entreeId)
    : await db.from('journal').insert(ligne)
  btn.disabled = false
  if (error) { gererErreur(error, "Impossible d'enregistrer. Réessaie dans un instant."); return }

  afficherToast(saisie.entreeId ? 'Modifié' : `Ajouté ${auRepas(saisie.type)}`)
  fermerFeuille()
  apresModificationJournal()
}

function apresModificationJournal() {
  if (pageActive === 'journal') chargerJournal()
  if (pageActive === 'aujourdhui') chargerAujourdhui()
}

// ── Modifier / supprimer une entrée ──────────────────────────
async function ouvrirEntree(id) {
  const e = entreesJour.find(x => x.id === id)
  if (!e) return
  saisie = { type: e.type_repas, heure: e.heure.slice(0, 5), entreeId: e.id, date: e.date }
  if (e.source === 'libre') { afficherSaisieLibre(e); return }

  let a = await chargerAliment(e.source, e.ref)
  if (!a) {
    // Aliment introuvable (produit supprimé…) : on repart des valeurs enregistrées
    const f = 100 / Number(e.quantite_g)
    a = { source: e.source, ref: e.ref, nom: e.nom, categorie: 'autre',
      pour100: { kcal: e.kcal * f, proteines: e.proteines * f, glucides: e.glucides * f, sucres: e.sucres * f, lipides: e.lipides * f, fibres: e.fibres * f, sucres_ajoutes_100g: e.sucres_ajoutes * f } }
  }
  saisie.aliment = a
  saisie.quantite = Number(e.quantite_g)
  saisie.repere = null
  afficherQuantite()
}

async function supprimerEntree() {
  if (!confirm('Supprimer cet aliment du journal ?')) return
  const { error } = await db.from('journal').delete().eq('id', saisie.entreeId)
  if (error) { gererErreur(error, 'Impossible de supprimer.'); return }
  fermerFeuille()
  afficherToast('Supprimé')
  apresModificationJournal()
}

// ── Saisie libre (plat au restaurant, aliment introuvable) ───
function afficherSaisieLibre(entree = null) {
  const modif = !!entree
  ouvrirFeuille(modif ? 'Modifier' : `Saisie libre · ${libelleRepas(saisie.type)}`, `
    <p class="message-info" style="margin-top:0;">Pour un plat dont tu connais à peu près les calories (restaurant, plat préparé sans code-barres…).</p>
    <label class="champ"><span class="champ-label">Nom</span>
      <input id="libre-nom" class="input" type="text" value="${esc(entree?.nom || document.getElementById('recherche-aliment')?.value || '')}" /></label>
    <div class="grille-2">
      <label class="champ"><span class="champ-label">Calories (kcal)</span>
        <input id="libre-kcal" class="input" type="text" inputmode="numeric" value="${entree ? formatNombreBrut(entree.kcal) : ''}" /></label>
      <label class="champ"><span class="champ-label">Protéines (g, facultatif)</span>
        <input id="libre-proteines" class="input" type="text" inputmode="decimal" value="${entree ? formatNombreBrut(entree.proteines) : ''}" /></label>
    </div>
    <div class="grille-2">
      <label class="champ"><span class="champ-label">Repas</span>
        <select class="input" onchange="saisie.type = this.value">
          ${TYPES_REPAS.map(([k, l]) => `<option value="${k}" ${saisie.type === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label class="champ"><span class="champ-label">Heure</span>
        <input class="input" type="time" value="${saisie.heure}" onchange="saisie.heure = this.value" /></label>
    </div>
    <div class="feuille-actions">
      ${modif ? `<button class="btn btn-danger" onclick="supprimerEntree()">Supprimer</button>` : `<button class="btn btn-secondaire" onclick="afficherRecherche()">Retour</button>`}
      <button class="btn btn-primaire" onclick="validerSaisieLibre()">${modif ? 'Enregistrer' : 'Ajouter'}</button>
    </div>`)
}

async function validerSaisieLibre() {
  const nom = document.getElementById('libre-nom').value.trim()
  const kcal = Number(document.getElementById('libre-kcal').value.replace(',', '.'))
  const prot = Number(document.getElementById('libre-proteines').value.replace(',', '.')) || 0
  if (!nom) { afficherToast('Indique un nom.', true); return }
  if (!kcal || kcal < 0 || kcal > 5000) { afficherToast('Indique les calories (entre 1 et 5 000).', true); return }
  const ligne = {
    date: saisie.date || journalDate, heure: saisie.heure, type_repas: saisie.type, source: 'libre', ref: null,
    nom, quantite_g: 100, repere: 'saisie libre', kcal: Math.round(kcal), proteines: prot,
    glucides: 0, sucres: 0, sucres_ajoutes: 0, lipides: 0, fibres: 0,
  }
  const { error } = saisie.entreeId
    ? await db.from('journal').update(ligne).eq('id', saisie.entreeId)
    : await db.from('journal').insert(ligne)
  if (error) { gererErreur(error, "Impossible d'enregistrer."); return }
  fermerFeuille()
  afficherToast(saisie.entreeId ? 'Modifié' : 'Ajouté')
  apresModificationJournal()
}

// ═════════════════════════════════════════════════════════════
// SCAN DE CODE-BARRES + OPEN FOOD FACTS
// ═════════════════════════════════════════════════════════════
function chargerScriptScanner() {
  if (window.Html5Qrcode) return Promise.resolve()
  return new Promise((ok, ko) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
    s.onload = ok
    s.onerror = () => ko(new Error('Failed to fetch (librairie de scan)'))
    document.head.appendChild(s)
  })
}

async function ouvrirScanner() {
  ouvrirFeuille('Scanner un code-barres', `
    <div id="scan-zone" class="scan-zone"><div class="spinner"></div></div>
    <p class="message-info" style="text-align:center;">Place le code-barres dans le cadre, bien éclairé.</p>
    <form class="recherche-barre" style="margin-top:var(--sp-4);" onsubmit="event.preventDefault(); traiterCodeBarres(document.getElementById('code-manuel').value)">
      <input id="code-manuel" class="input" type="text" inputmode="numeric" placeholder="Ou tape les chiffres du code" />
      <button class="btn btn-secondaire" type="submit">OK</button>
    </form>
    <button class="btn btn-lien btn-bloc" onclick="arreterScanner(); afficherRecherche()">Retour à la recherche</button>`,
    { onFermer: arreterScanner })

  try {
    await chargerScriptScanner()
    const zone = document.getElementById('scan-zone')
    if (!zone) return
    zone.innerHTML = ''
    const F = Html5QrcodeSupportedFormats
    _scanner = new Html5Qrcode('scan-zone', {
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false,
    })
    await _scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.min(280, w * 0.85), height: Math.min(150, h * 0.5) }) },
      code => { arreterScanner(); traiterCodeBarres(code) },
      () => {}
    )
  } catch (e) {
    console.error(e)
    const zone = document.getElementById('scan-zone')
    if (zone) zone.innerHTML = `<p class="message-erreur" style="padding:var(--sp-4);">${
      estErreurReseau(e) ? "La caméra n'a pas pu démarrer (connexion internet nécessaire la première fois)."
      : "Impossible d'accéder à la caméra. Autorise-la dans les réglages du téléphone, ou tape le code à la main ci-dessous."}</p>`
  }
}

async function arreterScanner() {
  const s = _scanner
  _scanner = null
  if (s) { try { await s.stop(); s.clear() } catch (e) { /* déjà arrêté */ } }
}

async function traiterCodeBarres(code) {
  code = String(code || '').replace(/\D/g, '')
  if (code.length < 8 || code.length > 14) { afficherToast('Code-barres invalide (8 à 14 chiffres).', true); return }
  ouvrirFeuille('Recherche du produit…', '<div class="spinner" style="margin:var(--sp-6) auto;"></div>')

  // 1. Déjà scanné : on reprend le produit enregistré (avec ses corrections)
  const { data: existant, error } = await db.from('produits').select('*').eq('code_barres', code).maybeSingle()
  if (error) { gererErreur(error); fermerFeuille(); return }
  if (existant) { choisirProduit(existant); return }

  // 2. Open Food Facts
  let off = null
  try {
    const r = await avecDelai(fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_fr,brands,nutriments,serving_size,serving_quantity,categories_tags`), 12000)
    if (r.ok) { const j = await r.json(); if (j.status === 1) off = j.product }
  } catch (e) { console.warn('Open Food Facts indisponible', e) }

  const produit = off ? produitDepuisOff(code, off) : null
  if (!produit || produit.kcal == null) {
    ouvrirProduitManuel(code, produit, false,
      off ? 'Produit trouvé, mais sans valeurs nutritionnelles : complète-les depuis l\'étiquette.'
          : 'Produit inconnu d\'Open Food Facts : saisis les valeurs de l\'étiquette (pour 100 g). Il sera retenu pour la prochaine fois.')
    return
  }
  const { data, error: e2 } = await db.from('produits').insert(produit).select().single()
  if (e2) { gererErreur(e2, "Impossible d'enregistrer le produit."); return }
  choisirProduit(data)
}

function choisirProduit(p) {
  if (!saisie) saisie = { type: 'collation', heure: heureActuelle(), entreeId: null }
  saisie.aliment = alimentDepuisProduit(p)
  noterUtilisationProduit(p.id)
  saisie.quantite = saisie.aliment.portion_g || 100
  saisie.repere = saisie.aliment.portion_g ? { cle: 'portion', nombre: 1 } : null
  afficherQuantite()
}

// Catégorie du produit à partir des catégories Open Food Facts
function categorieOff(tags = []) {
  const t = tags.join(' ')
  const a = (...m) => m.some(x => t.includes(x))
  if (a('en:biscuits', 'en:chocolates', 'en:confectioneries', 'en:sweet-snacks', 'en:desserts', 'en:sweet-spreads', 'en:cakes', 'en:pastries', 'en:ice-creams', 'en:sweetened-beverages', 'en:sodas', 'en:jams')) return 'sucre'
  if (a('en:fats', 'en:oils', 'en:butters', 'en:nuts')) return 'matiere_grasse'
  if (a('en:meats', 'en:fishes', 'en:seafood', 'en:eggs', 'en:poultries', 'en:hams')) return 'viande_poisson'
  if (a('en:dairies', 'en:yogurts', 'en:cheeses', 'en:milks')) return 'laitier'
  if (a('en:pastas', 'en:rices', 'en:breads', 'en:cereals', 'en:potatoes', 'en:legumes', 'en:pulses')) return 'feculent'
  if (a('en:vegetables')) return 'legume'
  if (a('en:fruits')) return 'fruit'
  if (a('en:beverages')) return 'boisson'
  return 'autre'
}

function produitDepuisOff(code, p) {
  const n = p.nutriments || {}
  const val = k => (n[k] === undefined || n[k] === '' || isNaN(Number(n[k]))) ? null : Math.round(Number(n[k]) * 10) / 10
  let kcal = val('energy-kcal_100g')
  if (kcal == null && val('energy_100g') != null) kcal = Math.round(val('energy_100g') / 4.184) // kJ → kcal
  const categorie = categorieOff(p.categories_tags)
  const ajoutes = val('added-sugars_100g')
  const portion = Number(p.serving_quantity)
  return {
    code_barres: code,
    nom: (p.product_name_fr || p.product_name || 'Produit sans nom').trim().slice(0, 200),
    marque: (p.brands || '').split(',')[0].trim().slice(0, 100) || null,
    portion_g: portion > 0 && portion < 2000 ? portion : null,
    portion_libelle: portion > 0 && p.serving_size ? String(p.serving_size).slice(0, 60) : null,
    categorie,
    sucre_ajoute: ajoutes != null ? ajoutes > 0 : categorie === 'sucre',
    kcal, proteines: val('proteins_100g'), glucides: val('carbohydrates_100g'), sucres: val('sugars_100g'),
    lipides: val('fat_100g'), fibres: val('fiber_100g'), sel: val('salt_100g'),
    source: 'openfoodfacts',
  }
}

// Formulaire produit : création manuelle ou correction des valeurs
function ouvrirProduitManuel(code, p = null, correction = false, message = '') {
  const champ = (id, lib, v) => `<label class="champ"><span class="champ-label">${lib}</span>
    <input id="${id}" class="input" type="text" inputmode="decimal" value="${v == null ? '' : formatNombreBrut(v)}" /></label>`
  ouvrirFeuille(correction ? 'Corriger le produit' : 'Nouveau produit', `
    ${message ? `<p class="message-info" style="margin-top:0;">${esc(message)}</p>` : ''}
    <p class="message-info" style="margin-top:0;">Code-barres ${esc(code)}. Valeurs pour <strong>100 g</strong>, comme sur l'étiquette.</p>
    <label class="champ"><span class="champ-label">Nom</span><input id="pm-nom" class="input" type="text" value="${esc(p?.nom || '')}" /></label>
    <label class="champ"><span class="champ-label">Marque (facultatif)</span><input id="pm-marque" class="input" type="text" value="${esc(p?.marque || '')}" /></label>
    <div class="grille-2">
      ${champ('pm-kcal', 'Calories (kcal)', p?.kcal)}
      ${champ('pm-proteines', 'Protéines (g)', p?.proteines)}
      ${champ('pm-glucides', 'Glucides (g)', p?.glucides)}
      ${champ('pm-sucres', 'dont sucres (g)', p?.sucres)}
      ${champ('pm-lipides', 'Lipides (g)', p?.lipides)}
      ${champ('pm-fibres', 'Fibres (g)', p?.fibres)}
    </div>
    <div class="grille-2">
      ${champ('pm-portion', 'Une portion (g, facultatif)', p?.portion_g)}
      <label class="champ"><span class="champ-label">Nom de la portion</span>
        <input id="pm-portion-lib" class="input" type="text" placeholder="1 biscuit" value="${esc(p?.portion_libelle || '')}" /></label>
    </div>
    <label class="choix choix-case ${p?.sucre_ajoute ? 'active' : ''}" style="margin-bottom:var(--sp-4);">
      <input id="pm-sucre" type="checkbox" class="hidden" ${p?.sucre_ajoute ? 'checked' : ''} onchange="this.parentElement.classList.toggle('active', this.checked); this.nextElementSibling.textContent = this.checked ? '✓' : ''" />
      <span class="case">${p?.sucre_ajoute ? '✓' : ''}</span>
      <span><span class="choix-titre">Produit sucré</span><span class="choix-detail">Biscuits, chocolat, desserts, sodas… Ses sucres comptent comme sucres ajoutés.</span></span>
    </label>
    <div class="feuille-actions">
      <button class="btn btn-secondaire" onclick="${correction ? 'afficherQuantite()' : 'afficherRecherche()'}">Annuler</button>
      <button class="btn btn-primaire" onclick="enregistrerProduitManuel('${esc(code)}', ${correction && p?.id ? `'${p.id}'` : 'null'}, ${p?.source === 'openfoodfacts' ? 'true' : 'false'})">Enregistrer</button>
    </div>`)
}

async function enregistrerProduitManuel(code, id, depuisOff) {
  const nb = k => { const v = document.getElementById(k).value.trim().replace(',', '.'); return v === '' ? null : Number(v) }
  const nom = document.getElementById('pm-nom').value.trim()
  const kcal = nb('pm-kcal')
  if (!nom) { afficherToast('Indique le nom du produit.', true); return }
  if (kcal == null || isNaN(kcal) || kcal < 0 || kcal > 950) { afficherToast('Indique les calories pour 100 g (entre 0 et 950).', true); return }
  const champs = {
    nom, marque: document.getElementById('pm-marque').value.trim() || null,
    kcal, proteines: nb('pm-proteines'), glucides: nb('pm-glucides'), sucres: nb('pm-sucres'), lipides: nb('pm-lipides'), fibres: nb('pm-fibres'),
    portion_g: nb('pm-portion') || null, portion_libelle: document.getElementById('pm-portion-lib').value.trim() || null,
    sucre_ajoute: document.getElementById('pm-sucre').checked,
  }
  if (Object.values(champs).some(v => typeof v === 'number' && isNaN(v))) { afficherToast('Une des valeurs n\'est pas un nombre.', true); return }
  if (champs.sucre_ajoute && saisie?.aliment?.produit) champs.categorie = 'sucre'

  const req = id
    ? db.from('produits').update({ ...champs, corrige: true }).eq('id', id).select().single()
    : db.from('produits').upsert({ code_barres: code, ...champs, source: depuisOff ? 'openfoodfacts' : 'manuel', corrige: depuisOff },
        { onConflict: 'user_id,code_barres' }).select().single()
  const { data, error } = await req
  if (error) { gererErreur(error, "Impossible d'enregistrer le produit."); return }
  afficherToast(id ? 'Valeurs corrigées' : 'Produit enregistré')
  choisirProduit(data)
}

// ═════════════════════════════════════════════════════════════
// PHOTOS DES REPAS
// ═════════════════════════════════════════════════════════════
const PHOTO = { COTE_MAX: 1080, POIDS_VISE: 160 * 1024 }

async function chargerImage(fichier) {
  try { return await createImageBitmap(fichier) }
  catch (e) {
    // Repli pour les navigateurs qui ne décodent pas ce format avec createImageBitmap
    return await new Promise((ok, ko) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = () => ko(new Error('Format de photo non pris en charge'))
      img.src = URL.createObjectURL(fichier)
    })
  }
}

// Compression dans le navigateur : 1080 px max, WebP (JPEG si WebP indisponible, ex. Safari), ~150 Ko
async function compresserPhoto(fichier) {
  const img = await chargerImage(fichier)
  const w = img.width, h = img.height
  const f = Math.min(1, PHOTO.COTE_MAX / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * f)
  canvas.height = Math.round(h * f)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  if (img.close) img.close()

  const versBlob = (type, q) => new Promise(ok => canvas.toBlob(ok, type, q))
  let type = 'image/webp'
  let blob = null
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
    blob = await versBlob(type, q)
    if (blob && blob.type !== type) { type = 'image/jpeg'; blob = await versBlob(type, q) }
    if (blob && blob.size <= PHOTO.POIDS_VISE) break
  }
  return blob
}

async function ajouterPhoto(type, input) {
  const fichier = input.files?.[0]
  input.value = ''
  if (!fichier) return
  if (!fichier.type.startsWith('image/') && !/\.(heic|heif)$/i.test(fichier.name)) { afficherToast('Ce fichier n\'est pas une photo.', true); return }

  afficherToast('Envoi de la photo…')
  let blob
  try { blob = await compresserPhoto(fichier) }
  catch (e) { console.error(e); afficherToast('Impossible de lire cette photo.', true); return }
  if (!blob || blob.size > 512 * 1024) { afficherToast('Photo trop lourde, même compressée.', true); return }

  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
  const id = crypto.randomUUID()
  const chemin = `${utilisateur.id}/${journalDate}/${id}.${ext}`
  const { error: eUp } = await db.storage.from('photos-repas').upload(chemin, blob, { contentType: blob.type, upsert: false })
  if (eUp) { gererErreur(eUp, "Impossible d'envoyer la photo."); return }

  const { error } = await db.from('photos_repas').insert({ id, date: journalDate, type_repas: type, chemin, taille_octets: blob.size })
  if (error) {
    await db.storage.from('photos-repas').remove([chemin])
    gererErreur(error, "Impossible d'enregistrer la photo.")
    return
  }
  afficherToast(`Photo ajoutée (${formatNombre(blob.size / 1024)} Ko)`)
  chargerJournal()
}

// Les photos sont privées : affichage par URL signée temporaire (1 h)
const _urlsSignees = new Map()

async function urlsSignees(chemins) {
  const manquants = chemins.filter(c => !_urlsSignees.has(c))
  if (manquants.length) {
    const { data, error } = await db.storage.from('photos-repas').createSignedUrls(manquants, 3600)
    if (error) { console.error(error); return }
    for (const d of data || []) if (d.signedUrl) _urlsSignees.set(d.path, d.signedUrl)
    setTimeout(() => manquants.forEach(c => _urlsSignees.delete(c)), 50 * 60 * 1000)
  }
}

async function chargerMiniatures() {
  const imgs = [...document.querySelectorAll('img[data-chemin]')]
  if (!imgs.length) return
  await urlsSignees(imgs.map(i => i.dataset.chemin))
  imgs.forEach(i => { const u = _urlsSignees.get(i.dataset.chemin); if (u) i.src = u })
}

async function ouvrirPhoto(id) {
  const p = photosJour.find(x => x.id === id)
  if (!p) return
  await urlsSignees([p.chemin])
  ouvrirFeuille(`${libelleRepas(p.type_repas)} · ${libelleDate(p.date)}`, `
    <img class="photo-grande" src="${esc(_urlsSignees.get(p.chemin) || '')}" alt="Photo du repas" />
    <div class="feuille-actions">
      <button class="btn btn-danger" onclick="supprimerPhoto('${p.id}')">Supprimer la photo</button>
      <button class="btn btn-secondaire" onclick="fermerFeuille()">Fermer</button>
    </div>`)
}

async function supprimerPhoto(id) {
  const p = photosJour.find(x => x.id === id)
  if (!p || !confirm('Supprimer cette photo ?')) return
  const { error: eS } = await db.storage.from('photos-repas').remove([p.chemin])
  if (eS) { gererErreur(eS, 'Impossible de supprimer la photo.'); return }
  const { error } = await db.from('photos_repas').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  fermerFeuille()
  afficherToast('Photo supprimée')
  chargerJournal()
}

// Suppression automatique des photos de plus de 6 mois (si activée), une fois par jour au lancement
async function nettoyerPhotosAnciennes() {
  if (!profil?.suppression_auto_photos) return
  try { if (localStorage.getItem('ss_nettoyage_photos') === dateISO()) return } catch (e) {}
  const limite = new Date()
  limite.setMonth(limite.getMonth() - 6)
  const { data, error } = await db.from('photos_repas').select('id, chemin').lt('date', dateISO(limite)).limit(500)
  if (error) { console.error(error); return }
  for (let i = 0; i < (data || []).length; i += 100) {
    const lot = data.slice(i, i + 100)
    const { error: eS } = await db.storage.from('photos-repas').remove(lot.map(p => p.chemin))
    if (eS) { console.error(eS); return }
    await db.from('photos_repas').delete().in('id', lot.map(p => p.id))
  }
  try { localStorage.setItem('ss_nettoyage_photos', dateISO()) } catch (e) {}
  if (data?.length) console.info(`${data.length} photo(s) de plus de 6 mois supprimée(s)`)
}

// ── Espace de stockage (réglages) ────────────────────────────
async function chargerStockage() {
  const el = document.getElementById('reglages-stockage')
  if (!el) return
  const [rP, rB] = await Promise.all([
    db.from('photos_repas').select('taille_octets'),
    db.rpc('taille_base'),
  ])
  const photos = (rP.data || []).reduce((s, p) => s + p.taille_octets, 0)
  const nbPhotos = rP.data?.length || 0
  const base = rB.error ? null : Number(rB.data)
  const mo = o => o < 1024 * 1024 ? `${formatNombre(o / 1024)} Ko` : `${formatNombre(o / 1024 / 1024, o < 10 * 1024 * 1024 ? 1 : 0)} Mo`
  const barre = (val, max) => `<div class="barre"><div class="barre-remplie ${val / max > 0.8 ? 'barre-haute' : ''}" style="width:${Math.min(100, val / max * 100)}%"></div></div>`

  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Photos et stockage</div>
      <div class="total-ligne">
        <div class="total-tete"><span>Photos (${nbPhotos})</span><span class="total-valeur"><strong>${mo(photos)}</strong> / 1 Go</span></div>
        ${barre(photos, 1024 * 1024 * 1024)}
      </div>
      ${base != null ? `<div class="total-ligne">
        <div class="total-tete"><span>Base de données</span><span class="total-valeur"><strong>${mo(base)}</strong> / 500 Mo</span></div>
        ${barre(base, 500 * 1024 * 1024)}
      </div>` : ''}
      <p class="message-info">Limites du plan gratuit Supabase. Les 1 Go de fichiers sont partagés entre tous tes projets.</p>
      <label class="choix choix-case ${profil.suppression_auto_photos ? 'active' : ''}" style="margin-top:var(--sp-3);">
        <input type="checkbox" class="hidden" ${profil.suppression_auto_photos ? 'checked' : ''} onchange="basculerSuppressionAuto(this.checked)" />
        <span class="case">${profil.suppression_auto_photos ? '✓' : ''}</span>
        <span><span class="choix-titre">Supprimer les photos de plus de 6 mois</span><span class="choix-detail">Automatiquement, à l'ouverture de l'app. Le journal est conservé.</span></span>
      </label>
    </div>`
}

async function basculerSuppressionAuto(actif) {
  if (await sauvegarderProfil({ suppression_auto_photos: actif })) {
    afficherToast(actif ? 'Suppression automatique activée' : 'Suppression automatique désactivée')
    chargerStockage()
    if (actif) nettoyerPhotosAnciennes()
  }
}

// ── Résumé du jour (page Aujourd'hui) ────────────────────────
async function chargerResumeJour() {
  const el = document.getElementById('aujourdhui-resume')
  if (!el) return
  const { data, error } = await db.from('journal').select('kcal, proteines, glucides, sucres, sucres_ajoutes, lipides, fibres').eq('date', dateISO())
  if (error) { console.error(error); return }
  const t = totauxEntrees(data || [])
  const obj = objectifsDuJour()
  if (!obj) { el.innerHTML = ''; return }
  const reste = Math.round(obj.kcal - t.kcal)
  const depasse = reste < 0
  el.innerHTML = `
    <div class="carte carte-cadre avec-etiquette">
      <span class="etiquette">Ma journée</span>
      <div class="anneaux">
        ${renduAnneau('Calories', t.kcal, obj.kcal, 'var(--lavande)', depasse
          ? { valeur: `+${formatNombre(-reste)}`, sous: 'en trop' }
          : { valeur: formatNombre(reste), sous: 'restantes' })}
        ${renduAnneau('Protéines', t.proteines, obj.proteines, 'var(--rose)', { valeur: `${formatNombre(t.proteines)} g`, sous: `sur ${formatNombre(obj.proteines)}` }, false)}
        ${renduAnneau('Sucres', t.sucres, obj.sucres, 'var(--jaune)', { valeur: `${formatNombre(t.sucres)} g`, sous: `max ${formatNombre(obj.sucres)}` })}
      </div>
      <p class="anneau-resume">${formatNombre(t.kcal)} kcal sur ${formatNombre(obj.kcal)}${depasse ? '' : ' : il te reste de la marge'}</p>
      ${depasse ? `<div class="alerte-depasse">${icone('alerte')}<div><strong>${formatNombre(-reste)} kcal au-dessus de ta cible</strong>
        <span>Ça arrive, pas de panique. Demain on reprend tranquillement, sans rien compenser.</span></div></div>` : ''}
      <button class="btn btn-secondaire btn-bloc" style="margin-top:var(--sp-4);" onclick="showPage('journal')">Voir ou ajouter des repas</button>
    </div>`
}

// Un anneau de progression (rempli en %, rouge s'il dépasse un maximum)
function renduAnneau(nom, valeur, cible, couleur, centre, peutDepasser = true) {
  const pct = cible ? Math.min(100, (valeur / cible) * 100) : 0
  const depasse = peutDepasser && cible && valeur > cible
  return `
    <div class="anneau-bloc ${depasse ? 'anneau-depasse' : ''}">
      <div class="anneau-boite" role="img" aria-label="${nom} : ${formatNombre(valeur)} sur ${formatNombre(cible)}">
        <svg viewBox="0 0 100 100"><circle class="anneau-piste" cx="50" cy="50" r="40"/>
          <circle class="anneau-trait" cx="50" cy="50" r="40" pathLength="100" stroke-dasharray="100"
            style="stroke:${depasse ? 'var(--danger)' : couleur};stroke-dashoffset:${(100 - pct).toFixed(1)}"/></svg>
        <div class="anneau-centre"><span class="anneau-valeur">${centre.valeur}</span><span class="anneau-sous">${centre.sous}</span></div>
      </div>
      <span class="anneau-nom">${nom}</span>
    </div>`
}

// ═════════════════════════════════════════════════════════════
// REPAS FAVORIS ET « COMME HIER »
// ═════════════════════════════════════════════════════════════
const CHAMPS_VALEURS = ['kcal', 'proteines', 'glucides', 'sucres', 'sucres_ajoutes', 'lipides', 'fibres']

function renduActionsRepas(type, entrees) {
  const hier = entreesVeille.filter(e => e.type_repas === type)
  const boutons = []
  if (!entrees.length && hier.length) {
    const kcal = hier.reduce((s, e) => s + Number(e.kcal), 0)
    boutons.push(`<button class="btn btn-lien ico-titre" onclick="copierRepasVeille('${type}')">${icone('copier')} Comme hier (${formatNombre(kcal)} kcal)</button>`)
  }
  if (entrees.length) boutons.push(`<button class="btn btn-lien ico-titre" onclick="nommerRepasFavori('${type}')">${icone('coeur')} Enregistrer comme repas favori</button>`)
  return boutons.length ? `<div class="repas-actions">${boutons.join('')}</div>` : ''
}

// Heure par défaut d'un repas ajouté d'un coup
function heureRepas(type) {
  if (journalDate === dateISO()) return heureActuelle()
  return { petit_dejeuner: '08:00', dejeuner: '12:30', diner: '19:30', collation: '16:00' }[type] || '12:00'
}

// Ajoute une liste d'aliments (copie d'hier ou repas favori) au journal du jour affiché
async function ajouterElements(type, elements) {
  const lignes = elements.map(e => ({
    date: journalDate, heure: heureRepas(type), type_repas: type, source: e.source, ref: e.ref ?? null, nom: e.nom,
    quantite_g: Number(e.quantite_g) || 1, repere: e.repere || null,
    ...Object.fromEntries(CHAMPS_VALEURS.map(k => [k, Number(e[k]) || 0])),
  }))
  const { error } = await db.from('journal').insert(lignes)
  if (error) { gererErreur(error, "Impossible d'ajouter le repas."); return false }
  return true
}

async function copierRepasVeille(type) {
  const hier = entreesVeille.filter(e => e.type_repas === type)
  if (!hier.length || !(await ajouterElements(type, hier))) return
  afficherToast(`${libelleRepas(type)} d'hier ajouté (${formatNombre(hier.reduce((s, e) => s + Number(e.kcal), 0))} kcal)`)
  chargerJournal()
}

// ── Enregistrer un repas comme favori ────────────────────────
function nommerRepasFavori(type) {
  const proposition = { petit_dejeuner: 'Mon petit déjeuner', dejeuner: 'Mon déjeuner', diner: 'Mon dîner', collation: 'Ma collation' }[type]
  ouvrirFeuille('Nouveau repas favori', `
    <p class="message-info" style="margin-top:0;">${entreesJour.filter(e => e.type_repas === type).map(e => esc(e.nom)).join(' · ')}</p>
    <label class="champ" style="margin-top:var(--sp-3);"><span class="champ-label">Nom du repas</span>
      <input id="rf-nom" class="input" type="text" maxlength="80" value="${esc(proposition)}" /></label>
    <div class="feuille-actions">
      <button class="btn btn-secondaire" onclick="fermerFeuille()">Annuler</button>
      <button class="btn btn-primaire" onclick="enregistrerRepasFavori('${type}')">Enregistrer</button>
    </div>`)
}

async function enregistrerRepasFavori(type) {
  const nom = document.getElementById('rf-nom').value.trim()
  if (!nom) { afficherToast('Donne un nom à ce repas.', true); return }
  const elements = entreesJour.filter(e => e.type_repas === type).map(e => ({
    source: e.source, ref: e.ref, nom: e.nom, quantite_g: Number(e.quantite_g), repere: e.repere,
    ...Object.fromEntries(CHAMPS_VALEURS.map(k => [k, Number(e[k]) || 0])),
  }))
  const { error } = await db.from('repas_favoris').insert({ user_id: utilisateur.id, nom, type_repas: type, elements })
  if (error) { gererErreur(error, "Impossible d'enregistrer ce repas favori."); return }
  _repasFavoris = null
  fermerFeuille()
  afficherToast(`« ${nom} » enregistré : retrouve-le en haut de la recherche`)
}

// ── Liste dans la fenêtre d'ajout ────────────────────────────
async function chargerRepasFavoris() {
  if (_repasFavoris) return _repasFavoris
  const { data, error } = await db.from('repas_favoris').select('*').order('derniere_utilisation', { ascending: false })
  _repasFavoris = error ? [] : (data || [])
  return _repasFavoris
}

const kcalRepas = r => (r.elements || []).reduce((s, e) => s + Number(e.kcal || 0), 0)

async function afficherRepasFavorisDansRecherche() {
  const liste = await chargerRepasFavoris()
  const el = document.getElementById('repas-favoris-liste')
  if (!el || !liste.length) { if (el) el.innerHTML = ''; return }
  // Les repas du même moment de la journée d'abord
  const tries = [...liste].sort((a, b) => (b.type_repas === saisie?.type) - (a.type_repas === saisie?.type))
  el.innerHTML = `<div class="resultats-titre">Mes repas favoris</div>
    ${tries.map(r => `
      <div class="repas-favori">
        <button class="repas-favori-ajout" onclick="ajouterRepasFavori('${r.id}')">
          <span class="pastille-scan">${icone('coeur')}</span>
          <span class="repas-favori-texte"><span class="resultat-nom">${esc(r.nom)}</span>
          <span class="resultat-detail">${formatNombre(kcalRepas(r))} kcal · ${(r.elements || []).map(e => esc(e.nom)).join(', ')}</span></span>
        </button>
        <button class="btn btn-secondaire btn-icone" onclick="modifierRepasFavori('${r.id}')" aria-label="Modifier ${esc(r.nom)}">${icone('crayon')}</button>
      </div>`).join('')}`
}

async function ajouterRepasFavori(id) {
  const r = (await chargerRepasFavoris()).find(x => x.id === id)
  if (!r || !(await ajouterElements(saisie.type, r.elements || []))) return
  db.from('repas_favoris').update({ derniere_utilisation: new Date().toISOString() }).eq('id', id).then(() => {})
  _repasFavoris = null
  fermerFeuille()
  afficherToast(`« ${r.nom} » ajouté (${formatNombre(kcalRepas(r))} kcal)`)
  chargerJournal()
}

// ── Modifier un repas favori (nom, quantités, aliments retirés) ─
let _edition = null
async function modifierRepasFavori(id) {
  const r = (await chargerRepasFavoris()).find(x => x.id === id)
  if (!r) return
  _edition = { id, typeRetour: saisie?.type, nom: r.nom, elements: (r.elements || []).map(e => ({ ...e, base: { ...e } })) }
  afficherEditionFavori()
}

function afficherEditionFavori() {
  const e = _edition
  ouvrirFeuille('Modifier le repas favori', `
    <label class="champ"><span class="champ-label">Nom</span>
      <input class="input" type="text" maxlength="80" value="${esc(e.nom)}" oninput="_edition.nom = this.value" /></label>
    <div class="carte-titre">Aliments</div>
    ${e.elements.map((x, i) => `
      <div class="ligne ligne-edition">
        <span class="ligne-edition-nom">${esc(x.nom)}<span class="resultat-detail">${formatNombre(x.kcal)} kcal</span></span>
        <span class="input-unite input-quantite"><input class="input input-petit" type="number" inputmode="decimal" min="1" max="2000" value="${formatNombreBrut(x.quantite_g)}"
          onchange="changerQuantiteFavori(${i}, this.value)" aria-label="Quantité de ${esc(x.nom)} en grammes" /><span>g</span></span>
        <button class="btn btn-lien" onclick="retirerElementFavori(${i})" aria-label="Retirer ${esc(x.nom)}">${icone('croix')}</button>
      </div>`).join('') || '<p class="message-info">Plus aucun aliment : supprime ce repas ou ajoutes-en depuis le journal.</p>'}
    <p class="message-info">Total : <strong>${formatNombre(e.elements.reduce((s, x) => s + Number(x.kcal), 0))} kcal</strong>. Pour ajouter un aliment, note le repas complet dans le journal puis enregistre-le à nouveau comme favori.</p>
    <div class="feuille-actions">
      <button class="btn btn-danger" onclick="supprimerRepasFavori()">Supprimer</button>
      <button class="btn btn-primaire" onclick="sauverRepasFavori()">Enregistrer</button>
    </div>`)
}

// Les valeurs suivent la quantité (proportionnellement à la quantité enregistrée au départ)
function changerQuantiteFavori(i, valeur) {
  const q = Number(String(valeur).replace(',', '.'))
  if (!q || q <= 0 || q > 2000) { afficherToast('Indique une quantité entre 1 et 2000 g.', true); afficherEditionFavori(); return }
  const x = _edition.elements[i]
  const ratio = q / Number(x.base.quantite_g || q)
  for (const k of CHAMPS_VALEURS) x[k] = Math.round(Number(x.base[k] || 0) * ratio * 10) / 10
  x.quantite_g = q
  x.repere = `${formatNombre(q)} g`
  afficherEditionFavori()
}

function retirerElementFavori(i) { _edition.elements.splice(i, 1); afficherEditionFavori() }

async function sauverRepasFavori() {
  const e = _edition
  if (!e.nom.trim()) { afficherToast('Donne un nom à ce repas.', true); return }
  if (!e.elements.length) { supprimerRepasFavori(); return }
  const elements = e.elements.map(({ base, ...x }) => x)
  const { error } = await db.from('repas_favoris').update({ nom: e.nom.trim(), elements }).eq('id', e.id)
  if (error) { gererErreur(error, "Impossible d'enregistrer les modifications."); return }
  _repasFavoris = null
  afficherToast('Repas favori modifié')
  retourAjout(e.typeRetour)
}

async function supprimerRepasFavori() {
  if (!confirm(`Supprimer le repas favori « ${_edition.nom} » ? Ton journal n'est pas modifié.`)) return
  const { error } = await db.from('repas_favoris').delete().eq('id', _edition.id)
  if (error) { gererErreur(error); return }
  _repasFavoris = null
  afficherToast('Repas favori supprimé')
  retourAjout(_edition.typeRetour)
}

function retourAjout(type) {
  if (type) ouvrirAjoutAliment(type)
  else fermerFeuille()
}
