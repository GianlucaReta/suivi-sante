// ─────────────────────────────────────────────────────────────
// Règles de santé : calculs purs, sans affichage ni base de données.
// Testables à part : node tests/calculs.test.js
// ─────────────────────────────────────────────────────────────

const REGLES = {
  PLANCHER_KCAL: 1200,          // le site ne propose jamais moins
  VITESSE_CIBLE_KG: 0.45,       // perte visée par semaine (entre 0,4 et 0,5)
  KCAL_PAR_KG: 7700,            // énergie d'un kilo de masse grasse
  DEFICIT_MAX_PCT: 0.25,        // déficit jamais supérieur à 25 % de la dépense
  PROTEINES_G_KG: { min: 1.6, cible: 1.7, max: 1.8 },
  RECALCUL_TOUS_LES_KG: 2,      // nouvelle cible à chaque 2 kg perdus
  ALERTE_PERTE_KG_SEMAINE: 1,   // au-delà, deux semaines de suite : rythme trop rapide
  IMC_MIN_OBJECTIF: 18.5,       // pas d'objectif sous un IMC sain
}

const NIVEAUX_ACTIVITE = {
  sedentaire: { facteur: 1.2,   libelle: 'Sédentaire',      detail: 'Assise la plupart du temps, peu de marche' },
  faible:     { facteur: 1.375, libelle: 'Activité faible', detail: 'Un peu de marche au quotidien, peu ou pas de sport' },
  moderee:    { facteur: 1.55,  libelle: 'Activité modérée', detail: 'Souvent debout ou en mouvement, ou sport 3 à 5 fois par semaine' },
  elevee:     { facteur: 1.725, libelle: 'Activité élevée', detail: 'Métier physique, ou sport intense presque tous les jours' },
}

function arrondir(n, pas = 1) { return Math.round(n / pas) * pas }

function calculerAge(dateNaissance, aujourdhui = new Date()) {
  if (!dateNaissance) return null
  const n = new Date(dateNaissance + 'T12:00:00')
  let age = aujourdhui.getFullYear() - n.getFullYear()
  const m = aujourdhui.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && aujourdhui.getDate() < n.getDate())) age--
  return age
}

function calculerImc(poids, tailleCm) {
  if (!poids || !tailleCm) return null
  const t = tailleCm / 100
  return poids / (t * t)
}

// Poids minimum pour rester à un IMC sain, arrondi au demi-kilo supérieur
function poidsMinSain(tailleCm) {
  const t = tailleCm / 100
  return Math.ceil(REGLES.IMC_MIN_OBJECTIF * t * t * 2) / 2
}

// Métabolisme de base, formule de Mifflin-St Jeor (kcal/jour)
function calculerTmb({ sexe, poids, tailleCm, age }) {
  const base = 10 * poids + 6.25 * tailleCm - 5 * age
  return base + (sexe === 'homme' ? 5 : -161)
}

// Dépense quotidienne estimée = TMB × facteur d'activité
function calculerDepense(tmb, activite) {
  const niveau = NIVEAUX_ACTIVITE[activite] || NIVEAUX_ACTIVITE.faible
  return tmb * niveau.facteur
}

// Cible calorique de perte : déficit pour ~0,45 kg/semaine, plafonné à 25 %, plancher 1 200
function calculerCiblePerte(depense) {
  const deficitVoulu = REGLES.VITESSE_CIBLE_KG * REGLES.KCAL_PAR_KG / 7
  const deficit = Math.min(deficitVoulu, depense * REGLES.DEFICIT_MAX_PCT)
  const brute = depense - deficit
  const cible = Math.max(REGLES.PLANCHER_KCAL, arrondir(brute, 10))
  const deficitReel = Math.max(0, depense - cible)
  return {
    cible,
    deficit: arrondir(deficitReel),
    plancherAtteint: brute < REGLES.PLANCHER_KCAL,
    vitesseKgSemaine: deficitReel * 7 / REGLES.KCAL_PAR_KG,
  }
}

function calculerProteines(poids) {
  const p = REGLES.PROTEINES_G_KG
  return {
    min: arrondir(poids * p.min, 5),
    cible: arrondir(poids * p.cible, 5),
    max: arrondir(poids * p.max, 5),
  }
}

