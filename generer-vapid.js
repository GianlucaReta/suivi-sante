// ─────────────────────────────────────────────────────────────
// Génère une paire de clés VAPID pour les notifications Web Push.
//   node generer-vapid.js
// - La clé PUBLIQUE va dans app.js (VAPID_PUBLIC_KEY) : elle peut être publiée.
// - La clé PRIVÉE va UNIQUEMENT dans les secrets Supabase (VAPID_PRIVATE_KEY).
//   Ne la colle jamais dans un fichier du dépôt, un message ou une capture d'écran.
// Le script n'écrit aucun fichier : il affiche les clés, à copier tout de suite.
// ─────────────────────────────────────────────────────────────

const { generateKeyPairSync } = require('crypto')

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })

// Clé publique au format attendu par les navigateurs : point non compressé (0x04 || x || y), en base64url
const b64 = s => Buffer.from(s, 'base64url')
const publique = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]).toString('base64url')

console.log('\nClé PUBLIQUE (à mettre dans app.js, et dans le secret VAPID_PUBLIC_KEY) :\n')
console.log(publique)
console.log('\nClé PRIVÉE (seulement dans le secret Supabase VAPID_PRIVATE_KEY, nulle part ailleurs) :\n')
console.log(priv.d)
console.log('\nCes clés ne sont enregistrées nulle part : copie-les maintenant.\n')
