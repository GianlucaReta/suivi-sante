// Tests des règles de santé : node tests/calculs.test.js
const assert = require('node:assert/strict')
const c = require('../calculs.js')

let ok = 0
function test(nom, fn) {
  try { fn(); ok++; console.log('✓', nom) }
  catch (e) { console.error('✗', nom, '\n ', e.message); process.exitCode = 1 }
}

const auj = new Date('2026-11-22T12:00:00')
const profilDepart = {
  sexe: 'femme', date_naissance: '2003-05-10', taille_cm: 166,
  poids_depart: 65, poids_objectif: 55, activite: 'faible',
}

test('âge calculé depuis la date de naissance', () => {
  assert.equal(c.calculerAge('2003-05-10', auj), 23)
  assert.equal(c.calculerAge('2003-11-23', auj), 22) // anniversaire demain
})

test('TMB Mifflin-St Jeor femme 65 kg, 166 cm, 23 ans ≈ 1 411', () => {
  assert.equal(Math.round(c.calculerTmb({ sexe: 'femme', poids: 65, tailleCm: 166, age: 23 })), 1412)
})

test('profil de départ : cible entre 1 450 et 1 550 kcal', () => {
  const o = c.calculerObjectifs(profilDepart, 65, auj)
  assert.ok(o.cible >= 1440 && o.cible <= 1550, `cible = ${o.cible}`)
  assert.equal(o.plancherAtteint, false)
  assert.ok(o.vitesseKgSemaine >= 0.4 && o.vitesseKgSemaine <= 0.5, `vitesse = ${o.vitesseKgSemaine}`)
})

test('protéines : environ 100 à 120 g à 65 kg', () => {
  const p = c.calculerProteines(65)
  assert.deepEqual(p, { min: 105, cible: 110, max: 115 })
})

test('plancher de 1 200 kcal jamais franchi (sédentaire, petit gabarit)', () => {
  const o = c.calculerObjectifs({ ...profilDepart, activite: 'sedentaire', taille_cm: 150, poids_depart: 50, poids_objectif: 45 }, 50, auj)
  assert.equal(o.cible, 1200)
  assert.equal(o.plancherAtteint, true)
  assert.ok(o.vitesseKgSemaine < 0.45)
})

test('déficit plafonné à 25 % de la dépense', () => {
  const r = c.calculerCiblePerte(1700)
  assert.ok(r.deficit <= 1700 * 0.25 + 10)
})

test('projection : environ 22 semaines pour 10 kg', () => {
  const o = c.calculerObjectifs(profilDepart, 65, auj)
  assert.ok(o.semaines >= 20 && o.semaines <= 26, `semaines = ${o.semaines}`)
})

test('recalcul à chaque 2 kg perdus', () => {
  assert.equal(c.besoinRecalcul(65, 63.5), false)
  assert.equal(c.besoinRecalcul(65, 63), true)
  assert.equal(c.besoinRecalcul(65, 66), false)
})

test('alerte rythme trop rapide : deux semaines > 1 kg', () => {
  assert.equal(c.alerteRythmeTropRapide([
    { date: '2026-11-01', poids: 65 }, { date: '2026-11-08', poids: 63.8 }, { date: '2026-11-15', poids: 62.6 },
  ]), true)
  assert.equal(c.alerteRythmeTropRapide([
    { date: '2026-11-01', poids: 65 }, { date: '2026-11-08', poids: 63.8 }, { date: '2026-11-15', poids: 63.3 },
  ]), false)
  assert.equal(c.alerteRythmeTropRapide([{ date: '2026-11-01', poids: 65 }, { date: '2026-11-08', poids: 63 }]), false)
})

