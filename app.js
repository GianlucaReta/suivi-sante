// ─────────────────────────────────────────────────────────────
// Suivi santé : configuration, client Supabase, navigation, outils
// Chargé en premier : tous les autres fichiers utilisent `db` et les outils d'ici.
// ─────────────────────────────────────────────────────────────

// Clé publique (publishable / anon) uniquement. Jamais la clé service_role ici.
// La sécurité repose sur la RLS côté Supabase (voir sql/).
const SUPABASE_URL = 'https://uwzsqkvzshrnxvpdjelo.supabase.co'
const SUPABASE_KEY = 'sb_publishable_br0DoDL0Zpm82A_rtGkBeQ_MRpdmrK7'

// Clé publique VAPID (notifications) : générée par generer-vapid.js. Publique, elle peut être dans le code.
// La clé privée correspondante est seulement dans les secrets Supabase.
const VAPID_PUBLIC_KEY = 'BKgpiCoIeOnZHPbybYc60n9EVdPEXekNwRdx2_o3_-q2qU9Zx7q3j0Hyw7nTqtw8QuU_yfJS3vU-j147hvCct60'

const APP_VERSION = '0.13.0'

const SUPABASE_CONFIGURE = !SUPABASE_URL.includes('VOTRE-PROJET') && !SUPABASE_KEY.includes('VOTRE_CLE')

const { createClient } = supabase
const db = createClient(
  SUPABASE_CONFIGURE ? SUPABASE_URL : 'https://exemple.supabase.co',
  SUPABASE_CONFIGURE ? SUPABASE_KEY : 'cle-absente',
  {
    auth: {
      persistSession: true,      // la session survit à la fermeture de l'app
      autoRefreshToken: true,    // le jeton est renouvelé automatiquement
      detectSessionInUrl: false, // pas de lien magique
      storageKey: 'ss_auth',
    },
  }
)

// ── ÉTAT GLOBAL ──────────────────────────────────────────────
let utilisateur = null   // { id, email } une fois connectée
let profil = null        // ligne de la table profils
let pageActive = null

// ── NAVIGATION ───────────────────────────────────────────────
const PAGES = ['aujourdhui', 'journal', 'menus', 'sport', 'suivi', 'reglages']

function showPage(page) {
  if (!PAGES.includes(page)) page = 'aujourdhui'
  pageActive = page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page))
  document.getElementById('page-' + page).classList.add('active')
  if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page)
  window.scrollTo(0, 0)
  chargerPage(page)
}

// Recharge les données d'une page (aussi appelé au retour au premier plan, sans remonter en haut)
function chargerPage(page) {
  if (page === 'aujourdhui') chargerAujourdhui()
  if (page === 'journal')    chargerJournal()
  if (page === 'menus')      chargerMenus()
  if (page === 'sport')      chargerSport()
  if (page === 'suivi')      chargerSuivi()
  if (page === 'reglages')   chargerReglages()
}

// ── FENÊTRE GLISSANTE (« feuille ») ──────────────────────────
let _feuilleOnFermer = null

function ouvrirFeuille(titre, html, { onFermer = null } = {}) {
  // Un nouveau contenu remplace l'ancien : on prévient l'ancien (ex. arrêt de la caméra)
  if (_feuilleOnFermer && _feuilleOnFermer !== onFermer) { const f = _feuilleOnFermer; _feuilleOnFermer = null; f() }
  _feuilleOnFermer = onFermer
  document.getElementById('feuille-titre').textContent = titre
  document.getElementById('feuille-corps').innerHTML = html
  document.getElementById('feuille-corps').scrollTop = 0
  document.getElementById('feuille-fond').classList.remove('hidden')
  document.body.classList.add('sans-defilement')
}

function fermerFeuille() {
  if (_feuilleOnFermer) { const f = _feuilleOnFermer; _feuilleOnFermer = null; f() }
  document.getElementById('feuille-fond').classList.add('hidden')
  document.getElementById('feuille-corps').innerHTML = ''
  if (document.getElementById('questionnaire').classList.contains('hidden')) document.body.classList.remove('sans-defilement')
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('feuille-fond').classList.contains('hidden')) fermerFeuille()
})

