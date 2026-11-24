// ─────────────────────────────────────────────────────────────
// Menus de la semaine : propositions, choix, menu figé, portions
// ajustées au fil de la journée, liste de courses par rayon
// Dépend de : app.js, calculs.js, profil.js, journal.js
// ─────────────────────────────────────────────────────────────

const ORDRE_RAYONS = ['Fruits et légumes', 'Boucherie', 'Poissonnerie', 'Charcuterie', 'Crèmerie', 'Boulangerie',
  'Épicerie salée', 'Épicerie sucrée', 'Surgelés', 'Boissons', 'Traiteur', 'Autres']
const LIBELLES_ETIQUETTES = { riche_proteines: 'riche en protéines', economique: 'économique', rapide: 'rapide', vegetarien: 'végétarien' }

let semaineMenu = null      // lundi de la semaine affichée (AAAA-MM-JJ)
let menuActuel = null       // ligne de la table menus
let repasMenu = []          // lignes de menu_repas
let coursesMenu = []        // lignes de courses
let ongletMenus = 'menu'    // 'menu' | 'courses'
let _recettes = null        // Map id → recette (avec ingrédients et aliments Ciqual)
let _kcalMangeesAujourdhui = 0
let _typesMangesAujourdhui = new Set()   // types de repas déjà notés dans le journal aujourd'hui

function noterJournalDuJour(lignes) {
  _kcalMangeesAujourdhui = (lignes || []).reduce((s, e) => s + Number(e.kcal), 0)
  _typesMangesAujourdhui = new Set((lignes || []).map(e => e.type_repas))
}

function lundiDe(iso = dateISO()) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dateISO(d)
}

function libelleJourCourt(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
}

function formatPortion(f) { return `${formatNombre(f, f % 1 ? 1 : 0)} portion${f > 1 ? 's' : ''}` }

function formatQuantite(g, libelle = '') {
  if (/oeuf|œuf/i.test(libelle)) { const n = Math.max(1, Math.round(g / 55)); return `${n} œuf${n > 1 ? 's' : ''}` }
  return g >= 1000 ? `${formatNombre(g / 1000, 1)} kg` : `${formatNombre(g)} g`
}

// ═════════════════════════════════════════════════════════════
// RECETTES
// ═════════════════════════════════════════════════════════════
const CHAMPS_ALIMENT = 'code, nom, rayon, categorie, sucre_ajoute, kcal, proteines, glucides, sucres, lipides, fibres'

// ── Favoris (le cœur sur une recette) ───────────────────────
let _favoris = null
async function chargerFavoris() {
  if (_favoris) return _favoris
  const { data, error } = await db.from('recettes_favorites').select('recette_id')
  // Table absente (sql/10 pas encore lancé) : pas de favoris, sans bloquer les menus
  _favoris = new Set(error ? [] : (data || []).map(f => f.recette_id))
  return _favoris
}
const estFavori = id => !!_favoris?.has(id)

async function basculerFavori(recetteId, bouton) {
  await chargerFavoris()
  const ajout = !_favoris.has(recetteId)
  const { error } = ajout
    ? await db.from('recettes_favorites').insert({ user_id: utilisateur.id, recette_id: recetteId })
    : await db.from('recettes_favorites').delete().eq('recette_id', recetteId)
  if (error) { gererErreur(error, "Impossible d'enregistrer le favori."); return }
  ajout ? _favoris.add(recetteId) : _favoris.delete(recetteId)
  if (bouton) {
    bouton.classList.toggle('actif', ajout)
    bouton.setAttribute('aria-pressed', ajout)
    bouton.setAttribute('aria-label', ajout ? 'Retirer des favoris' : 'Ajouter aux favoris')
    bouton.classList.remove('bat'); void bouton.offsetWidth; bouton.classList.add('bat')
  }
  afficherToast(ajout ? 'Ajoutée à tes favoris : elle reviendra plus souvent' : 'Retirée de tes favoris')
}

function boutonFavori(recetteId) {
  const f = estFavori(recetteId)
  return `<button type="button" class="btn btn-coeur coeur ${f ? 'actif' : ''}" aria-pressed="${f}" aria-label="${f ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
    onclick="event.stopPropagation(); basculerFavori('${recetteId}', this)">${icone('coeur', '')}</button>`
}

