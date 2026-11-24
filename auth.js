// ─────────────────────────────────────────────────────────────
// Connexion par code à 6 chiffres envoyé par e-mail (OTP Supabase)
// Pas de lien magique : sur iPhone il s'ouvrirait dans Safari et pas dans l'app.
// La session est conservée sur l'appareil jusqu'à une déconnexion manuelle.
// ─────────────────────────────────────────────────────────────

let _emailConnexion = ''
let _compteARebours = null
let _appDemarree = false

// ── AFFICHAGE DES ÉCRANS ─────────────────────────────────────
function afficherEcran(nom) {
  // nom : 'chargement' | 'connexion' | 'serveur' | 'app'
  document.getElementById('ecran-chargement').classList.toggle('hidden', nom !== 'chargement')
  document.getElementById('ecran-connexion').classList.toggle('hidden', nom !== 'connexion')
  document.getElementById('ecran-serveur').classList.toggle('hidden', nom !== 'serveur')
  document.getElementById('app').classList.toggle('hidden', nom !== 'app')
}

function afficherMessage(id, texte) {
  const el = document.getElementById(id)
  el.textContent = texte || ''
  el.classList.toggle('hidden', !texte)
}

// ── DÉMARRAGE ────────────────────────────────────────────────
async function demarrerAuth() {
  if (!SUPABASE_CONFIGURE) {
    afficherEcranServeur('Configuration manquante',
      "L'adresse et la clé publique du projet Supabase ne sont pas encore renseignées dans app.js.")
    return
  }

  // Réagit aux connexions / déconnexions (y compris depuis un autre onglet)
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { utilisateur = null; profil = null; _appDemarree = false; afficherConnexion() }
    if (event === 'SIGNED_IN' && session && !_appDemarree) ouvrirApp(session)
  })

  // getSession lit la session enregistrée et la rafraîchit si besoin.
  let res
  try {
    res = await avecDelai(db.auth.getSession(), 12000)
  } catch (e) {
    console.error(e)
    verifierServeur()
    return
  }
  const { data, error } = res
  if (error) {
    console.error(error)
    if (estErreurReseau(error)) { verifierServeur(); return }
  }
  if (data?.session) ouvrirApp(data.session)
  else afficherConnexion()
}

async function ouvrirApp(session) {
  if (_appDemarree) return
  _appDemarree = true
  utilisateur = { id: session.user.id, email: session.user.email }

  afficherEcran('chargement')
  await chargerProfil()
  if (!_appDemarree) return // déconnexion pendant le chargement
  await chargerDernierePesee()   // le poids actuel vient de la dernière pesée
  await verifierPhase()          // fin de la stabilisation éventuelle

  afficherEcran('app')
  const pageDemandee = location.hash.replace('#', '')
  showPage(PAGES.includes(pageDemandee) ? pageDemandee : 'aujourdhui')

  nettoyerPhotosAnciennes()
  nettoyerProduitsAnciens()

  // Premier lancement : questionnaire, en reprenant à la première étape incomplète
  if (profil && !profil.onboarding_fait) {
    const etape = !profil.taille_cm || !profil.date_naissance || !profil.poids_depart ? 'toi'
      : !profil.poids_objectif ? 'objectif' : 'gouts'
    ouvrirQuestionnaire('onboarding', etape)
  }
}

function afficherConnexion() {
  afficherEcran('connexion')
  document.getElementById('connexion-etape-email').classList.remove('hidden')
  document.getElementById('connexion-etape-code').classList.add('hidden')
  afficherMessage('connexion-erreur-email', '')
  try {
    const dernier = localStorage.getItem('ss_dernier_email')
    if (dernier) document.getElementById('connexion-email').value = dernier
  } catch (e) {}
}

// ── ÉTAPE 1 : ENVOI DU CODE ──────────────────────────────────
async function envoyerCode(renvoi = false) {
  const email = renvoi ? _emailConnexion : document.getElementById('connexion-email').value.trim().toLowerCase()
  const zoneErreur = renvoi ? 'connexion-erreur-code' : 'connexion-erreur-email'
  afficherMessage(zoneErreur, '')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    afficherMessage(zoneErreur, "Cette adresse e-mail ne semble pas complète.")
    return
  }
  if (!navigator.onLine) {
    afficherMessage(zoneErreur, "Pas de connexion internet pour l'instant.")
    return
  }

  const btn = document.getElementById(renvoi ? 'btn-renvoyer-code' : 'btn-envoyer-code')
  const texteBtn = btn.textContent
  btn.disabled = true
  btn.textContent = 'Envoi…'

  let error
  try {
    // shouldCreateUser: false → seuls les comptes créés dans Supabase peuvent se connecter
    ;({ error } = await avecDelai(db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }), 15000))
  } catch (e) { error = e }

  btn.disabled = false
  btn.textContent = texteBtn

  if (error) {
    console.error(error)
    afficherMessage(zoneErreur, messageErreurAuth(error))
    if (estErreurReseau(error)) verifierServeur()
    return
  }

  _emailConnexion = email
  try { localStorage.setItem('ss_dernier_email', email) } catch (e) {}

  document.getElementById('connexion-email-affiche').textContent = email
  document.getElementById('connexion-etape-email').classList.add('hidden')
  document.getElementById('connexion-etape-code').classList.remove('hidden')
  document.getElementById('connexion-code').value = ''
  document.getElementById('connexion-code').focus()
  demarrerCompteARebours()
  if (renvoi) afficherToast('Nouveau code envoyé')
}

