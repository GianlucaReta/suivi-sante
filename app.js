// ─────────────────────────────────────────────────────────────
// Suivi santé : configuration, client Supabase, navigation, outils
// Chargé en premier : tous les autres fichiers utilisent `db` et les outils d'ici.
// ─────────────────────────────────────────────────────────────

// Clé publique (publishable / anon) uniquement. Jamais la clé service_role ici.
// La sécurité repose sur la RLS côté Supabase (voir sql/).
const SUPABASE_URL = 'https://uwzsqkvzshrnxvpdjelo.supabase.co'
const SUPABASE_KEY = 'VOTRE_CLE_PUBLIQUE'

const APP_VERSION = '0.1.0'

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
  if (page === 'reglages')   chargerReglages()
}

// ── AUJOURD'HUI ──────────────────────────────────────────────
function chargerAujourdhui() {
  const heure = new Date().getHours()
  const salut = heure < 5 ? 'Bonsoir' : heure < 18 ? 'Bonjour' : 'Bonsoir'
  const prenom = profil?.prenom
  document.getElementById('aujourdhui-titre').textContent = prenom ? `${salut}, ${prenom}` : salut
  document.getElementById('aujourdhui-date').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── RÉGLAGES ─────────────────────────────────────────────────
function chargerReglages() {
  document.getElementById('reglages-email').textContent = utilisateur?.email || ''
  document.getElementById('reglages-version').textContent = APP_VERSION
  afficherThemeActif()
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