async function chargerRecettes(forcer = false) {
  if (_recettes && !forcer) { await chargerFavoris(); return _recettes }
  chargerFavoris()
  const { data, error } = await db.from('recettes')
    .select(`*, recette_ingredients(*, aliments_ciqual(${CHAMPS_ALIMENT}))`).eq('actif', true)
  if (error) { gererErreur(error, 'Impossible de charger les recettes.'); return null }

  // Aliments des ingrédients de remplacement
  const codesSubs = new Set()
  for (const r of data || []) for (const i of r.recette_ingredients) for (const s of i.substituts || []) if (s.ciqual_code) codesSubs.add(s.ciqual_code)
  const alimentsSubs = new Map()
  if (codesSubs.size) {
    const { data: al, error: e2 } = await db.from('aliments_ciqual').select(CHAMPS_ALIMENT).in('code', [...codesSubs])
    if (e2) { gererErreur(e2); return null }
    for (const a of al || []) alimentsSubs.set(a.code, a)
  }

  _recettes = new Map()
  for (const r of data || []) {
    _recettes.set(r.id, {
      ...r,
      ingredients: [...r.recette_ingredients].sort((a, b) => a.ordre - b.ordre).map(i => ({
        libelle: i.libelle, ciqual_code: i.ciqual_code, grammes: Number(i.grammes), exclusions: i.exclusions || [],
        optionnel: i.optionnel, aliment: i.aliments_ciqual, rayon: i.aliments_ciqual?.rayon,
        substituts: (i.substituts || []).map(s => ({ ...s, aliment: alimentsSubs.get(s.ciqual_code), rayon: alimentsSubs.get(s.ciqual_code)?.rayon })),
      })),
    })
  }
  return _recettes
}

// Recette adaptée au profil (exclusions) avec sa nutrition par portion standard
function recettePourProfil(id) {
  const r = _recettes?.get(id)
  if (!r) return null
  const res = resoudreRecette(r, profil.exclusions || [], profil.exclusions_aliments || [])
  if (!res.ok) return { recette: r, ok: false, raison: res.raison }
  return { recette: r, ok: true, ingredients: res.ingredients, remplacements: res.remplacements, nutrition: nutritionParPortion(res.ingredients, r.portions_base) }
}

// Recettes proposables pour un type de repas (saison, temps de cuisine, exclusions, Ciqual complet)
function recettesEligibles(type, dateIso) {
  if (!_recettes) return []
  const mois = new Date(dateIso + 'T12:00:00').getMonth() + 1
  const res = []
  for (const r of _recettes.values()) {
    if (!r.types_repas.includes(type)) continue
    if (r.mois?.length && !r.mois.includes(mois)) continue
    if (r.temps_min > (profil.temps_cuisine_max || 40)) continue
    const p = recettePourProfil(r.id)
    if (p?.ok) res.push(p)
  }
  return res
}

// Score : priorité aux protéines, bonus économique, variété dans la semaine, part de hasard
function scoreRecette(p, dejaChoisies) {
  const n = p.nutrition
  const partProteines = n.kcal ? (n.proteines * 4) / n.kcal : 0
  let s = partProteines * 3
  if (p.recette.etiquettes.includes('economique')) s += 0.25
  if (estFavori(p.recette.id)) s += 0.6
  s -= (dejaChoisies.get(p.recette.id) || 0) * 0.9
  return s + Math.random() * 0.6
}