test('stabilisation : remontée progressive puis maintien', () => {
  const base = { cibleDepart: 1400, maintien: 1880, dateDebut: '2026-11-01', semaines: 6 }
  const s1 = c.cibleStabilisation(base, new Date('2026-11-03T12:00:00'))
  const s3 = c.cibleStabilisation(base, new Date('2026-11-17T12:00:00'))
  const fin = c.cibleStabilisation(base, new Date('2026-12-20T12:00:00'))
  assert.equal(s1.semaine, 1)
  assert.ok(s1.cible > 1400 && s1.cible < s3.cible)
  assert.equal(fin.terminee, true)
  assert.equal(fin.cible, 1880)
})

test('poids minimum sain (IMC 18,5) à 166 cm ≈ 51 kg', () => {
  assert.equal(c.poidsMinSain(166), 51)
})

test('objectifs nutritionnels cohérents avec la cible', () => {
  const o = c.objectifsNutriments(1460, 110)
  assert.equal(o.lipides, 49)
  assert.ok(Math.abs(o.proteines * 4 + o.lipides * 9 + o.glucides * 4 - 1460) < 10)
  assert.equal(o.sucres, 37)
})

test('repères visuels selon le type d\'aliment', () => {
  assert.equal(c.grammesRepere('poing', 'feculent'), 150)
  assert.equal(c.grammesRepere('poing', 'legume', 0.5), 50)
  assert.equal(c.grammesRepere('cs', 'matiere_grasse', 2), 20)
  assert.equal(c.grammesRepere('paume', 'autre'), 100)
})

test('valeurs pour une quantité et sucres ajoutés', () => {
  const cookie = { kcal: 490, proteines: 6, glucides: 63, sucres: 35, lipides: 23, fibres: 2.5, sucre_ajoute: true }
  const v = c.valeursPourQuantite(cookie, 24)
  assert.equal(v.kcal, 118)
  assert.equal(v.sucres_ajoutes, 8.4)
  const pomme = { kcal: 53, sucres: 10.4, sucre_ajoute: false }
  assert.equal(c.valeursPourQuantite(pomme, 150).sucres_ajoutes, 0)
  const nutella = { kcal: 539, sucres: 56.3, sucres_ajoutes_100g: 52.13 }
  assert.equal(c.valeursPourQuantite(nutella, 15).sucres_ajoutes, 7.8)
})

// ── Menus ────────────────────────────────────────────────────
const poulet = { kcal: 121, proteines: 23, glucides: 0, sucres: 0, lipides: 2.6, fibres: 0 }
const tofu = { kcal: 125, proteines: 13, glucides: 2, sucres: 0.5, lipides: 7, fibres: 1 }
const riz = { kcal: 354, proteines: 7.3, glucides: 78, sucres: 0.3, lipides: 0.9, fibres: 1.4 }
const recette = {
  id: 'r1', portions_base: 2,
  ingredients: [
    { libelle: 'poulet', ciqual_code: 'P', grammes: 240, exclusions: ['viandes:volaille'], aliment: poulet,
      substituts: [{ libelle: 'tofu', ciqual_code: 'T', exclusions: ['legumineuses:tofu'], aliment: tofu }] },
    { libelle: 'riz', ciqual_code: 'R', grammes: 140, exclusions: ['feculents:riz'], aliment: riz },
    { libelle: 'coriandre', ciqual_code: 'C', grammes: 5, exclusions: ['epices:coriandre'], optionnel: true, aliment: { kcal: 23 } },
  ],
}

test('répartition des repas : sans petit déjeuner, ses calories vont aux autres', () => {
  const avec = c.partsDuJour({ petitDejeuner: true, collation: true })
  const sans = c.partsDuJour({ petitDejeuner: false, collation: true })
  assert.ok(Math.abs(Object.values(sans).reduce((a, b) => a + b) - 1) < 1e-9)
  assert.equal(sans.petit_dejeuner, undefined)
  assert.ok(sans.dejeuner > avec.dejeuner && sans.diner > avec.diner)
})