// Empêche de redemander un code trop vite (limite d'envoi Supabase)
function demarrerCompteARebours(secondes = 60) {
  const btn = document.getElementById('btn-renvoyer-code')
  clearInterval(_compteARebours)
  let reste = secondes
  btn.disabled = true
  btn.textContent = `Renvoyer un code (${reste} s)`
  _compteARebours = setInterval(() => {
    reste--
    if (reste <= 0) {
      clearInterval(_compteARebours)
      btn.disabled = false
      btn.textContent = 'Renvoyer un code'
    } else {
      btn.textContent = `Renvoyer un code (${reste} s)`
    }
  }, 1000)
}

function changerEmail() {
  clearInterval(_compteARebours)
  afficherConnexion()
  document.getElementById('connexion-email').focus()
}

// ── ÉTAPE 2 : VÉRIFICATION DU CODE ───────────────────────────
let _verificationEnCours = false

async function verifierCode() {
  const token = document.getElementById('connexion-code').value.trim()
  afficherMessage('connexion-erreur-code', '')
  if (!/^\d{6}$/.test(token)) {
    afficherMessage('connexion-erreur-code', 'Le code contient 6 chiffres.')
    return
  }
  if (_verificationEnCours) return
  _verificationEnCours = true

  const btn = document.getElementById('btn-verifier-code')
  btn.disabled = true
  btn.textContent = 'Vérification…'

  let data, error
  try {
    ;({ data, error } = await avecDelai(db.auth.verifyOtp({ email: _emailConnexion, token, type: 'email' }), 15000))
  } catch (e) { error = e }

  _verificationEnCours = false
  btn.disabled = false
  btn.textContent = 'Me connecter'

  if (error) {
    console.error(error)
    afficherMessage('connexion-erreur-code', messageErreurAuth(error))
    document.getElementById('connexion-code').select()
    return
  }
  clearInterval(_compteARebours)
  if (data?.session) ouvrirApp(data.session)
}

function messageErreurAuth(error) {
  const msg = String(error?.message || '').toLowerCase()
  const code = error?.code || ''
  if (estErreurReseau(error)) return navigator.onLine
    ? 'Le serveur ne répond pas. Réessaie dans un instant.'
    : "Pas de connexion internet pour l'instant."
  if (error?.status === 429 || code === 'over_email_send_rate_limit' || msg.includes('rate limit') || msg.includes('security purposes'))
    return 'Trop de demandes de code. Attends quelques minutes avant de réessayer.'
  if (code === 'otp_disabled' || code === 'signup_disabled' || msg.includes('signups not allowed') || msg.includes('user not found'))
    return "Cette adresse n'a pas encore de compte."
  if (code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid'))
    return 'Code incorrect ou expiré. Vérifie-le, ou demande un nouveau code.'
  return 'Une erreur est survenue. Réessaie dans un instant.'
}

// ── DÉCONNEXION ──────────────────────────────────────────────
async function deconnexion() {
  if (!confirm('Se déconnecter de cet appareil ?')) return
  // scope 'local' : déconnecte seulement cet appareil, pas les autres
  const { error } = await db.auth.signOut({ scope: 'local' })
  if (error) console.error(error)
  utilisateur = null
  profil = null
  _appDemarree = false
  fermerQuestionnaire()
  fermerFeuille()
  fermerSeanceGuidee()
  history.replaceState(null, '', location.pathname)
  afficherConnexion()
}

// ── SERVEUR INDISPONIBLE (pause du projet gratuit, panne) ────
let _verificationServeurEnCours = false

async function verifierServeur() {
  if (_verificationServeurEnCours) return
  _verificationServeurEnCours = true

  if (!navigator.onLine) {
    _verificationServeurEnCours = false
    afficherEcranServeur('Pas de connexion internet',
      "Ton téléphone ou ton ordinateur n'est pas connecté. Le site se rechargera dès que la connexion revient.")
    return
  }

  let ok = false
  try {
    const r = await avecDelai(fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } }), 10000)
    ok = r.ok
  } catch (e) { ok = false }
  _verificationServeurEnCours = false

  if (ok) {
    // Le serveur répond : erreur passagère
    afficherToast('Connexion au serveur instable. Réessaie dans un instant.', true)
    return
  }
  afficherEcranServeur('Le serveur ne répond pas',
    "Tes données sont en sécurité, mais le serveur ne répond pas pour le moment. " +
    "S'il n'a pas été utilisé depuis une semaine, il s'est mis en veille : il faut le relancer depuis Supabase " +
    "(voir le README, section « Projet en pause »). Sinon, réessaie dans quelques minutes.")
}

function afficherEcranServeur(titre, texte) {
  document.getElementById('serveur-titre').textContent = titre
  document.getElementById('serveur-texte').textContent = texte
  afficherEcran('serveur')
}

function reessayerConnexionServeur() {
  window.location.reload()
}

// ── CONNEXION INTERNET ───────────────────────────────────────
window.addEventListener('offline', () => document.getElementById('bandeau-hors-ligne').classList.remove('hidden'))
window.addEventListener('online', () => {
  document.getElementById('bandeau-hors-ligne').classList.add('hidden')
  // Si l'écran « pas de connexion » était affiché, on recharge
  if (!document.getElementById('ecran-serveur').classList.contains('hidden')) window.location.reload()
})
