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

// Export pour les tests Node (ignoré dans le navigateur)
if (typeof module !== 'undefined') {
  module.exports = {
    REGLES, NIVEAUX_ACTIVITE, calculerAge, calculerImc, poidsMinSain, calculerTmb, calculerDepense,
    calculerCiblePerte, calculerProteines, calculerObjectifs, besoinRecalcul, alerteRythmeTropRapide, cibleStabilisation,
    objectifsNutriments, REPERES_VISUELS, grammesRepere, valeursPourQuantite,
  }
}