test('exclusions : remplacement, retrait du facultatif, recette écartée', () => {
  const r1 = c.resoudreRecette(recette, ['viandes:volaille', 'epices'])
  assert.equal(r1.ok, true)
  assert.deepEqual(r1.ingredients.map(i => i.libelle), ['tofu', 'riz'])
  assert.deepEqual(r1.remplacements, [{ de: 'poulet', par: 'tofu' }, { de: 'coriandre', par: null }])
  assert.equal(c.resoudreRecette(recette, ['feculents']).ok, false)                       // riz exclu, pas de substitut
  assert.equal(c.resoudreRecette(recette, ['viandes', 'legumineuses:tofu']).ok, false)    // substitut exclu aussi
  assert.equal(c.resoudreRecette(recette, [], [{ libelle: 'riz', ciqual_code: 'R' }]).ok, false) // aliment précis
})

test('ingrédient principal exclu (dans le nom de la recette) : recette écartée, même avec un substitut', () => {
  const curry = { nom: 'Curry de pois chiches aux épinards', portions_base: 2, ingredients: [
    { libelle: 'pois chiches', ciqual_code: 'PC', grammes: 280, exclusions: ['legumineuses:pois_chiches'], aliment: riz,
      substituts: [{ libelle: 'lentilles corail', ciqual_code: 'L', exclusions: ['legumineuses:lentilles'], aliment: riz }] },
    { libelle: 'épinards (frais ou surgelés)', ciqual_code: 'E', grammes: 300, exclusions: ['legumes:epinards'], aliment: riz,
      substituts: [{ libelle: 'courgette', ciqual_code: 'C', exclusions: [], aliment: riz }] },
  ] }
  assert.equal(c.resoudreRecette(curry, ['legumineuses:pois_chiches']).ok, false)
  assert.equal(c.resoudreRecette(curry, ['legumes:epinards']).ok, false)
  assert.equal(c.estIngredientPrincipal({ libelle: 'pavés de saumon' }, 'Saumon, patate douce et brocoli'), true)
  assert.equal(c.estIngredientPrincipal({ libelle: 'huile d\'olive' }, 'Saumon, patate douce et brocoli'), false)
  const salade = { ...curry, nom: 'Salade composée' }
  assert.equal(c.resoudreRecette(salade, ['legumineuses:pois_chiches']).ok, true) // secondaire : remplacé
})

test('recette incomplète (ingrédient sans code Ciqual) jamais proposée', () => {
  const r = { ...recette, ingredients: [...recette.ingredients, { libelle: 'sauce', ciqual_code: null, grammes: 20 }] }
  assert.deepEqual([c.resoudreRecette(r).ok, c.resoudreRecette(r).raison], [false, 'incomplete'])
})

test('nutrition par portion et facteur de portion', () => {
  const n = c.nutritionParPortion(c.resoudreRecette(recette).ingredients, 2)
  assert.equal(Math.round(n.kcal), 394)  // (290 + 496 + 1) / 2, kcal arrondies par ingrédient
  assert.equal(c.facteurPortion(511, n.kcal), 1.3)
  assert.equal(c.facteurPortion(100, 400), 0.5)
  assert.equal(c.facteurPortion(2000, 400), 2)
})

test('adaptation du dîner selon ce qui a déjà été mangé', () => {
  const parts = c.partsDuJour({ petitDejeuner: false, collation: true })
  const normal = c.adapterPortionsRestantes(1460, 0, [{ type: 'diner', kcalParPortion: 450 }], { diner: parts.diner })
  const [d] = c.adapterPortionsRestantes(1460, 1100, [{ type: 'diner', kcalParPortion: 450 }, { type: 'collation', kcalParPortion: 150 }], parts)
  assert.equal(normal[0].kcalVisees, 1460)
  assert.equal(d.kcalVisees, 270)   // 360 kcal restantes, le dîner en prend 30/(30+10)
  assert.equal(d.facteur, 0.6)
})