// ── AUJOURD'HUI ──────────────────────────────────────────────
// Petites phrases complices, une par jour (toujours la même dans la journée)
const PHRASES_DU_JOUR = [
  "Aujourd'hui, on prend soin de toi.",
  "Tu avances à ton rythme, et c'est parfait.",
  'Un petit pas aujourd\'hui, c\'est déjà beaucoup.',
  'Sois douce avec toi-même aujourd\'hui.',
  'Chaque jour compte, même les jours imparfaits.',
  'Tu fais ça pour toi, et c\'est la meilleure raison.',
  'Bois un grand verre d\'eau et souris, tu gères.',
]

function chargerAujourdhui() {
  const maintenant = new Date()
  const heure = maintenant.getHours()
  const salut = heure < 5 || heure >= 18 ? 'Bonsoir' : 'Coucou'
  const prenom = profil?.prenom
  document.getElementById('aujourdhui-titre').textContent = prenom ? `${salut} ${prenom} !` : `${salut} !`
  document.getElementById('aujourdhui-date').textContent =
    maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const jourAn = Math.floor((maintenant - new Date(maintenant.getFullYear(), 0, 0)) / 86400000)
  document.getElementById('aujourdhui-phrase').textContent = PHRASES_DU_JOUR[jourAn % PHRASES_DU_JOUR.length]

  const el = document.getElementById('aujourdhui-reperes')
  const o = objectifsActuels()
  if (!o || !profil?.cible_kcal) {
    el.innerHTML = `<div class="carte"><p class="carte-texte">Complète ton profil pour voir tes repères du jour.</p>
      <button class="btn btn-primaire" style="margin-top:var(--sp-3);" onclick="ouvrirQuestionnaire('onboarding')">Compléter mon profil</button></div>`
    return
  }
  // Les repères (cibles) sont affichés dans les anneaux de « Ma journée »
  el.innerHTML = ''
  chargerResumeJour()
  chargerRaccourcisSuivi()
  chargerBilanSemaineAujourdhui()
  chargerSeanceDuJour()
  chargerMenuDuJour()
}

// ── RÉGLAGES ─────────────────────────────────────────────────
function chargerReglages() {
  document.getElementById('reglages-email').textContent = utilisateur?.email || ''
  document.getElementById('reglages-version').textContent = APP_VERSION
  afficherThemeActif()
  chargerReglagesProfil()
  chargerReglagesNotifications()
  chargerStockage()
}

function changerTheme(theme) {
  try {
    if (theme === 'auto') {
      localStorage.removeItem('ss_theme')
      delete document.documentElement.dataset.theme
    } else {
      localStorage.setItem('ss_theme', theme)
      document.documentElement.dataset.theme = theme
    }
  } catch (e) { console.warn(e) }
  afficherThemeActif()
}

function afficherThemeActif() {
  let actuel = 'auto'
  try { actuel = localStorage.getItem('ss_theme') || 'auto' } catch (e) {}
  document.querySelectorAll('#reglages-theme button').forEach(b => b.classList.toggle('active', b.dataset.theme === actuel))
}

// ── PROFIL ───────────────────────────────────────────────────
async function chargerProfil() {
  const { data, error } = await db.from('profils').select('*').eq('user_id', utilisateur.id).maybeSingle()
  if (error) { gererErreur(error, 'Impossible de charger ton profil.'); return null }
  profil = data
  return data
}

// ── TOASTS ───────────────────────────────────────────────────
function afficherToast(msg, erreur = false) {
  const zone = document.getElementById('toast-zone')
  const t = document.createElement('div')
  t.className = 'toast' + (erreur ? ' erreur' : '')
  t.setAttribute('role', erreur ? 'alert' : 'status')
  t.textContent = msg
  zone.appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400) }, erreur ? 5000 : 3000)
}

// ── ERREURS ──────────────────────────────────────────────────
// Erreur « réseau » : pas d'internet, ou serveur Supabase en pause / injoignable.
function estErreurReseau(error) {
  const msg = String(error?.message || error || '')
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|ERR_/i.test(msg) || error?.status === 0
}

