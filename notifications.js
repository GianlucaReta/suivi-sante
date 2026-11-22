// ─────────────────────────────────────────────────────────────
// Notifications : abonnement Web Push de l'appareil, réglages des rappels, test
// Sur iPhone : iOS 16.4 ou plus récent, et site installé sur l'écran d'accueil.
// L'envoi est fait par l'Edge Function envoyer-rappels (appelée par pg_cron).
// Dépend de : app.js (VAPID_PUBLIC_KEY, db), profil.js (sauvegarderProfil)
// ─────────────────────────────────────────────────────────────

const TYPES_RAPPELS = [
  ['bilan', 'Bilan du soir', 'Seulement si le bilan n\'est pas encore fait.'],
  ['seance', 'Séance du jour', 'Seulement les jours où une séance est prévue.'],
  ['pesee', 'Pesée de la semaine', 'Le jour choisi, si tu ne t\'es pas pesée depuis 5 jours.'],
  ['photo', 'Photo d\'un repas', 'Seulement s\'il n\'y a pas encore de photo ce jour-là.'],
  ['menu', 'Menu de la semaine', 'Le jour choisi, si le menu de la semaine suivante n\'est pas prêt.'],
]
const RAPPELS_DEFAUT = {
  bilan: { actif: true, heure: '21:30' }, seance: { actif: true, heure: '18:00' },
  pesee: { actif: true, heure: '08:30', jour: 7 }, photo: { actif: false, heure: '13:15' },
  menu: { actif: true, heure: '18:30', jour: 7 },
}

const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const estInstallee = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
const pushDisponible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const vapidConfiguree = () => typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 60

function base64UrlVersOctets(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

async function abonnementActuel() {
  if (!pushDisponible()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// ── Réglages ────────────────────────────────────────────────
async function chargerReglagesNotifications() {
  const el = document.getElementById('reglages-notifications')
  if (!el || !profil) return
  const rappels = { ...RAPPELS_DEFAUT, ...(profil.rappels || {}) }

  let etat = ''
  let actif = false
  if (!pushDisponible()) {
    etat = estIOS() && !estInstallee()
      ? `<p class="carte-texte">Sur iPhone, les notifications ne marchent que depuis l'app installée : ouvre le site dans <strong>Safari</strong> → bouton <strong>Partager</strong> → <strong>Sur l'écran d'accueil</strong>, puis ouvre l'app depuis son icône et reviens ici. Il faut iOS 16.4 ou plus récent.</p>`
      : `<p class="carte-texte">Ce navigateur ne prend pas en charge les notifications.</p>`
  } else if (!vapidConfiguree()) {
    etat = `<p class="carte-texte">Les notifications ne sont pas encore configurées sur le serveur (voir le README, « Notifications »).</p>`
  } else if (Notification.permission === 'denied') {
    etat = `<p class="carte-texte">Les notifications sont bloquées pour cette app. Pour les réactiver sur iPhone : <strong>Réglages → Notifications → Suivi santé</strong> → Autoriser.</p>`
  } else {
    const sub = await abonnementActuel().catch(() => null)
    actif = !!sub && Notification.permission === 'granted'
    etat = actif
      ? `<p class="carte-texte">✓ Notifications activées sur cet appareil.</p>
         <div class="feuille-actions">
           <button class="btn btn-secondaire" onclick="desactiverNotifications()">Désactiver ici</button>
           <button class="btn btn-primaire" onclick="envoyerNotificationTest()">M'envoyer un test</button>
         </div>`
      : `<p class="carte-texte">Reçois des rappels doux sur cet appareil. Tu choisis lesquels et à quelle heure.</p>
         <button class="btn btn-primaire btn-bloc" onclick="activerNotifications()">Activer les notifications</button>`
  }

  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Notifications</div>
      ${etat}
      <div class="sous-titre-carte" style="margin-top:var(--sp-4);">Rappels</div>
      ${TYPES_RAPPELS.map(([cle, titre, detail]) => {
        const r = rappels[cle]
        return `<div class="rappel">
          <label class="rappel-tete">
            <input type="checkbox" ${r.actif ? 'checked' : ''} onchange="modifierRappel('${cle}', 'actif', this.checked)" />
            <span><span class="choix-titre">${titre}</span><span class="choix-detail">${detail}</span></span>
          </label>
          <div class="rappel-reglages ${r.actif ? '' : 'invisible'}">
            ${r.jour ? `<select class="input input-petit" onchange="modifierRappel('${cle}', 'jour', Number(this.value))" aria-label="Jour">
              ${JOURS_SEMAINE.map(([n, , l]) => `<option value="${n}" ${r.jour === n ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
            <input class="input input-petit" type="time" step="900" value="${esc(r.heure)}" onchange="modifierRappel('${cle}', 'heure', this.value)" aria-label="Heure" />
          </div>
        </div>`
      }).join('')}
      <p class="message-info">Les rappels partent au quart d'heure près. Ils s'appliquent à tous tes appareils où les notifications sont activées.</p>
    </div>`
}

async function modifierRappel(cle, champ, valeur) {
  const rappels = { ...RAPPELS_DEFAUT, ...(profil.rappels || {}) }
  if (champ === 'heure' && !/^\d{2}:\d{2}$/.test(valeur)) return
  rappels[cle] = { ...rappels[cle], [champ]: valeur }
  if (await sauvegarderProfil({ rappels })) {
    afficherToast('Rappel enregistré')
    chargerReglagesNotifications()
  }
}

// ── Activation sur cet appareil ──────────────────────────────
async function activerNotifications() {
  try {
    // La demande d'autorisation doit partir d'un geste (exigence iPhone)
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { afficherToast('Notifications non autorisées.', true); chargerReglagesNotifications(); return }
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: base64UrlVersOctets(VAPID_PUBLIC_KEY),
    })
    const j = sub.toJSON()
    const { error } = await db.from('abonnements_push').upsert({
      user_id: utilisateur.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      appareil: estIOS() ? 'iPhone' : navigator.platform || 'navigateur',
    }, { onConflict: 'endpoint' })
    if (error) { gererErreur(error, "Impossible d'enregistrer l'appareil."); return }
    afficherToast('Notifications activées 🔔')
  } catch (e) {
    console.error(e)
    afficherToast("Impossible d'activer les notifications sur cet appareil.", true)
  }
  chargerReglagesNotifications()
}

async function desactiverNotifications() {
  try {
    const sub = await abonnementActuel()
    if (sub) {
      await db.from('abonnements_push').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    afficherToast('Notifications désactivées sur cet appareil')
  } catch (e) { console.error(e) }
  chargerReglagesNotifications()
}

async function envoyerNotificationTest() {
  const { data, error } = await db.functions.invoke('envoyer-rappels', { body: { test: true } })
  if (error) { gererErreur(error, "Le test n'a pas pu partir : l'Edge Function est-elle déployée ?"); return }
  afficherToast(data?.envoyes ? 'Notification envoyée : elle arrive dans quelques secondes.' : 'Aucun appareil abonné trouvé.', !data?.envoyes)
}