test('liste de courses : portion de l\'utilisatrice + portions standard des autres', () => {
  const ings = [{ ciqual_code: 'R', libelle: 'riz', grammes: 140, rayon: 'Épicerie salée' }]
  const l = c.cumulerCourses([
    { ingredients: ings, portionsBase: 2, facteur: 1.2, nbPersonnes: 2 },  // 70 × 2,2 = 154
    { ingredients: ings, portionsBase: 2, facteur: 0.8, nbPersonnes: 1 },  // 70 × 0,8 = 56
  ])
  assert.deepEqual(l, [{ cle: 'R', libelle: 'riz', rayon: 'Épicerie salée', quantite_g: 210 }])
})

// ── Sport ────────────────────────────────────────────────────
const { exercices: EXOS } = require('../exercices.json')
const INTERDITS = /crunch|sit.?up|relev[ée] de buste|superman|v-up|russian|roue|pique|burpee|au-dessus de la t[eê]te/i

test('aucun exercice interdit pour la nuque dans la présélection', () => {
  for (const e of EXOS) assert.ok(!INTERDITS.test(e.nom), e.nom)
})

test('matériel : exercices au sol seulement avec le tapis', () => {
  const sansTapis = c.exercicesDisponibles(EXOS, { elastique: true, tapis: false })
  assert.ok(sansTapis.length > 10)
  assert.ok(sansTapis.every(e => e.materiel === 'aucun' || e.materiel === 'elastique'))
  assert.ok(c.exercicesDisponibles(EXOS, { elastique: true, tapis: true }).some(e => e.id === 'dead-bug'))
})

test('séance de 20 à 30 min, reproductible, sans doublon', () => {
  for (const duree of [20, 25, 30]) for (const type of ['A', 'B']) for (const materiel of [{ elastique: true }, { elastique: true, tapis: true }]) {
    const s = c.construireSeance({ exercices: EXOS, materiel, type, dureeMin: duree, graine: 'abc' + duree + type })
    assert.ok(s.dureeMin <= duree + 1 && s.dureeMin >= duree - 8, `${type} ${duree} min → ${s.dureeMin} min`)
    assert.ok(s.tours >= 2 && s.tours <= 4)
    const ids = [...s.echauffement, ...s.circuit].map(x => x.exercice.id)
    assert.equal(new Set(ids).size, ids.length)
  }
  const a = c.construireSeance({ exercices: EXOS, materiel: { elastique: true }, graine: 'meme' })
  const b = c.construireSeance({ exercices: EXOS, materiel: { elastique: true }, graine: 'meme' })
  assert.deepEqual(a.circuit.map(x => x.exercice.id), b.circuit.map(x => x.exercice.id))
})

test('progression des répétitions : +2 par niveau, au plus le double', () => {
  const squat = { mode: 'reps', base: 12 }
  assert.deepEqual([1, 2, 5, 20].map(n => c.valeurExercice(squat, n)), [12, 14, 20, 24])
  assert.equal(c.valeurExercice({ mode: 'duree', base: 20 }, 3), 30)
})

test('planning : séances réparties sur les jours possibles', () => {
  assert.deepEqual(c.joursDeSeance([1, 2, 3, 4, 5, 6, 7], 3), [1, 3, 5])
  assert.deepEqual(c.joursDeSeance([1, 3, 5], 3), [1, 3, 5])
  assert.deepEqual(c.joursDeSeance([2, 4, 6, 7], 3), [2, 4, 6])
})

test('report : prochain jour libre de la semaine, sinon abandon sans pénalité', () => {
  const lundi = '2026-11-16'
  const seances = [
    { id: 'a', semaine_debut: lundi, date_prevue: '2026-11-16', statut: 'prevue' },  // lundi raté
    { id: 'b', semaine_debut: lundi, date_prevue: '2026-11-18', statut: 'prevue' },  // mercredi
    { id: 'c', semaine_debut: lundi, date_prevue: '2026-11-20', statut: 'faite' },   // vendredi
  ]
  // On est mardi : la séance de lundi va mardi (jour possible ? non → premier jour libre)
  assert.deepEqual(c.reporterSeances(seances, '2026-11-17', [1, 3, 5]), [{ id: 'a', date_prevue: '2026-11-17' }])
  // On est jeudi, lundi et mercredi ratés : samedi et dimanche restent libres (vendredi est occupé)
  assert.deepEqual(c.reporterSeances(seances, '2026-11-19', [1, 3, 5, 6]), [
    { id: 'a', date_prevue: '2026-11-21' }, { id: 'b', date_prevue: '2026-11-19' }])
  // Semaine terminée : abandon
  assert.deepEqual(c.reporterSeances(seances, '2026-11-23', [1, 3, 5]), [{ id: 'a', statut: 'abandonnee' }, { id: 'b', statut: 'abandonnee' }])
})