// Calcul complet à partir du profil et du poids actuel
function calculerObjectifs(profil, poidsActuel, aujourdhui = new Date()) {
  const age = calculerAge(profil.date_naissance, aujourdhui)
  const poids = Number(poidsActuel ?? profil.poids_depart)
  const tailleCm = Number(profil.taille_cm)
  if (!age || !poids || !tailleCm) return null

  const tmb = calculerTmb({ sexe: profil.sexe || 'femme', poids, tailleCm, age })
  const depense = calculerDepense(tmb, profil.activite)
  const perte = calculerCiblePerte(depense)
  const proteines = calculerProteines(poids)

  const objectif = Number(profil.poids_objectif)
  const resteKg = objectif ? Math.max(0, poids - objectif) : null
  const semaines = resteKg !== null && perte.vitesseKgSemaine > 0 ? Math.ceil(resteKg / perte.vitesseKgSemaine) : null
  const dateEstimee = semaines !== null ? new Date(aujourdhui.getTime() + semaines * 7 * 86400000) : null

  return {
    age,
    poids,
    tmb: arrondir(tmb),
    depense: arrondir(depense),
    maintien: arrondir(depense, 10),
    cible: perte.cible,
    deficit: perte.deficit,
    plancherAtteint: perte.plancherAtteint,
    vitesseKgSemaine: Math.round(perte.vitesseKgSemaine * 100) / 100,
    proteines,
    imc: calculerImc(poids, tailleCm),
    resteKg,
    semaines,
    dateEstimee,
  }
}

// Recalcul de la cible : à chaque 2 kg perdus depuis le dernier calcul
function besoinRecalcul(poidsReference, poidsActuel) {
  if (!poidsReference || !poidsActuel) return false
  return poidsReference - poidsActuel >= REGLES.RECALCUL_TOUS_LES_KG - 1e-9
}

// Alerte douce : perte > 1 kg par semaine, deux semaines de suite.
// pesees : [{ date: 'AAAA-MM-JJ', poids }] triées ou non.
function alerteRythmeTropRapide(pesees) {
  const p = [...pesees].filter(x => x && x.poids).sort((a, b) => a.date.localeCompare(b.date))
  if (p.length < 3) return false
  const [a, b, c] = p.slice(-3)
  const parSemaine = (x, y) => {
    const jours = (new Date(y.date) - new Date(x.date)) / 86400000
    if (jours < 4) return 0   // pesées trop rapprochées : pas de conclusion
    return (x.poids - y.poids) / (jours / 7)
  }
  return parSemaine(a, b) > REGLES.ALERTE_PERTE_KG_SEMAINE && parSemaine(b, c) > REGLES.ALERTE_PERTE_KG_SEMAINE
}

// Stabilisation : remontée progressive de la cible jusqu'au maintien, sur N semaines
function cibleStabilisation({ cibleDepart, maintien, dateDebut, semaines = 6 }, aujourdhui = new Date()) {
  const debut = new Date(dateDebut + 'T12:00:00')
  const semaineEnCours = Math.max(0, Math.floor((aujourdhui - debut) / (7 * 86400000)))
  if (semaineEnCours >= semaines) return { cible: arrondir(maintien, 10), semaine: semaines, terminee: true }
  const part = (semaineEnCours + 1) / semaines
  const cible = cibleDepart + (maintien - cibleDepart) * part
  return { cible: Math.max(REGLES.PLANCHER_KCAL, arrondir(cible, 10)), semaine: semaineEnCours + 1, terminee: false }
}

// ── Objectifs nutritionnels du jour (en regard des totaux) ───
// Lipides ≈ 30 % des calories, glucides = le reste, fibres 30 g, sucres : repère max 10 % des calories.
function objectifsNutriments(cibleKcal, proteinesG) {
  const lipides = arrondir(cibleKcal * 0.30 / 9)
  const glucides = Math.max(0, arrondir((cibleKcal - proteinesG * 4 - lipides * 9) / 4))
  return {
    kcal: cibleKcal,
    proteines: proteinesG,
    glucides,
    sucres: arrondir(cibleKcal * 0.10 / 4),
    lipides,
    fibres: 30,
  }
}

// ── Repères visuels → grammes approximatifs, selon le type d'aliment ─
const REPERES_VISUELS = {
  paume:    { libelle: 'Paume',            aide: 'Taille et épaisseur de ta paume, sans les doigts', g: { viande_poisson: 100, defaut: 100 } },
  poing:    { libelle: 'Poing',            aide: 'Volume de ton poing fermé', g: { feculent: 150, legume: 100, fruit: 130, laitier: 150, defaut: 120 } },
  cs:       { libelle: 'Cuillère à soupe', aide: 'Cuillère bombée', g: { matiere_grasse: 10, defaut: 15 } },
  cc:       { libelle: 'Cuillère à café',  aide: 'Cuillère rase', g: { matiere_grasse: 4, defaut: 5 } },
  assiette: { libelle: 'Assiette',         aide: 'Assiette plate bien remplie', g: { legume: 250, feculent: 250, defaut: 300 } },
}

function grammesRepere(repere, categorie, nombre = 1) {
  const r = REPERES_VISUELS[repere]
  if (!r) return null
  return arrondir((r.g[categorie] ?? r.g.defaut) * nombre)
}

// Valeurs pour une quantité, à partir des valeurs pour 100 g
function valeursPourQuantite(pour100, grammes) {
  const f = grammes / 100
  const v = k => Math.round((Number(pour100[k]) || 0) * f * 10) / 10
  const sucres = v('sucres')
  return {
    kcal: Math.round((Number(pour100.kcal) || 0) * f),
    proteines: v('proteines'),
    glucides: v('glucides'),
    sucres,
    sucres_ajoutes: pour100.sucres_ajoutes_100g != null ? v('sucres_ajoutes_100g') : (pour100.sucre_ajoute ? sucres : 0),
    lipides: v('lipides'),
    fibres: v('fibres'),
  }
}