function proposer(type, dateIso, dejaChoisies, exclure = []) {
  return recettesEligibles(type, dateIso)
    .filter(p => !exclure.includes(p.recette.id))
    .map(p => ({ p, s: scoreRecette(p, dejaChoisies) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(x => x.p.recette.id)
}

// ── Portions ─────────────────────────────────────────────────
function partsMenu() {
  return partsDuJour({ petitDejeuner: !!menuActuel?.petit_dejeuner, collation: true })
}

// Portion prévue pour l'utilisatrice (selon sa cible et la part du repas)
function facteurPrevu(repas) {
  const p = repas.recette_id ? recettePourProfil(repas.recette_id) : null
  if (!p?.ok) return 1
  const cible = cibleKcalDuJour() || 1500
  return facteurPortion(cible * (partsMenu()[repas.type_repas] || 0.3), p.nutrition.kcal)
}

// Portions du jour ajustées selon ce qui a déjà été mangé aujourd'hui.
// Un repas déjà noté dans le journal compte comme mangé ; les repas non prévus au menu
// (ex. la collation) et pas encore mangés gardent leur part.
function facteursAjustesAujourdhui() {
  const auj = dateISO()
  const parts = partsMenu()
  const restants = repasMenu.filter(r => r.date === auj && r.recette_id && !r.mange && !_typesMangesAujourdhui.has(r.type_repas))
    .map(r => ({ id: r.id, type: r.type_repas, kcalParPortion: recettePourProfil(r.recette_id)?.nutrition?.kcal || 0 }))
  if (!restants.length || !cibleKcalDuJour()) return new Map()
  const prevus = new Set(repasMenu.filter(r => r.date === auj).map(r => r.type_repas))
  const virtuels = Object.keys(parts).filter(t => !prevus.has(t) && !_typesMangesAujourdhui.has(t)).map(t => ({ id: null, type: t, kcalParPortion: 0 }))
  const adaptes = adapterPortionsRestantes(cibleKcalDuJour(), _kcalMangeesAujourdhui, [...restants, ...virtuels], parts)
  return new Map(adaptes.filter(a => a.id).map(a => [a.id, a]))
}

function facteurRepas(repas, ajustes) {
  return ajustes?.get(repas.id)?.facteur ?? facteurPrevu(repas)
}

// ═════════════════════════════════════════════════════════════
// PAGE MENUS
// ═════════════════════════════════════════════════════════════
async function chargerMenus() {
  semaineMenu ??= lundiDe()
  const el = document.getElementById('menus-contenu')
  const [recettes, rMenu, rJour] = await Promise.all([
    chargerRecettes(),
    db.from('menus').select('*').eq('semaine_debut', semaineMenu).maybeSingle(),
    db.from('journal').select('kcal, type_repas').eq('date', dateISO()),
  ])
  if (!recettes) return
  if (rMenu.error) { gererErreur(rMenu.error, 'Impossible de charger le menu.'); return }
  noterJournalDuJour(rJour.data)
  menuActuel = rMenu.data
  repasMenu = []
  coursesMenu = []
  if (menuActuel) {
    const [rR, rC] = await Promise.all([
      db.from('menu_repas').select('*').eq('menu_id', menuActuel.id).order('date'),
      db.from('courses').select('*').eq('menu_id', menuActuel.id),
    ])
    if (rR.error) { gererErreur(rR.error); return }
    repasMenu = rR.data || []
    coursesMenu = rC.data || []
  }
  afficherMenus()
}

function afficherMenus() {
  const el = document.getElementById('menus-contenu')
  const lundiCourant = lundiDe()
  const lundiSuivant = decalerDate(lundiCourant, 7)
  const nbProposables = _recettes ? [...(_recettes.keys())].filter(id => recettePourProfil(id)?.ok).length : 0

  let html = `
    <div class="segmente segmente-large" style="margin-bottom:var(--sp-4);">
      <button class="${semaineMenu === lundiCourant ? 'active' : ''}" onclick="changerSemaineMenu('${lundiCourant}')">Cette semaine</button>
      <button class="${semaineMenu === lundiSuivant ? 'active' : ''}" onclick="changerSemaineMenu('${lundiSuivant}')">Semaine prochaine</button>
    </div>`

  if (!menuActuel) {
    html += nbProposables === 0 ? `
      <div class="carte">
        <div class="carte-titre">Pas encore de recettes</div>
        <p class="carte-texte">La base de recettes n'est pas encore importée, ou aucune recette ne correspond à tes goûts et à ton temps de cuisine. Les recettes s'importent une fois la table Ciqual disponible (voir le README).</p>
      </div>` : `
      <div class="carte">
        <div class="carte-titre">Préparer le menu de la semaine</div>
        <p class="carte-texte">Le site te propose plusieurs choix pour chaque repas, selon tes goûts, la saison et ton temps de cuisine. Tu choisis, puis tu valides : la liste de courses se fait toute seule.</p>
        <label class="choix choix-case" style="margin:var(--sp-4) 0 var(--sp-2);">
          <input id="menu-pdj" type="checkbox" class="hidden" onchange="this.parentElement.classList.toggle('active', this.checked); this.nextElementSibling.textContent = this.checked ? '✓' : ''" />
          <span class="case"></span>
          <span><span class="choix-titre">Prévoir les petits déjeuners</span><span class="choix-detail">Sinon, leurs calories sont réparties sur les autres repas.</span></span>
        </label>
        <label class="choix choix-case" style="margin-bottom:var(--sp-4);">
          <input id="menu-collation" type="checkbox" class="hidden" onchange="this.parentElement.classList.toggle('active', this.checked); this.nextElementSibling.textContent = this.checked ? '✓' : ''" />
          <span class="case"></span>
          <span><span class="choix-titre">Prévoir une collation par jour</span><span class="choix-detail">Une idée de collation simple et rassasiante.</span></span>
        </label>
        <button class="btn btn-primaire btn-bloc" onclick="creerMenu()">Voir les propositions</button>
        <p class="message-info">${nbProposables} recette${nbProposables > 1 ? 's' : ''} disponible${nbProposables > 1 ? 's' : ''} pour toi.</p>
      </div>`
    el.innerHTML = html
    return
  }

  const fige = menuActuel.statut === 'fige'
  if (fige) {
    const nbCoches = coursesMenu.filter(c => c.coche).length
    html += `
      <div class="segmente segmente-large" style="margin-bottom:var(--sp-4);">
        <button class="${ongletMenus === 'menu' ? 'active' : ''}" onclick="ongletMenus='menu'; afficherMenus()">Menu</button>
        <button class="${ongletMenus === 'courses' ? 'active' : ''}" onclick="ongletMenus='courses'; afficherMenus()">Courses (${nbCoches}/${coursesMenu.length})</button>
      </div>`
  }

  if (fige && ongletMenus === 'courses') { el.innerHTML = html + renduCourses(); return }

  const ajustes = fige ? facteursAjustesAujourdhui() : null
  const jours = [...new Set(repasMenu.map(r => r.date))].sort()
  html += fige ? '' : `<p class="carte-texte" style="margin-bottom:var(--sp-4);">Choisis un plat pour chaque repas (le premier est présélectionné), puis valide le menu en bas de page.</p>`
  for (const jour of jours) {
    const repasJour = repasMenu.filter(r => r.date === jour).sort((a, b) => TYPES_REPAS.findIndex(([t]) => t === a.type_repas) - TYPES_REPAS.findIndex(([t]) => t === b.type_repas))
    const passe = jour < dateISO()
    html += `
      <div class="carte ${jour === dateISO() ? 'carte-aujourdhui avec-etiquette' : ''} ${passe && fige ? 'carte-passee' : ''}" style="position:relative;">
        ${jour === dateISO() ? '<span class="etiquette">Aujourd\'hui</span>' : ''}
        <div class="carte-titre" style="text-transform:capitalize;">${libelleJourCourt(jour)}</div>
        ${repasJour.map(r => fige ? renduRepasFige(r, ajustes) : renduRepasBrouillon(r)).join('')}
      </div>`
  }

  html += fige ? `
      <button class="btn btn-secondaire btn-bloc" onclick="repasserEnPreparation()">Modifier les choix de la semaine</button>`
    : `
      <div class="feuille-actions" style="position:sticky; bottom:calc(var(--nav-h) + var(--safe-bottom) + var(--sp-2));">
        <button class="btn btn-secondaire" onclick="supprimerMenu()">Recommencer</button>
        <button class="btn btn-primaire" onclick="figerMenu()">Valider le menu</button>
      </div>`
  el.innerHTML = html
}

function changerSemaineMenu(lundi) { semaineMenu = lundi; ongletMenus = 'menu'; chargerMenus() }

// ── Création du menu (brouillon) ─────────────────────────────
async function creerMenu() {
  const petitDej = document.getElementById('menu-pdj').checked
  const collation = document.getElementById('menu-collation').checked
  const { data: menu, error } = await db.from('menus')
    .insert({ semaine_debut: semaineMenu, petit_dejeuner: petitDej, avec_collation: collation, statut: 'brouillon' }).select().single()
  if (error) { gererErreur(error, 'Impossible de créer le menu.'); return }

  const types = ['dejeuner', 'diner']
  if (petitDej) types.unshift('petit_dejeuner')
  if (collation) types.push('collation')
  const dejaChoisies = new Map()
  const lignes = []
  for (let j = 0; j < 7; j++) {
    const date = decalerDate(semaineMenu, j)
    if (date < dateISO()) continue // semaine en cours : seulement à partir d'aujourd'hui
    for (const type of types) {
      const propositions = proposer(type, date, dejaChoisies)
      const choisie = propositions[0] || null
      if (choisie) dejaChoisies.set(choisie, (dejaChoisies.get(choisie) || 0) + 1)
      lignes.push({
        menu_id: menu.id, date, type_repas: type, recette_id: choisie, propositions,
        nb_personnes: type === 'dejeuner' || type === 'diner' ? (profil.nb_personnes_defaut || 2) : 1,
      })
    }
  }
  const { error: e2 } = await db.from('menu_repas').insert(lignes)
  if (e2) { gererErreur(e2, 'Impossible de préparer les propositions.'); await db.from('menus').delete().eq('id', menu.id); return }
  chargerMenus()
}

function renduCarteRecetteCourte(id, choisie, onclick) {
  const p = recettePourProfil(id)
  if (!p?.ok) return ''
  return `
    <button type="button" class="option-recette ${choisie ? 'active' : ''}" onclick="${onclick}" aria-pressed="${choisie}">
      <span class="option-nom">${esc(p.recette.nom)}${estFavori(id) ? ` <span class="option-favori">${icone('coeur')} favori</span>` : ''}</span>
      <span class="option-detail">${p.recette.temps_min} min · ${formatNombre(p.nutrition.proteines)} g de protéines par portion${p.remplacements.some(x => x.par) ? ' · adaptée à tes goûts' : ''}</span>
    </button>`
}

function renduRepasBrouillon(r) {
  const options = r.propositions.filter(id => recettePourProfil(id)?.ok)
  return `
    <div class="slot">
      <div class="slot-tete">
        <span class="slot-type">${libelleRepas(r.type_repas)}</span>
        ${renduPersonnes(r)}
      </div>
      <div class="options">
        ${options.map(id => `<div class="option-ligne">
          ${renduCarteRecetteCourte(id, r.recette_id === id, `choisirRecetteSlot('${r.id}', '${id}')`)}
          <button type="button" class="btn btn-secondaire btn-voir" onclick="ouvrirRecette('${r.id}', '${id}')" aria-label="Voir la recette">${icone('oeil')}<span>Voir</span></button>
        </div>`).join('')}
        <button type="button" class="option-recette ${!r.recette_id ? 'active' : ''}" onclick="choisirRecetteSlot('${r.id}', null)">
          <span class="option-nom">Sans recette</span><span class="option-detail">Repas dehors, restes, cantine…</span>
        </button>
      </div>
      <button class="btn btn-lien" onclick="autresPropositions('${r.id}')">Autres idées</button>
    </div>`
}

function renduPersonnes(r) {
  if (!r.recette_id) return ''
  return `<span class="personnes">
    <button class="btn btn-lien" onclick="changerPersonnes('${r.id}', -1)" ${r.nb_personnes <= 1 ? 'disabled' : ''} aria-label="Une personne de moins">−</button>
    ${r.nb_personnes} pers.
    <button class="btn btn-lien" onclick="changerPersonnes('${r.id}', 1)" ${r.nb_personnes >= 8 ? 'disabled' : ''} aria-label="Une personne de plus">+</button>
  </span>`
}

async function majRepas(id, champs) {
  const { error } = await db.from('menu_repas').update(champs).eq('id', id)
  if (error) { gererErreur(error, "Impossible d'enregistrer."); return false }
  Object.assign(repasMenu.find(r => r.id === id), champs)
  return true
}

async function choisirRecetteSlot(id, recetteId) {
  if (await majRepas(id, { recette_id: recetteId })) {
    if (menuActuel.statut === 'fige') await genererCourses()
    rafraichirVuesMenu()
  }
}

// Après une action depuis la page Menus ou la page Aujourd'hui
function rafraichirVuesMenu() {
  if (pageActive === 'menus') afficherMenus()
  else chargerPage(pageActive)
}

async function changerPersonnes(id, delta) {
  const r = repasMenu.find(x => x.id === id)
  if (await majRepas(id, { nb_personnes: Math.min(8, Math.max(1, r.nb_personnes + delta)) })) {
    if (menuActuel.statut === 'fige') await genererCourses()
    afficherMenus()
  }
}

async function autresPropositions(id) {
  const r = repasMenu.find(x => x.id === id)
  const dejaChoisies = new Map()
  repasMenu.forEach(x => x.recette_id && dejaChoisies.set(x.recette_id, (dejaChoisies.get(x.recette_id) || 0) + 1))
  let propositions = proposer(r.type_repas, r.date, dejaChoisies, r.propositions)
  if (!propositions.length) propositions = proposer(r.type_repas, r.date, dejaChoisies) // plus d'autres idées : on reprend tout
  if (!propositions.length) { afficherToast('Pas d\'autre recette pour ce repas avec tes réglages.'); return }
  if (await majRepas(id, { propositions, recette_id: propositions[0] })) afficherMenus()
}

async function supprimerMenu() {
  if (!confirm('Effacer ces propositions et recommencer ?')) return
  const { error } = await db.from('menus').delete().eq('id', menuActuel.id)
  if (error) { gererErreur(error); return }
  chargerMenus()
}

async function figerMenu() {
  if (!repasMenu.some(r => r.recette_id)) { afficherToast('Choisis au moins une recette.', true); return }
  const { error } = await db.from('menus').update({ statut: 'fige' }).eq('id', menuActuel.id)
  if (error) { gererErreur(error, 'Impossible de valider le menu.'); return }
  menuActuel.statut = 'fige'
  await genererCourses()
  afficherToast('Menu validé, voici ta liste de courses')
  ongletMenus = 'courses'
  lancerConfettis(45)
  afficherMenus()
}

async function repasserEnPreparation() {
  const { error } = await db.from('menus').update({ statut: 'brouillon' }).eq('id', menuActuel.id)
  if (error) { gererErreur(error); return }
  menuActuel.statut = 'brouillon'
  afficherMenus()
}

// ── Menu figé ────────────────────────────────────────────────
function renduRepasFige(r, ajustes) {
  const p = r.recette_id ? recettePourProfil(r.recette_id) : null
  const estAujourdhui = r.date === dateISO()
  if (!p?.ok) {
    return `<div class="slot slot-fige">
      <div class="slot-tete"><span class="slot-type">${libelleRepas(r.type_repas)}</span></div>
      <div class="slot-ligne"><span class="option-detail">${r.recette_id ? 'Recette indisponible' : 'Sans recette'}</span>
      <button class="btn btn-lien" onclick="ouvrirChangementRepas('${r.id}')">Choisir</button></div></div>`
  }
  const f = facteurRepas(r, estAujourdhui ? ajustes : null)
  const ajuste = estAujourdhui && ajustes?.has(r.id) && Math.abs(f - facteurPrevu(r)) >= 0.2
  const kcal = Math.round(p.nutrition.kcal * f)
  return `
    <div class="slot slot-fige ${r.mange ? 'slot-mange' : ''}">
      <div class="slot-tete"><span class="slot-type">${libelleRepas(r.type_repas)}</span>${r.mange ? `<span class="badge ico-titre">${icone('coche')} mangé</span>` : ''}</div>
      <button class="option-recette option-fige" onclick="ouvrirRecette('${r.id}')">
        <span class="option-nom">${esc(p.recette.nom)}</span>
        <span class="option-detail">Ta portion : ${formatPortion(f)} ≈ ${formatNombre(kcal)} kcal · ${formatNombre(p.nutrition.proteines * f)} g de protéines${r.nb_personnes > 1 ? ` · + ${r.nb_personnes - 1} pers.` : ''}</span>
        ${ajuste ? `<span class="option-ajuste">Ajustée selon ce que tu as déjà mangé aujourd'hui</span>` : ''}
      </button>
      ${!r.mange ? `<div class="slot-actions">
        <button class="btn btn-lien" onclick="ouvrirChangementRepas('${r.id}')">Changer</button>
        ${r.date <= dateISO() ? `<button class="btn btn-secondaire" onclick="marquerRepasMange('${r.id}')">J'ai mangé ce repas</button>` : ''}
      </div>` : ''}
    </div>`
}

// recetteId : pour voir une proposition du brouillon avant de la choisir
function ouvrirRecette(repasId, recetteId = null) {
  const r0 = repasMenu.find(x => x.id === repasId)
  if (!r0) return
  const r = recetteId ? { ...r0, recette_id: recetteId } : r0
  const p = recettePourProfil(r.recette_id)
  if (!p?.ok) return
  const f = recetteId ? facteurPrevu(r) : facteurRepas(r, r.date === dateISO() ? facteursAjustesAujourdhui() : null)
  const totalPortions = f + Math.max(0, r.nb_personnes - 1)
  const parPortion = g => g / p.recette.portions_base
  ouvrirFeuille(p.recette.nom, `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:var(--sp-3);">
      <p class="message-info" style="margin-top:0;">${p.recette.temps_min} min${p.recette.etiquettes.length ? ' · ' + p.recette.etiquettes.map(e => LIBELLES_ETIQUETTES[e] || e).join(' · ') : ''}</p>
      ${boutonFavori(p.recette.id)}
    </div>
    <div class="reperes">
      <div class="repere"><span class="repere-valeur">${formatNombre(p.nutrition.kcal * f)}</span><span class="repere-unite">kcal pour toi (${formatPortion(f)})</span></div>
      <div class="repere"><span class="repere-valeur">${formatNombre(p.nutrition.proteines * f)} g</span><span class="repere-unite">protéines</span></div>
    </div>
    <div class="carte-titre">Ingrédients · ${formatNombre(totalPortions, totalPortions % 1 ? 1 : 0)} portions${r.nb_personnes > 1 ? ` (toi + ${r.nb_personnes - 1})` : ''}</div>
    ${p.ingredients.map(i => `<div class="ligne"><span>${esc(i.libelle)}</span><span class="ligne-valeur">${formatQuantite(Math.round(parPortion(i.grammes) * totalPortions), i.libelle)}</span></div>`).join('')}
    ${p.remplacements.length ? `<p class="message-info">${p.remplacements.map(x => x.par ? `${esc(x.de)} remplacé par ${esc(x.par)}` : `sans ${esc(x.de)}`).join(' · ')} (selon tes goûts)</p>` : ''}
    <div class="carte-titre" style="margin-top:var(--sp-4);">Préparation</div>
    <ol class="etapes">${p.recette.etapes.map(e => `<li>${esc(e)}</li>`).join('')}</ol>
    <p class="message-info">Ta part : ${formatNombre(parPortion(p.nutrition.grammes) * f)} g environ. Les valeurs viennent de la table Ciqual (ANSES).</p>`)
}

async function ouvrirChangementRepas(repasId) {
  const r = repasMenu.find(x => x.id === repasId)
  const dejaChoisies = new Map()
  repasMenu.forEach(x => x.recette_id && dejaChoisies.set(x.recette_id, (dejaChoisies.get(x.recette_id) || 0) + 1))
  const options = recettesEligibles(r.type_repas, r.date)
    .map(p => ({ p, s: scoreRecette(p, dejaChoisies) })).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.p.recette.id)
  ouvrirFeuille(`Changer · ${libelleRepas(r.type_repas)} ${libelleJourCourt(r.date)}`, `
    <div class="options">
      ${options.map(id => renduCarteRecetteCourte(id, r.recette_id === id, `choisirRecetteSlot('${r.id}', '${id}'); fermerFeuille()`)).join('')}
      <button type="button" class="option-recette ${!r.recette_id ? 'active' : ''}" onclick="choisirRecetteSlot('${r.id}', null); fermerFeuille()">
        <span class="option-nom">Sans recette</span><span class="option-detail">Repas dehors, restes, cantine…</span>
      </button>
    </div>
    <p class="message-info">La liste de courses est mise à jour automatiquement.</p>`)
}

// Ajoute le repas au journal avec la portion conseillée
async function marquerRepasMange(repasId) {
  const r = repasMenu.find(x => x.id === repasId)
  const p = recettePourProfil(r.recette_id)
  if (!p?.ok) return
  const f = facteurRepas(r, r.date === dateISO() ? facteursAjustesAujourdhui() : null)
  const n = p.nutrition
  const v = k => Math.round(n[k] * f * 10) / 10
  const ligne = {
    date: r.date, heure: r.date === dateISO() ? heureActuelle() : (r.type_repas === 'diner' ? '19:30' : r.type_repas === 'dejeuner' ? '12:30' : r.type_repas === 'petit_dejeuner' ? '08:00' : '16:00'),
    type_repas: r.type_repas, source: 'recette', ref: r.recette_id, nom: p.recette.nom,
    quantite_g: Math.max(1, Math.round(n.grammes * f)), repere: `${formatPortion(f)} (≈ ${formatNombre(n.grammes * f)} g)`,
    kcal: Math.round(n.kcal * f), proteines: v('proteines'), glucides: v('glucides'), sucres: v('sucres'),
    sucres_ajoutes: v('sucres_ajoutes'), lipides: v('lipides'), fibres: v('fibres'),
  }
  const { error } = await db.from('journal').insert(ligne)
  if (error) { gererErreur(error, "Impossible d'ajouter au journal."); return }
  await majRepas(repasId, { mange: true })
  if (r.date === dateISO()) { _kcalMangeesAujourdhui += ligne.kcal; _typesMangesAujourdhui.add(r.type_repas) }
  afficherToast(`Ajouté au journal (${formatNombre(ligne.kcal)} kcal)`)
  rafraichirVuesMenu()
}

// ═════════════════════════════════════════════════════════════
// LISTE DE COURSES
// ═════════════════════════════════════════════════════════════
async function genererCourses() {
  const repas = repasMenu.filter(r => r.recette_id).map(r => {
    const p = recettePourProfil(r.recette_id)
    if (!p?.ok) return null
    return { ingredients: p.ingredients, portionsBase: p.recette.portions_base, facteur: facteurPrevu(r), nbPersonnes: r.nb_personnes }
  }).filter(Boolean)
  const lignes = cumulerCourses(repas)

  // On garde les cases déjà cochées et les ajouts manuels
  const cochees = new Set(coursesMenu.filter(c => c.coche && !c.manuel).map(c => c.cle))
  const { error: eDel } = await db.from('courses').delete().eq('menu_id', menuActuel.id).eq('manuel', false)
  if (eDel) { gererErreur(eDel, 'Impossible de mettre à jour la liste de courses.'); return }
  const nouvelles = lignes.map(l => ({ menu_id: menuActuel.id, cle: l.cle, libelle: l.libelle, quantite_g: l.quantite_g, rayon: ORDRE_RAYONS.includes(l.rayon) ? l.rayon : 'Autres', coche: cochees.has(l.cle), manuel: false }))
  if (nouvelles.length) {
    const { error } = await db.from('courses').insert(nouvelles)
    if (error) { gererErreur(error, 'Impossible de créer la liste de courses.'); return }
  }
  const { data } = await db.from('courses').select('*').eq('menu_id', menuActuel.id)
  coursesMenu = data || []
}

function renduCourses() {
  if (!coursesMenu.length) return `<div class="bientot">La liste est vide : choisis des recettes dans le menu.</div>${renduAjoutCourse()}`
  const parRayon = new Map()
  for (const c of coursesMenu) {
    if (!parRayon.has(c.rayon)) parRayon.set(c.rayon, [])
    parRayon.get(c.rayon).push(c)
  }
  const rayons = [...parRayon.keys()].sort((a, b) => ORDRE_RAYONS.indexOf(a) - ORDRE_RAYONS.indexOf(b))
  return rayons.map(rayon => `
    <div class="carte">
      <div class="carte-titre">${esc(rayon)}</div>
      ${parRayon.get(rayon).sort((a, b) => a.coche - b.coche || a.libelle.localeCompare(b.libelle)).map(c => `
        <label class="article ${c.coche ? 'article-coche' : ''}">
          <input type="checkbox" ${c.coche ? 'checked' : ''} onchange="cocherCourse('${c.id}', this.checked)" />
          <span class="article-nom">${esc(c.libelle)}</span>
          <span class="article-qte">${c.quantite_g ? formatQuantite(c.quantite_g, c.libelle) : ''}</span>
          ${c.manuel ? `<button class="btn btn-lien" onclick="event.preventDefault(); supprimerCourse('${c.id}')" aria-label="Retirer">${icone('croix')}</button>` : ''}
        </label>`).join('')}
    </div>`).join('') + renduAjoutCourse() +
    `<p class="message-info">Quantités pour ta portion et une portion standard par autre personne, arrondies. Les ingrédients de base (sel, poivre…) ne sont pas listés.</p>`
}

function renduAjoutCourse() {
  return `<form class="recherche-barre" onsubmit="event.preventDefault(); ajouterCourse()">
    <input id="course-nouvelle" class="input" type="text" placeholder="Ajouter un article (ex. papier toilette)" />
    <button class="btn btn-secondaire" type="submit">Ajouter</button>
  </form>`
}

async function cocherCourse(id, coche) {
  const c = coursesMenu.find(x => x.id === id)
  c.coche = coche
  afficherMenus()
  const { error } = await db.from('courses').update({ coche }).eq('id', id)
  if (error) { c.coche = !coche; gererErreur(error, "La case n'a pas pu être enregistrée."); afficherMenus() }
}

async function ajouterCourse() {
  const libelle = document.getElementById('course-nouvelle').value.trim()
  if (!libelle) return
  const { data, error } = await db.from('courses').insert({ menu_id: menuActuel.id, libelle, rayon: 'Autres', manuel: true }).select().single()
  if (error) { gererErreur(error); return }
  coursesMenu.push(data)
  afficherMenus()
}

async function supprimerCourse(id) {
  const { error } = await db.from('courses').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  coursesMenu = coursesMenu.filter(c => c.id !== id)
  afficherMenus()
}

// ── Menu du jour sur la page Aujourd'hui ─────────────────────
async function chargerMenuDuJour() {
  const el = document.getElementById('aujourdhui-menu')
  if (!el) return
  const auj = dateISO()
  const { data: menu } = await db.from('menus').select('*').eq('semaine_debut', lundiDe()).eq('statut', 'fige').maybeSingle()
  if (!menu) { el.innerHTML = ''; return }
  const [recettes, rR, rJ] = await Promise.all([
    chargerRecettes(),
    db.from('menu_repas').select('*').eq('menu_id', menu.id).eq('date', auj),
    db.from('journal').select('kcal, type_repas').eq('date', auj),
  ])
  if (!recettes || rR.error) return
  // La page Aujourd'hui travaille sur la semaine en cours
  semaineMenu = lundiDe()
  menuActuel = menu
  repasMenu = rR.data || []
  noterJournalDuJour(rJ.data)
  const repasJour = (rR.data || []).filter(r => r.recette_id)
  if (!repasJour.length) { el.innerHTML = ''; return }
  const ajustes = facteursAjustesAujourdhui()
  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Au menu aujourd'hui</div>
      ${repasJour.map(r => renduRepasFige(r, ajustes)).join('')}
    </div>`
}
