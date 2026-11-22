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
function resoudreRecette(recette, exclusions = [], exclusionsAliments = []) {
  const ingredients = []
  const remplacements = []
  for (const ing of recette.ingredients || []) {
    let retenu = ing
    if (ingredientExclu(ing, exclusions, exclusionsAliments)) {
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

// Export pour les tests Node (ignoré dans le navigateur)
if (typeof module !== 'undefined') {
  module.exports = {
    REGLES, NIVEAUX_ACTIVITE, calculerAge, calculerImc, poidsMinSain, calculerTmb, calculerDepense,
    calculerCiblePerte, calculerProteines, calculerObjectifs, besoinRecalcul, alerteRythmeTropRapide, cibleStabilisation,
    objectifsNutriments, REPERES_VISUELS, grammesRepere, valeursPourQuantite,
    PARTS_REPAS, partsDuJour, ingredientExclu, resoudreRecette, nutritionParPortion, facteurPortion,
    adapterPortionsRestantes, cumulerCourses,
  }
}