// ═════════════════════════════════════════════════════════════
// MENUS : répartition, portions, exclusions, courses
// ═════════════════════════════════════════════════════════════

// Part des calories du jour par repas. Sans petit déjeuner, ses calories vont aux autres repas.
const PARTS_REPAS = { petit_dejeuner: 25, dejeuner: 35, diner: 30, collation: 10 }

function partsDuJour({ petitDejeuner = true, collation = true } = {}) {
  const actifs = Object.entries(PARTS_REPAS).filter(([t]) => (t !== 'petit_dejeuner' || petitDejeuner) && (t !== 'collation' || collation))
  const total = actifs.reduce((s, [, p]) => s + p, 0)
  return Object.fromEntries(actifs.map(([t, p]) => [t, p / total]))
}

// Un ingrédient est exclu si son aliment, son groupe ou son code Ciqual est dans les exclusions du profil
function ingredientExclu(ing, exclusions = [], exclusionsAliments = []) {
  const cles = ing.exclusions || []
  if (cles.some(c => exclusions.includes(c) || exclusions.includes(c.split(':')[0]))) return true
  return !!ing.ciqual_code && exclusionsAliments.some(a => a.ciqual_code && a.ciqual_code === ing.ciqual_code)
}

// Applique les exclusions : remplacement si possible, sinon retrait d'un ingrédient facultatif,
// sinon la recette n'est pas proposée. Un ingrédient sans code Ciqual rend la recette incomplète.
// Un ingrédient est « principal » s'il donne son nom à la recette (« Curry de pois chiches »).
// S'il est exclu, la recette n'est pas proposée du tout, même avec un remplacement.
const MOTS_GENERIQUES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'au', 'aux', 'a', 'en', 'et', 'ou', 'frais', 'fraiche',
  'fraiches', 'surgeles', 'surgelees', 'pave', 'paves', 'filet', 'filets', 'escalope', 'escalopes', 'tranche', 'tranches', 'rape', 'rapee',
  'cuit', 'cuits', 'cru', 'crus', 'nature', 'naturel', 'boite', 'conserve', 'egoutte', 'egouttes',
  'blanc', 'blancs', 'blanche', 'rouge', 'rouges', 'vert', 'verts', 'verte', 'complet', 'complete', 'completes', 'demi', 'ecreme',
  'leger', 'legere', 'concasse', 'concassees', 'hache', 'haches', 'hachee', 'petit', 'petits', 'gros', 'grosse', 'moyen', 'moyenne'])