test('progression toutes les deux semaines, jamais après une séance difficile', () => {
  const faites = [{ date_prevue: '2026-11-02', ressenti: 'facile' }, { date_prevue: '2026-11-05', ressenti: 'correct' }, { date_prevue: '2026-11-09', ressenti: 'correct' }]
  const base = { niveau: 1, dateNiveau: '2026-11-01', seancesParSemaine: 3 }
  assert.equal(c.verifierProgression({ ...base, seancesFaites: faites, aujourdhui: '2026-11-10' }).monter, false)
  assert.equal(c.verifierProgression({ ...base, seancesFaites: faites, aujourdhui: '2026-11-16' }).monter, true)
  assert.equal(c.verifierProgression({ ...base, seancesFaites: [...faites, { date_prevue: '2026-11-12', ressenti: 'difficile' }], aujourdhui: '2026-11-16' }).raison, 'difficile')
  assert.equal(c.verifierProgression({ ...base, seancesFaites: faites.slice(0, 1), aujourdhui: '2026-11-16' }).raison, 'pas assez de séances')
})

// ── Suivi ────────────────────────────────────────────────────
test('dépense ajustée : 50 % des calories actives par défaut', () => {
  assert.equal(c.depenseAjustee(1400, 500), 1650)
  assert.equal(c.depenseAjustee(1400, 500, 30), 1550)
  assert.equal(c.depenseAjustee(null, null), null)
})

test('message du soir jamais culpabilisant', () => {
  const surplus = c.messageDuSoir({ deficit: -300, proteinesAtteintes: false, kcalMangees: 2000 })
  assert.ok(/normal|aucun souci/i.test(surplus), surplus)
  assert.ok(!/(mauvais|échec|raté|trop mangé|honte)/i.test(surplus))
  assert.ok(/protéines/i.test(c.messageDuSoir({ deficit: 400, proteinesAtteintes: true, kcalMangees: 1400 })))
})

test('phase du cycle estimée', () => {
  const cycles = [{ date_debut: '2026-09-01', duree_regles: 5 }, { date_debut: '2026-09-29', duree_regles: 5 }, { date_debut: '2026-10-27', duree_regles: 5 }]
  assert.equal(c.phaseCycle(cycles, '2026-10-28').phase, 'regles')
  assert.equal(c.phaseCycle(cycles, '2026-11-02').phase, 'folliculaire')
  assert.equal(c.phaseCycle(cycles, '2026-11-09').phase, 'ovulation')   // jour 14 d'un cycle de 28 jours
  assert.equal(c.phaseCycle(cycles, '2026-11-18').phase, 'luteale')
  assert.equal(c.phaseCycle(cycles, '2026-11-18').longueur, 28)
  assert.equal(c.phaseCycle(cycles, '2026-08-01'), null)
})

test('série sans craquage et record', () => {
  const s = c.serieSansCraquage(['2026-11-10', '2026-11-18'], '2026-11-22', '2026-11-01')
  assert.deepEqual(s, { actuelle: 4, record: 9 })   // du 19 au 22 ; record du 1er au 9
  assert.equal(c.serieSansCraquage(['2026-11-22'], '2026-11-22', '2026-11-01').actuelle, 0)
})

