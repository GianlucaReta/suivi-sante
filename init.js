// ─────────────────────────────────────────────────────────────
// Démarrage : chargé en dernier, une fois toutes les fonctions définies
// ─────────────────────────────────────────────────────────────

if (!navigator.onLine) document.getElementById('bandeau-hors-ligne').classList.remove('hidden')

// Navigation avec le bouton retour du navigateur / geste retour
window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '')
  if (utilisateur && PAGES.includes(page) && page !== pageActive) showPage(page)
})

// Quand l'app revient au premier plan (iPhone), on rafraîchit la page active
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !utilisateur) return
  // Pendant une séance guidée : on garde l'écran allumé (le verrou saute quand l'app passe en arrière-plan)
  if (guidee) { try { guidee.wakeLock = await navigator.wakeLock?.request('screen') } catch (e) {} return }
  if (pageActive) chargerPage(pageActive)
})

// Service worker (PWA : installation, cache, notifications)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.warn('Service worker non enregistré', e))
  })
}

// Lien de liste de courses partagée : page à part, sans connexion
const _jetonCourses = new URLSearchParams(location.search).get('courses')
if (_jetonCourses) {
  afficherCoursesPartagees(_jetonCourses)
  // Rafraîchit quand on revient sur l'onglet (l'autre personne a pu cocher)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _partage) afficherCoursesPartagees(_partage.jeton) })
} else {
  demarrerAuth()
}