function racineMot(m) { return m.replace(/(x|s)$/, '') }
function motsSignificatifs(texte) {
  return String(texte || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(m => m.length >= 3 && !MOTS_GENERIQUES.has(m)).map(racineMot)
}
function estIngredientPrincipal(ing, nomRecette) {
  const mots = motsSignificatifs(ing.libelle)
  if (!mots.length) return false
  const nom = new Set(motsSignificatifs(nomRecette))
  return mots.some(m => nom.has(m))
}

function resoudreRecette(recette, exclusions = [], exclusionsAliments = []) {
  const ingredients = []
  const remplacements = []
  for (const ing of recette.ingredients || []) {
    let retenu = ing
    if (ingredientExclu(ing, exclusions, exclusionsAliments)) {
      if (recette.nom && estIngredientPrincipal(ing, recette.nom)) return { ok: false, raison: 'exclusion', ingredients: [], remplacements }
      const sub = (ing.substituts || []).find(s => s.ciqual_code && !ingredientExclu(s, exclusions, exclusionsAliments))
      if (sub) {
        retenu = { ...ing, libelle: sub.libelle, ciqual_code: sub.ciqual_code, exclusions: sub.exclusions || [], aliment: sub.aliment }
        remplacements.push({ de: ing.libelle, par: sub.libelle })
      } else if (ing.optionnel) {
        remplacements.push({ de: ing.libelle, par: null })
        continue
      } else return { ok: false, raison: 'exclusion', ingredients: [], remplacements }
    }
    if (!retenu.ciqual_code || !retenu.aliment) return { ok: false, raison: 'incomplete', ingredients: [], remplacements }
    ingredients.push(retenu)
  }
  return { ok: ingredients.length > 0, ingredients, remplacements }
}

// Valeurs d'UNE portion standard (recette pour portions_base personnes)
function nutritionParPortion(ingredients, portionsBase) {
  const t = { kcal: 0, proteines: 0, glucides: 0, sucres: 0, sucres_ajoutes: 0, lipides: 0, fibres: 0, grammes: 0 }
  for (const ing of ingredients) {
    const v = valeursPourQuantite(ing.aliment, Number(ing.grammes))
    for (const k in v) t[k] += v[k]
    t.grammes += Number(ing.grammes)
  }
  const n = portionsBase || 1
  for (const k in t) t[k] = Math.round((t[k] / n) * 10) / 10
  return t
}

// Facteur de portion pour atteindre une cible de calories (par pas de 0,1, entre 0,5 et 2)
function facteurPortion(kcalCible, kcalParPortion) {
  if (!kcalParPortion) return 1
  const f = kcalCible / kcalParPortion
  return Math.min(2, Math.max(0.5, Math.round(f * 10) / 10))
}

// Ajustement en cours de journée : ce qui reste à manger est réparti entre les repas encore prévus,
// au prorata de leur part habituelle. Jamais moins d'une demi-portion.
function adapterPortionsRestantes(cibleJour, kcalDejaMangees, repasRestants, parts) {
  const reste = Math.max(0, cibleJour - kcalDejaMangees)
  const totalParts = repasRestants.reduce((s, r) => s + (parts[r.type] || 0), 0)
  return repasRestants.map(r => {
    const kcalVisees = totalParts ? reste * (parts[r.type] || 0) / totalParts : 0
    return { ...r, kcalVisees: Math.round(kcalVisees), facteur: facteurPortion(kcalVisees, r.kcalParPortion) }
  })
}

// Quantités de courses : pour chaque repas prévu, la portion de l'utilisatrice (facteur)
// plus une portion standard par autre personne. Regroupées par aliment.
function cumulerCourses(repas) {
  // repas : [{ ingredients: [{ ciqual_code, libelle, grammes, rayon }], portionsBase, facteur, nbPersonnes }]
  const parCle = new Map()
  for (const r of repas) {
    const portions = (r.facteur || 1) + Math.max(0, (r.nbPersonnes || 1) - 1)
    for (const ing of r.ingredients) {
      const g = Number(ing.grammes) / (r.portionsBase || 1) * portions
      const cle = ing.ciqual_code || ing.libelle
      const l = parCle.get(cle) || { cle, libelle: ing.libelle, rayon: ing.rayon || 'Autres', quantite_g: 0 }
      l.quantite_g += g
      parCle.set(cle, l)
    }
  }
  // Arrondi « courses » : au gramme près sous 50 g, aux 10 g au-delà
  return [...parCle.values()].map(l => ({ ...l, quantite_g: l.quantite_g < 50 ? Math.ceil(l.quantite_g) : Math.ceil(l.quantite_g / 10) * 10 }))
}

// ═════════════════════════════════════════════════════════════
// SPORT : séances, planning avec report, progression
// ═════════════════════════════════════════════════════════════
const SPORT = {
  REPOS_EXERCICE: 20,     // secondes de repos entre deux exercices
  REPOS_TOUR: 60,         // secondes de repos entre deux tours
  ECHAUFFEMENT: 40,       // secondes par exercice d'échauffement
  SECONDES_PAR_REP: 3,
  PROGRESSION_JOURS: 14,  // une progression possible toutes les deux semaines
}

// Générateur pseudo-aléatoire reproductible : une séance garde le même contenu quand on la rouvre
function aleatoireGraine(texte) {
  let h = 1779033703 ^ String(texte).length
  for (let i = 0; i < texte.length; i++) { h = Math.imul(h ^ texte.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

// Exercices faisables avec le matériel coché (les exercices au sol demandent le tapis)
function exercicesDisponibles(exercices, materiel = {}) {
  return exercices.filter(e =>
    e.materiel === 'aucun' ||
    (e.materiel === 'tapis' && materiel.tapis) ||
    (e.materiel === 'elastique' && materiel.elastique) ||
    (e.materiel === 'tapis_elastique' && materiel.tapis && materiel.elastique))
}

// Répétitions ou secondes selon le niveau : +2 répétitions ou +5 s par niveau, au plus le double de la base
function valeurExercice(ex, niveau = 1) {
  const pas = ex.mode === 'reps' ? 2 : 5
  return Math.min(ex.base * 2, ex.base + pas * (niveau - 1))
}

function dureeExercice(ex, valeur) {
  const s = ex.mode === 'reps' ? valeur * SPORT.SECONDES_PAR_REP : valeur
  return ex.cote ? s * 2 : s
}

// Composition d'une séance : échauffement + circuit répété en 2 à 4 tours pour tenir dans la durée choisie.
// Type A : bas du corps ; type B : haut du corps et gainage.
function construireSeance({ exercices, materiel, type = 'A', dureeMin = 25, niveau = 1, graine = 'x' }) {
  const alea = aleatoireGraine(graine)
  const dispo = exercicesDisponibles(exercices, materiel)
  const melanger = liste => liste.map(e => [alea(), e]).sort((a, b) => a[0] - b[0]).map(x => x[1])
  const pris = new Set()
  const prendre = zones => {
    for (const z of zones) {
      const e = melanger(dispo.filter(x => x.zone === z && !pris.has(x.id)))[0]
      if (e) { pris.add(e.id); return e }
    }
    return null
  }

  const echauffement = [prendre(['cardio']), prendre(['cardio', 'jambes'])].filter(Boolean)
  const plan = type === 'A'
    ? [['jambes', 'fessiers'], ['fessiers', 'jambes'], ['gainage'], ['jambes', 'fessiers'], ['haut_du_corps', 'gainage'], ['cardio', 'jambes']]
    : [['haut_du_corps', 'gainage'], ['gainage', 'haut_du_corps'], ['fessiers', 'jambes'], ['haut_du_corps', 'gainage'], ['gainage', 'fessiers'], ['cardio', 'jambes']]
  let circuit = plan.map(prendre).filter(Boolean).map(e => ({ exercice: e, valeur: valeurExercice(e, niveau) }))

  const dureeEch = echauffement.length * SPORT.ECHAUFFEMENT
  const dureeTour = c => c.reduce((s, x) => s + dureeExercice(x.exercice, x.valeur), 0) + SPORT.REPOS_EXERCICE * Math.max(0, c.length - 1)
  const disponible = dureeMin * 60 - dureeEch
  // Si même 2 tours dépassent la durée, on retire des exercices
  while (circuit.length > 3 && 2 * dureeTour(circuit) + SPORT.REPOS_TOUR > disponible) circuit = circuit.slice(0, -1)
  const tours = Math.max(2, Math.min(4, Math.floor((disponible + SPORT.REPOS_TOUR) / (dureeTour(circuit) + SPORT.REPOS_TOUR))))
  const dureeTotale = dureeEch + tours * dureeTour(circuit) + (tours - 1) * SPORT.REPOS_TOUR

  return {
    echauffement: echauffement.map(e => ({ exercice: e, valeur: SPORT.ECHAUFFEMENT, mode: 'duree' })),
    circuit, tours, dureeMin: Math.round(dureeTotale / 60),
  }
}

// Jours de séance de la semaine : n jours répartis parmi les jours possibles (1 = lundi … 7 = dimanche)
function joursDeSeance(joursPossibles, n) {
  const jours = [...joursPossibles].sort((a, b) => a - b)
  if (n >= jours.length) return jours
  const choisis = []
  for (let i = 0; i < n; i++) choisis.push(jours[Math.floor(i * jours.length / n)])
  return [...new Set(choisis)]
}

function dateDuJour(lundi, numeroJour) {
  const d = new Date(lundi + 'T12:00:00')
  d.setDate(d.getDate() + numeroJour - 1)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Report des séances ratées : vers le prochain jour libre de la même semaine (de préférence un jour possible),
// au plus une séance par jour. Si la semaine est finie, la séance est abandonnée, sans pénalité.
// Renvoie la liste des changements à appliquer : { id, date_prevue } ou { id, statut: 'abandonnee' }.
function reporterSeances(seances, aujourdhui, joursPossibles) {
  const changements = []
  const occupes = new Set(seances.filter(s => s.statut !== 'abandonnee').map(s => s.date_prevue))
  const aReporter = seances.filter(s => s.statut === 'prevue' && s.date_prevue < aujourdhui).sort((a, b) => a.date_prevue.localeCompare(b.date_prevue))
  for (const s of aReporter) {
    occupes.delete(s.date_prevue)
    const candidats = []
    for (let j = 1; j <= 7; j++) {
      const d = dateDuJour(s.semaine_debut, j)
      if (d >= aujourdhui && !occupes.has(d)) candidats.push({ d, prefere: joursPossibles.includes(j) })
    }
    const cible = candidats.find(c => c.prefere) || candidats[0]
    if (cible) { occupes.add(cible.d); changements.push({ id: s.id, date_prevue: cible.d }) }
    else changements.push({ id: s.id, statut: 'abandonnee' })
  }
  return changements
}

// Progression lente : environ toutes les deux semaines, si les séances ont été faites
// et jugées faciles ou correctes. Jamais après une séance jugée difficile.
function verifierProgression({ niveau, dateNiveau, seancesFaites, seancesParSemaine, aujourdhui }) {
  const debut = dateNiveau || seancesFaites.map(s => s.date_prevue).sort()[0]
  if (!debut) return { monter: false, raison: 'pas encore de séance' }
  const jours = (new Date(aujourdhui + 'T12:00:00') - new Date(debut + 'T12:00:00')) / 86400000
  if (jours < SPORT.PROGRESSION_JOURS) return { monter: false, raison: 'trop tôt', dans: Math.ceil(SPORT.PROGRESSION_JOURS - jours) }
  const periode = seancesFaites.filter(s => s.date_prevue >= debut)
  if (periode.some(s => s.ressenti === 'difficile')) return { monter: false, raison: 'difficile' }
  if (periode.length < Math.max(2, seancesParSemaine)) return { monter: false, raison: 'pas assez de séances' }
  if (niveau >= 20) return { monter: false, raison: 'niveau maximum' }
  return { monter: true }
}

// ═════════════════════════════════════════════════════════════
// SUIVI : bilan du soir, cycle, sucre
// ═════════════════════════════════════════════════════════════

// Dépense du jour : calories au repos + une part seulement des calories actives de la montre
function depenseAjustee(kcalRepos, kcalActives, pct = 50) {
  if (kcalRepos == null && kcalActives == null) return null
  return Math.round((Number(kcalRepos) || 0) + (Number(kcalActives) || 0) * pct / 100)
}

// Message du soir : choisi par règles, toujours bienveillant
function messageDuSoir({ deficit, proteinesAtteintes, sportFait, sommeilMin, kcalMangees, graine = '' }) {
  const alea = aleatoireGraine('soir' + graine)
  const un = liste => liste[Math.floor(alea() * liste.length)]
  const morceaux = []
  if (kcalMangees === 0) return 'Rien de noté aujourd\'hui dans le journal : ce n\'est pas grave, demain est un autre jour.'
  if (deficit != null && deficit >= 250 && deficit <= 800) morceaux.push(un(['Belle journée, pile dans le bon rythme.', 'Journée réussie : ton déficit est juste comme il faut.', 'Tu avances à un rythme sain, continue comme ça.']))
  else if (deficit != null && deficit > 800) morceaux.push('Grosse dépense aujourd\'hui : pense à bien manger demain pour récupérer.')
  else if (deficit != null && deficit >= 0) morceaux.push(un(['Journée à l\'équilibre, c\'est très bien aussi.', 'Journée stable : la régularité compte plus que la perfection.']))
  else if (deficit != null) morceaux.push(un(['Un peu au-dessus aujourd\'hui, et c\'est normal de temps en temps. C\'est la semaine qui compte.', 'Journée plus gourmande : aucun souci, on reprend le rythme demain.']))
  if (proteinesAtteintes) morceaux.push(un(['Objectif protéines atteint 💪', 'Protéines au rendez-vous, tes muscles te remercient.']))
  if (sportFait) morceaux.push(un(['Et une séance de sport en plus, bravo !', 'Bravo pour la séance du jour.']))
  if (sommeilMin != null && sommeilMin < 390) morceaux.push('Nuit un peu courte : essaie de te coucher plus tôt ce soir, ça aide aussi pour les envies de sucre.')
  return morceaux.join(' ') || 'Merci d\'avoir pris une minute pour faire le point.'
}

// Phase du cycle estimée à partir des débuts de règles saisis
function phaseCycle(cycles, dateIso) {
  const debuts = cycles.map(c => ({ ...c, t: new Date(c.date_debut + 'T12:00:00').getTime() })).sort((a, b) => a.t - b.t)
  const t = new Date(dateIso + 'T12:00:00').getTime()
  const passe = debuts.filter(c => c.t <= t)
  if (!passe.length) return null
  // Durée moyenne des derniers cycles (28 jours par défaut), bornée entre 21 et 40 jours
  const ecarts = []
  for (let i = 1; i < debuts.length; i++) ecarts.push((debuts[i].t - debuts[i - 1].t) / 86400000)
  const recents = ecarts.slice(-6).filter(e => e >= 18 && e <= 45)
  const longueur = Math.round(Math.min(40, Math.max(21, recents.length ? recents.reduce((a, b) => a + b, 0) / recents.length : 28)))
  const dernier = passe.at(-1)
  const jour = Math.floor((t - dernier.t) / 86400000) + 1
  if (jour > longueur + 10) return { jour, longueur, phase: 'inconnue' }   // pas de saisie récente
  const ovulation = longueur - 14
  let phase
  if (jour <= dernier.duree_regles) phase = 'regles'
  else if (jour < ovulation - 1) phase = 'folliculaire'
  else if (jour <= ovulation + 1) phase = 'ovulation'
  else phase = 'luteale'
  const prochaines = new Date(dernier.t + longueur * 86400000)
  return { jour, longueur, phase, prochaines }
}

// Série de jours sans cookie ni chocolat (aujourd'hui compris s'il n'y en a pas encore)
function serieSansCraquage(datesSucreries, aujourdhui, debut) {
  const dates = new Set(datesSucreries)
  const jourMoins = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return dateISOPure(d) }
  let actuelle = 0
  for (let i = 0; ; i++) {
    const d = jourMoins(aujourdhui, i)
    if (d < debut || dates.has(d)) break
    actuelle++
  }
  let record = 0, courant = 0
  for (let d = debut; d <= aujourdhui; d = jourMoins(d, -1)) {
    if (dates.has(d)) courant = 0
    else { courant++; record = Math.max(record, courant) }
  }
  return { actuelle, record }
}
const BADGES_SERIE = [3, 7, 14, 21, 30, 60, 100]

function dateISOPure(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Moments et déclencheurs les plus fréquents des envies
const TRANCHES_HORAIRES = [['matin', 'le matin', 5, 12], ['midi', 'en début d\'après-midi', 12, 16], ['gouter', 'en fin d\'après-midi', 16, 19], ['soir', 'le soir', 19, 23], ['nuit', 'la nuit', 23, 29]]
function analyserEnvies(envies) {
  const moments = {}, declencheurs = {}
  for (const e of envies) {
    let h = new Date(e.moment).getHours()
    if (h < 5) h += 24
    const tr = TRANCHES_HORAIRES.find(([, , a, b]) => h >= a && h < b)
    if (tr) moments[tr[0]] = (moments[tr[0]] || 0) + 1
    if (e.declencheur) declencheurs[e.declencheur] = (declencheurs[e.declencheur] || 0) + 1
  }
  const trier = o => Object.entries(o).sort((a, b) => b[1] - a[1])
  return { moments: trier(moments), declencheurs: trier(declencheurs), total: envies.length,
    satisfaites: envies.filter(e => e.satisfaite === true).length }
}

// Lien sommeil court (< 7 h) / envies de sucre du jour, s'il y a assez de données et un vrai écart
function lienSommeilEnvies(bilans, envies, seuilMin = 420) {
  const parJour = {}
  for (const e of envies) { const d = dateISOPure(new Date(e.moment)); parJour[d] = (parJour[d] || 0) + 1 }
  const court = [], long = []
  for (const b of bilans) {
    if (b.sommeil_min == null) continue
    ;(b.sommeil_min < seuilMin ? court : long).push(parJour[b.date] || 0)
  }
  if (court.length < 4 || long.length < 4) return null
  const moy = a => a.reduce((x, y) => x + y, 0) / a.length
  const mc = moy(court), ml = moy(long)
  if (mc < 0.5 || mc < ml * 1.3) return null
  return { moyCourt: Math.round(mc * 10) / 10, moyLong: Math.round(ml * 10) / 10, joursCourts: court.length, joursLongs: long.length }
}

// Sucres ajoutés : moyenne par jour (jours avec un journal) sur 7 jours, comparée aux 4 semaines précédentes
function moyennesSucresAjoutes(lignesJournal, aujourdhui) {
  const parJour = {}
  for (const l of lignesJournal) parJour[l.date] = (parJour[l.date] || 0) + Number(l.sucres_ajoutes || 0)
  const ilYa = n => { const d = new Date(aujourdhui + 'T12:00:00'); d.setDate(d.getDate() - n); return dateISOPure(d) }
  const moyenne = (de, a) => {
    const jours = Object.keys(parJour).filter(d => d > ilYa(a) && d <= ilYa(de))
    return jours.length ? Math.round(jours.reduce((s, d) => s + parJour[d], 0) / jours.length) : null
  }
  return { semaine: moyenne(0, 7), avant: moyenne(7, 35) }
}

// ═════════════════════════════════════════════════════════════
// GRAPHIQUES ET BILANS
// ═════════════════════════════════════════════════════════════

// Projection de la date d'arrivée à l'objectif, au rythme réel des 6 dernières semaines
// (droite de tendance sur les pesées). null si pas assez de données ou si le poids ne baisse pas.
function projectionObjectif(pesees, objectif, aujourdhui) {
  const fin = new Date(aujourdhui + 'T12:00:00').getTime()
  const points = pesees
    .map(p => ({ x: (new Date(p.date + 'T12:00:00').getTime() - fin) / 86400000, y: Number(p.poids) }))
    .filter(p => p.x >= -42 && p.x <= 0)
  if (points.length < 2) return { raison: 'pas assez de pesées' }
  const etendue = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x))
  if (etendue < 10) return { raison: 'pas assez de recul' }
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const pente = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const poidsAujourdhui = my + pente * (0 - mx)
  const parSemaine = Math.round(-pente * 7 * 100) / 100
  if (pente >= -0.005) return { raison: 'stable', parSemaine }
  if (poidsAujourdhui <= objectif) return { atteint: true, parSemaine }
  const jours = Math.ceil((poidsAujourdhui - objectif) / -pente)
  return { date: dateISOPure(new Date(fin + jours * 86400000)), jours, parSemaine, poidsAujourdhui: Math.round(poidsAujourdhui * 10) / 10 }
}

// Bilan de la semaine (chaque dimanche) : points forts, tendance sucre, conseil. Règles fixes, ton bienveillant.
function bilanSemaine(s) {
  const jours = s.jours || []
  const journal = jours.filter(j => j.kcal > 0)
  const moy = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  const joursProteines = journal.filter(j => s.cibleProteines && j.proteines >= s.cibleProteines * 0.95).length
  const kcalMoy = moy(journal.map(j => j.kcal))
  const nuits = jours.filter(j => j.sommeil_min != null).map(j => j.sommeil_min)
  const sommeilMoy = moy(nuits)
  const sucreries = jours.reduce((a, j) => a + (j.sucreries || 0), 0)
  const enviesPassees = jours.reduce((a, j) => a + (j.enviesPassees || 0), 0)
  const variationPoids = s.poidsDebut != null && s.poidsFin != null ? Math.round((s.poidsFin - s.poidsDebut) * 10) / 10 : null

  const forts = []
  if (s.seancesPrevues > 0 && s.seancesFaites >= s.seancesPrevues) forts.push(`Toutes tes séances faites (${s.seancesFaites}/${s.seancesPrevues}) 💪`)
  else if (s.seancesFaites > 0) forts.push(`${s.seancesFaites} séance${s.seancesFaites > 1 ? 's' : ''} de sport cette semaine`)
  if (variationPoids != null && variationPoids < 0) forts.push(`${String(variationPoids).replace('.', ',')} kg sur la semaine`)
  if (joursProteines >= 4) forts.push(`Objectif protéines atteint ${joursProteines} jours sur 7`)
  if (kcalMoy != null && s.cibleKcal && kcalMoy >= s.cibleKcal - 200 && kcalMoy <= s.cibleKcal + 100) forts.push('Calories bien dans ta cible en moyenne')
  if (journal.length >= 5) forts.push(`Journal rempli ${journal.length} jours sur 7 : la régularité paie`)
  if (sommeilMoy != null && sommeilMoy >= 420) forts.push(`Bonnes nuits : ${Math.floor(sommeilMoy / 60)} h ${String(Math.round(sommeilMoy % 60)).padStart(2, '0')} en moyenne`)
  if (enviesPassees > 0) forts.push(`${enviesPassees} envie${enviesPassees > 1 ? 's' : ''} de sucre passée${enviesPassees > 1 ? 's' : ''} sans craquer`)
  if (!forts.length) forts.push('Tu as pris le temps de suivre ta semaine : c\'est déjà une vraie force.')

  let tendanceSucre
  if (s.sucreriesAvant == null) tendanceSucre = `${sucreries} cookie(s) ou carré(s) de chocolat cette semaine.`
  else if (sucreries < s.sucreriesAvant) tendanceSucre = `En baisse : ${sucreries} cookie(s) ou carré(s) de chocolat, contre ${s.sucreriesAvant} la semaine d'avant. Bravo !`
  else if (sucreries === s.sucreriesAvant) tendanceSucre = `Stable : ${sucreries} cookie(s) ou carré(s) de chocolat, comme la semaine d'avant.`
  else tendanceSucre = `${sucreries} cookie(s) ou carré(s) de chocolat, contre ${s.sucreriesAvant} la semaine d'avant. Pas de quota : on regarde juste la tendance sur plusieurs semaines.`

  let conseil
  if (journal.length >= 3 && joursProteines < 3) conseil = 'Pour la semaine prochaine : ajoute une source de protéines à chaque repas (œufs, fromage blanc, poulet, lentilles…). C\'est ce qui aide le plus à garder les muscles et à avoir moins faim.'
  else if (sommeilMoy != null && sommeilMoy < 390) conseil = 'Pour la semaine prochaine : vise 30 minutes de sommeil en plus. Les nuits courtes augmentent souvent la faim et les envies de sucre.'
  else if (s.seancesPrevues > 0 && s.seancesFaites < s.seancesPrevues / 2) conseil = 'Pour la semaine prochaine : choisis à l\'avance le moment de tes séances, même courtes. 20 minutes suffisent.'
  else if (s.sucreriesAvant != null && sucreries > s.sucreriesAvant) conseil = 'Pour la semaine prochaine : quand une envie arrive, essaie d\'abord une de tes alternatives et attends 10 minutes.'
  else if (journal.length < 4) conseil = 'Pour la semaine prochaine : note tes repas au moins 4 jours, même approximativement. Les repères deviendront plus justes.'
  else conseil = 'Pour la semaine prochaine : garde le même rythme, il te réussit.'

  return { pointsForts: forts.slice(0, 3), tendanceSucre, conseil, kcalMoy: kcalMoy != null ? Math.round(kcalMoy) : null, sommeilMoy, variationPoids }
}

// Export pour les tests Node (ignoré dans le navigateur)
if (typeof module !== 'undefined') {
  module.exports = {
    REGLES, NIVEAUX_ACTIVITE, calculerAge, calculerImc, poidsMinSain, calculerTmb, calculerDepense,
    calculerCiblePerte, calculerProteines, calculerObjectifs, besoinRecalcul, alerteRythmeTropRapide, cibleStabilisation,
    objectifsNutriments, REPERES_VISUELS, grammesRepere, valeursPourQuantite,
    PARTS_REPAS, partsDuJour, ingredientExclu, estIngredientPrincipal, resoudreRecette, nutritionParPortion, facteurPortion,
    adapterPortionsRestantes, cumulerCourses,
    SPORT, aleatoireGraine, exercicesDisponibles, valeurExercice, dureeExercice, construireSeance,
    joursDeSeance, dateDuJour, reporterSeances, verifierProgression,
    depenseAjustee, messageDuSoir, phaseCycle, serieSansCraquage, BADGES_SERIE, analyserEnvies,
    lienSommeilEnvies, moyennesSucresAjoutes, projectionObjectif, bilanSemaine,
  }
}