// Usage : const { error } = await db.from(...); if (error) { gererErreur(error, 'Message'); return }
function gererErreur(error, message = 'Une erreur est survenue.') {
  console.error(error)
  if (estErreurReseau(error)) {
    if (!navigator.onLine) afficherToast('Pas de connexion internet. Réessaie dans un instant.', true)
    else verifierServeur()
    return
  }
  afficherToast(message, true)
}

// ── OUTILS ───────────────────────────────────────────────────
// Échappe un texte avant de l'insérer dans du HTML (innerHTML).
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Date locale au format AAAA-MM-JJ (toISOString donnerait la date UTC, fausse le soir).
function dateISO(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const j = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${j}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatNombre(n, decimales = 0) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
}

// Attente avec délai maximum (pour les appels réseau qui pourraient pendre).
function avecDelai(promesse, ms = 10000) {
  return Promise.race([
    promesse,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Failed to fetch (délai dépassé)')), ms)),
  ])
}

// ── Icônes dessinées (trait fin arrondi) ─────────────────────
const TRACES_ICONES = {
  haltere: '<path d="M6.5 7v10M17.5 7v10M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  lecture: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>',
  coeur: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  lune: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  balance: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0M12 9.5l1-1.5"/>',
  cookie: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9h.01M14.5 8.5h.01M15 14h.01M9.5 14.5h.01M12 11.5h.01"/>',
  chocolat: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M5 9.2h14M5 14.8h14M12 3.5v17"/>',
  main: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7S5 17.5 5 15v-2.5a1.5 1.5 0 0 1 3 0"/>',
  feuille: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z"/><path d="M5 19l7-7"/>',
  alerte: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  coche: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  scanner: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8" stroke-width="1.4"/>',
  copier: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  crayon: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M14 7l3 3"/>',
  placard: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M12 3.5v17M9.5 11v2M14.5 11v2"/>',
  partage: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  frigo: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M6 9.5h12M9 5.5v2M9 12.5v3"/>',
  oeil: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  visage1: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><path d="M8.5 16.5c1-1.6 2.2-2.3 3.5-2.3s2.5.7 3.5 2.3"/>',
  visage2: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><path d="M9 16c1-.7 2-1 3-1s2 .3 3 1"/>',
  visage3: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><path d="M9 15.5h6"/>',
  visage4: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><path d="M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5"/>',
  visage5: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><path d="M8.5 13.5h7c-.5 2-1.8 3.2-3.5 3.2s-3-1.2-3.5-3.2z"/>',
  serein: '<circle cx="12" cy="12" r="9"/><path d="M8 10.5c.6-.6 1.4-.6 2 0M14 10.5c.6-.6 1.4-.6 2 0"/><path d="M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5"/>',
  souffle: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01" stroke-width="2.6"/><circle cx="12" cy="15.5" r="1.6"/><path d="M18.5 15.5h3M19 18.5l2 1"/>',
  medaille: '<circle cx="12" cy="15" r="5.5"/><path d="M9 4h6l-1.5 5.6M9 4l1.5 5.6M12 12.7l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z"/>',
  cercle: '<circle cx="12" cy="12" r="5"/>',
  sommeil: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M15 4h3l-3 3h3"/>',
  croix: '<path d="M6 6l12 12M18 6L6 18"/>',
  cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2"/>',
  appareil: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  cloche: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
}
function icone(nom, classe = 'ico') {
  return `<svg class="${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRACES_ICONES[nom] || ''}</svg>`
}

// ── Confettis de félicitation (légers, retirés après l'animation) ─
function lancerConfettis(nombre = 40) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const couleurs = ['#A68BE8', '#A8DCC2', '#F4A9C4', '#EBCB4B', '#DCCFF7']
  const zone = document.createElement('div')
  zone.className = 'confettis'
  for (let i = 0; i < nombre; i++) {
    const c = document.createElement('span')
    c.className = 'confetti'
    c.style.left = `${Math.random() * 100}%`
    c.style.background = couleurs[i % couleurs.length]
    c.style.animationDelay = `${Math.random() * 0.35}s`
    c.style.setProperty('--d', `${1.3 + Math.random() * 0.9}s`)
    c.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`)
    c.style.setProperty('--r', `${(Math.random() - 0.5) * 900}deg`)
    zone.appendChild(c)
  }
  document.body.appendChild(zone)
  setTimeout(() => zone.remove(), 2600)
}
