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

console.log(`\n${ok} test(s) réussi(s)`)