test('moments et déclencheurs fréquents des envies', () => {
  const env = [
    { moment: '2026-11-20T21:10:00', declencheur: 'ennui', satisfaite: true },
    { moment: '2026-11-21T20:30:00', declencheur: 'ennui', satisfaite: false },
    { moment: '2026-11-21T16:30:00', declencheur: 'fatigue', satisfaite: false },
  ]
  const a = c.analyserEnvies(env)
  assert.deepEqual(a.moments[0], ['soir', 2])
  assert.deepEqual(a.declencheurs[0], ['ennui', 2])
  assert.equal(a.satisfaites, 1)
})

test('lien sommeil court / envies seulement si les données le montrent', () => {
  const bilans = [], envies = []
  for (let i = 1; i <= 10; i++) {
    const d = `2026-11-${String(i).padStart(2, '0')}`
    const court = i % 2 === 0
    bilans.push({ date: d, sommeil_min: court ? 360 : 480 })
    for (let k = 0; k < (court ? 3 : 1); k++) envies.push({ moment: `${d}T20:00:00` })
  }
  const l = c.lienSommeilEnvies(bilans, envies)
  assert.deepEqual([l.moyCourt, l.moyLong], [3, 1])
  assert.equal(c.lienSommeilEnvies(bilans.slice(0, 4), envies), null)   // pas assez de jours
})

test('sucres ajoutés : semaine comparée aux 4 précédentes', () => {
  const lignes = [{ date: '2026-11-21', sucres_ajoutes: 20 }, { date: '2026-11-20', sucres_ajoutes: 10 }, { date: '2026-11-05', sucres_ajoutes: 40 }]
  assert.deepEqual(c.moyennesSucresAjoutes(lignes, '2026-11-22'), { semaine: 15, avant: 40 })
})

// ── Graphiques et bilans ─────────────────────────────────────
test('projection : arrivée à l\'objectif au rythme réel', () => {
  const pesees = [{ date: '2026-10-25', poids: 65 }, { date: '2026-11-01', poids: 64.5 }, { date: '2026-11-08', poids: 64 }, { date: '2026-11-15', poids: 63.5 }, { date: '2026-11-22', poids: 63 }]
  const p = c.projectionObjectif(pesees, 55, '2026-11-22')
  assert.equal(p.parSemaine, 0.5)
  assert.equal(p.jours, 112)   // 8 kg à 0,5 kg/semaine = 16 semaines
  assert.equal(p.date, '2027-03-14')
  assert.equal(c.projectionObjectif(pesees.slice(-1), 55, '2026-11-22').raison, 'pas assez de pesées')
  assert.equal(c.projectionObjectif([{ date: '2026-11-01', poids: 63 }, { date: '2026-11-22', poids: 63.4 }], 55, '2026-11-22').raison, 'stable')
})

test('bilan de la semaine : points forts, tendance sucre, conseil', () => {
  const jours = Array.from({ length: 7 }, (_, i) => ({ kcal: 1450, proteines: i < 2 ? 110 : 70, sommeil_min: 480, sucreries: i === 0 ? 1 : 0, enviesPassees: i === 3 ? 1 : 0 }))
  const b = c.bilanSemaine({ jours, cibleKcal: 1460, cibleProteines: 110, seancesFaites: 3, seancesPrevues: 3, sucreriesAvant: 4, poidsDebut: 63.5, poidsFin: 63 })
  assert.equal(b.pointsForts[0], 'Toutes tes séances faites (3/3) 💪')
  assert.equal(b.pointsForts[1], '-0,5 kg sur la semaine')
  assert.ok(/En baisse/.test(b.tendanceSucre))
  assert.ok(/protéines/.test(b.conseil))
  const vide = c.bilanSemaine({ jours: [], seancesFaites: 0, seancesPrevues: 0 })
  assert.equal(vide.pointsForts.length, 1)
  assert.ok(!/(échec|raté|mauvais)/i.test(JSON.stringify(vide)))
})

console.log(`\n${ok} test(s) réussi(s)`)
