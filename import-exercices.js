// ─────────────────────────────────────────────────────────────
// Import des exercices : lit exercices.json, récupère les images et leurs crédits
// sur l'API gratuite wger, et génère exercices-import.sql (à exécuter dans le SQL Editor).
//   node import-exercices.js
// Affiche aussi les exercices sans image (une image de remplacement est utilisée).
// ─────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

const { exercices } = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercices.json'), 'utf8'))
const q = s => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`
const tab = a => `ARRAY[${(a || []).map(q).join(',')}]::text[]`

async function infosWger(id) {
  const r = await fetch(`https://wger.de/api/v2/exerciseinfo/${id}/?format=json`, { headers: { 'User-Agent': 'SuiviSante/0.5 (usage personnel)' } })
  if (!r.ok) throw new Error(`wger ${id} : HTTP ${r.status}`)
  const e = await r.json()
  const img = (e.images || []).sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0))[0]
  return img ? {
    url: img.image,
    credit: `${img.license_author || e.license_author || 'wger'} · ${img.license_title || 'CC BY-SA'} · wger.de`,
  } : null
}

async function main() {
  const sansImage = []
  const erreurs = []
  const lignes = []
  const ids = new Set()
  for (const ex of exercices) {
    if (ids.has(ex.id)) { erreurs.push(`${ex.id} : identifiant en double`); continue }
    ids.add(ex.id)
    let image = null
    if (ex.wger_id) {
      try { image = await infosWger(ex.wger_id) } catch (e) { erreurs.push(`${ex.id} : ${e.message}`) }
    }
    if (!image) sansImage.push(`${ex.nom}${ex.wger_id ? ` (wger ${ex.wger_id} sans image)` : ' (absent de wger)'}`)
    lignes.push(`(${q(ex.id)}, ${q(ex.nom)}, ${ex.wger_id ?? 'NULL'}, ${q(ex.materiel)}, ${q(ex.zone)}, ${q(ex.mode)}, ${Number(ex.base)}, ${ex.cote ? 'true' : 'false'}, ${tab(ex.consignes)}, ${q(image?.url)}, ${q(image?.credit)}, true)`)
  }
  const sql = [
    '-- Généré par import-exercices.js : ne pas modifier à la main (modifier exercices.json puis relancer).',
    'BEGIN;',
    'INSERT INTO public.exercices (id, nom, wger_id, materiel, zone, mode, base, cote, consignes, image_url, image_credit, actif) VALUES',
    '  ' + lignes.join(',\n  '),
    'ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, wger_id = EXCLUDED.wger_id, materiel = EXCLUDED.materiel, zone = EXCLUDED.zone,',
    '  mode = EXCLUDED.mode, base = EXCLUDED.base, cote = EXCLUDED.cote, consignes = EXCLUDED.consignes,',
    '  image_url = EXCLUDED.image_url, image_credit = EXCLUDED.image_credit, actif = true;',
    `UPDATE public.exercices SET actif = false WHERE id NOT IN (${[...ids].map(q).join(',')});`,
    'COMMIT;',
  ]
  fs.writeFileSync(path.join(__dirname, 'exercices-import.sql'), sql.join('\n') + '\n', 'utf8')
  console.log(`✓ ${exercices.length} exercices → exercices-import.sql`)
  console.log(`  ${exercices.length - sansImage.length} avec image wger, ${sansImage.length} avec l'image de remplacement :`)
  sansImage.forEach(s => console.log('   - ' + s))
  if (erreurs.length) { console.log('  Erreurs :'); erreurs.forEach(e => console.log('   ! ' + e)) }
}

main().catch(e => { console.error(e); process.exit(1) })
