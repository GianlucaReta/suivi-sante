// ─────────────────────────────────────────────────────────────
// Sport à la maison : planning de la semaine avec report, séance guidée
// (minuteur travail/repos, signal sonore), ressenti, progression lente
// Dépend de : app.js, calculs.js, profil.js
// ─────────────────────────────────────────────────────────────

const LIBELLES_ZONES = { jambes: 'Jambes', fessiers: 'Fessiers', gainage: 'Gainage', haut_du_corps: 'Haut du corps', cardio: 'Cardio' }
const LIBELLES_TYPES_SEANCE = { A: 'Bas du corps', B: 'Haut du corps et gainage' }
const RESSENTIS = [['facile', 'Facile', 'serein'], ['correct', 'Correct', 'visage4'], ['difficile', 'Difficile', 'souffle']]
const iconeRessenti = cle => icone(RESSENTIS.find(r => r[0] === cle)?.[2] || 'coche', 'ico ico-titre-inline')

let _exercices = null
let seancesSemaine = []
let guidee = null      // état de la séance guidée en cours

function formatChrono(s) {
  s = Math.max(0, Math.ceil(s))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function chargerExercices() {
  if (_exercices) return _exercices
  const { data, error } = await db.from('exercices').select('*').eq('actif', true)
  if (error) { gererErreur(error, 'Impossible de charger les exercices.'); return null }
  _exercices = data || []
  return _exercices
}

function contenuSeance(seance) {
  return construireSeance({
    exercices: _exercices, materiel: profil.materiel || {}, type: seance.type,
    dureeMin: profil.duree_seance || 25, niveau: seance.niveau || profil.sport_niveau || 1, graine: seance.id,
  })
}

// ═════════════════════════════════════════════════════════════
// PLANNING
// ═════════════════════════════════════════════════════════════
// Une seule préparation à la fois (la page Aujourd'hui et la page Sport peuvent la demander en même temps)
let _preparationSport = null
function preparerSemaineSport() {
  _preparationSport ??= preparerSemaineSportInterne().finally(() => { _preparationSport = null })
  return _preparationSport
}

async function preparerSemaineSportInterne() {
  const lundi = lundiDe()
  const auj = dateISO()
  const { data, error } = await db.from('seances').select('*').gte('semaine_debut', decalerDate(lundi, -21)).order('date_prevue')
  if (error) { gererErreur(error, 'Impossible de charger les séances.'); return null }
  let seances = data || []

  // Séances ratées : report dans la semaine, ou abandon sans pénalité (y compris les semaines passées)
  const changements = reporterSeances(seances, auj, profil.jours_sport || [])
  for (const ch of changements) {
    const { id, ...champs } = ch
    const { error: e } = await db.from('seances').update(champs).eq('id', id)
    if (e) { console.error(e); continue }
    Object.assign(seances.find(s => s.id === id), champs)
  }

  // Nouvelle semaine : planning selon les jours possibles (seulement les jours à venir)
  if (!seances.some(s => s.semaine_debut === lundi)) {
    // Première utilisation en cours de semaine : on répartit parmi les jours possibles restants
    const joursRestants = (profil.jours_sport || [1, 3, 5]).filter(j => dateDuJour(lundi, j) >= auj)
    const jours = joursDeSeance(joursRestants, profil.seances_par_semaine || 3)
    const dernierType = seances.filter(s => s.statut === 'faite').at(-1)?.type
    let type = dernierType === 'A' ? 'B' : 'A'
    const nouvelles = []
    for (const j of jours) {
      const d = dateDuJour(lundi, j)
      nouvelles.push({ semaine_debut: lundi, date_prevue: d, date_initiale: d, type, statut: 'prevue' })
      type = type === 'A' ? 'B' : 'A'
    }
    if (nouvelles.length) {
      const { data: crees, error: e } = await db.from('seances').insert(nouvelles).select()
      if (e) { gererErreur(e, 'Impossible de préparer le planning.'); return null }
      seances = [...seances, ...(crees || [])]
    }
  }
  seancesSemaine = seances.filter(s => s.semaine_debut === lundi).sort((a, b) => a.date_prevue.localeCompare(b.date_prevue))
  return seances
}

async function verifierEtAppliquerProgression(seances) {
  const faites = seances.filter(s => s.statut === 'faite')
  const p = verifierProgression({
    niveau: profil.sport_niveau || 1, dateNiveau: profil.sport_niveau_date, seancesFaites: faites,
    seancesParSemaine: profil.seances_par_semaine || 3, aujourdhui: dateISO(),
  })
  if (!p.monter) return p
  if (await sauvegarderProfil({ sport_niveau: (profil.sport_niveau || 1) + 1, sport_niveau_date: dateISO() })) {
    afficherToast(`Niveau ${profil.sport_niveau} : un tout petit peu plus de répétitions, tu progresses !`)
  }
  return { monter: true }
}

// ═════════════════════════════════════════════════════════════
// PAGE SPORT
// ═════════════════════════════════════════════════════════════
async function chargerSport() {
  const el = document.getElementById('sport-contenu')
  if (!(await chargerExercices())) return
  if (!_exercices.length) {
    el.innerHTML = `<div class="carte"><div class="carte-titre">Pas encore d'exercices</div>
      <p class="carte-texte">La base d'exercices n'est pas encore importée (voir le README, « Importer les exercices »).</p></div>`
    return
  }
  const seances = await preparerSemaineSport()
  if (!seances) return
  const prog = await verifierEtAppliquerProgression(seances)
  afficherSport(prog)
}

function afficherSport(prog) {
  const el = document.getElementById('sport-contenu')
  const auj = dateISO()
  const duJour = seancesSemaine.find(s => s.date_prevue === auj && s.statut !== 'abandonnee')
  const faites = seancesSemaine.filter(s => s.statut === 'faite').length
  const materiel = [profil.materiel?.elastique && 'élastique', profil.materiel?.tapis && 'tapis'].filter(Boolean).join(' et ') || 'sans matériel'

  let html = ''
  if (duJour?.statut === 'prevue') {
    const c = contenuSeance(duJour)
    html += `
      <div class="carte carte-aujourdhui carte-cadre avec-etiquette">
        <span class="etiquette">Séance du jour</span>
        <div class="carte-titre">${LIBELLES_TYPES_SEANCE[duJour.type]}</div>
        <p class="carte-texte">Environ ${c.dureeMin} min · ${c.circuit.length} exercices × ${c.tours} tours</p>
        ${duJour.date_initiale !== duJour.date_prevue ? `<p class="message-info">Reportée du ${libelleJourCourt(duJour.date_initiale)}.</p>` : ''}
        <div class="feuille-actions">
          <button class="btn btn-secondaire" onclick="apercuSeance('${duJour.id}')">Voir</button>
          <button class="btn btn-primaire" onclick="demarrerSeance('${duJour.id}')">Commencer</button>
        </div>
      </div>`
  } else if (duJour?.statut === 'faite') {
    html += `<div class="carte carte-cadre"><div class="carte-titre ico-titre">Séance faite aujourd'hui ${iconeRessenti(duJour.ressenti)}</div>
      <p class="carte-texte">Bravo, profite du reste de ta journée.</p></div>`
  } else {
    html += `<div class="carte"><div class="carte-titre">Pas de séance prévue aujourd'hui</div>
      <p class="carte-texte">Repos ! Si tu as envie de bouger quand même, tu peux faire une séance en plus.</p>
      <button class="btn btn-secondaire btn-bloc" style="margin-top:var(--sp-3);" onclick="seanceEnPlus()">Faire une séance maintenant</button></div>`
  }

  html += `
    <div class="carte">
      <div class="carte-titre">Cette semaine · ${faites} / ${seancesSemaine.length} séance${faites > 1 ? 's' : ''}</div>
      ${seancesSemaine.length ? seancesSemaine.map(s => renduLigneSeance(s)).join('') : '<p class="carte-texte">Aucune séance prévue cette semaine.</p>'}
      <p class="message-info">Une séance ratée est reportée au prochain jour libre de la semaine. Si la semaine se termine, elle est simplement oubliée.</p>
    </div>

    <div class="carte">
      <div class="carte-titre">Ta progression</div>
      <div class="ligne"><span>Niveau</span><span class="ligne-valeur">${profil.sport_niveau || 1}</span></div>
      <div class="ligne"><span>Matériel</span><span class="ligne-valeur">${materiel}</span></div>
      <p class="message-info">${messageProgression(prog)}</p>
      <button class="btn btn-lien" style="padding-left:0;" onclick="afficherBibliotheque()">Voir tous les exercices</button>
      <button class="btn btn-lien" style="padding-left:0;" onclick="replanifierSemaine()">Refaire le planning de la semaine</button>
    </div>`
  el.innerHTML = html
}

function messageProgression(p) {
  if (!p || p.monter) return 'Les répétitions et les durées augmentent doucement, environ toutes les deux semaines.'
  if (p.raison === 'difficile') return 'Une séance a été difficile récemment : on garde ce niveau, il n\'y a aucune urgence.'
  if (p.raison === 'trop tôt') return `Prochaine petite progression possible dans ${p.dans} jour${p.dans > 1 ? 's' : ''}, si les séances se passent bien.`
  if (p.raison === 'pas assez de séances') return 'La progression viendra quand quelques séances auront été faites à ce niveau.'
  return 'Les répétitions et les durées augmentent doucement, environ toutes les deux semaines.'
}

function renduLigneSeance(s) {
  const auj = dateISO()
  const etat = s.statut === 'faite' ? `faite ${iconeRessenti(s.ressenti)}`
    : s.statut === 'abandonnee' ? 'pas cette fois'
    : s.date_prevue === auj ? "aujourd'hui" : 'prévue'
  return `
    <button class="ligne ligne-action ${s.statut === 'abandonnee' ? 'ligne-passee' : ''}" onclick="apercuSeance('${s.id}')">
      <span style="text-transform:capitalize;">${libelleJourCourt(s.date_prevue)}</span>
      <span class="ligne-valeur">${LIBELLES_TYPES_SEANCE[s.type]} · ${etat}${s.date_initiale !== s.date_prevue && s.statut !== 'abandonnee' ? ' (reportée)' : ''}</span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>`
}

async function seanceEnPlus() {
  const auj = dateISO()
  const derniere = seancesSemaine.filter(s => s.statut === 'faite').at(-1)
  const { data, error } = await db.from('seances').insert({
    semaine_debut: lundiDe(), date_prevue: auj, date_initiale: auj, type: derniere?.type === 'A' ? 'B' : 'A', statut: 'prevue',
  }).select().single()
  if (error) { gererErreur(error, 'Impossible de créer la séance.'); return }
  seancesSemaine.push(data)
  demarrerSeance(data.id)
}

async function replanifierSemaine() {
  if (!confirm('Refaire le planning des séances à venir cette semaine, selon tes réglages actuels ?')) return
  const auj = dateISO()
  const aVenir = seancesSemaine.filter(s => s.statut === 'prevue' && s.date_prevue >= auj)
  if (aVenir.length) {
    const { error } = await db.from('seances').delete().in('id', aVenir.map(s => s.id))
    if (error) { gererErreur(error); return }
  }
  const lundi = lundiDe()
  const pris = new Set(seancesSemaine.filter(s => s.statut === 'faite').map(s => s.date_prevue))
  const restantes = Math.max(0, (profil.seances_par_semaine || 3) - pris.size)
  const jours = joursDeSeance((profil.jours_sport || []).filter(j => dateDuJour(lundi, j) >= auj && !pris.has(dateDuJour(lundi, j))), restantes)
  const derniere = seancesSemaine.filter(s => s.statut === 'faite').at(-1)
  let type = derniere?.type === 'A' ? 'B' : 'A'
  const nouvelles = jours.map(j => { const d = dateDuJour(lundi, j); const s = { semaine_debut: lundi, date_prevue: d, date_initiale: d, type, statut: 'prevue' }; type = type === 'A' ? 'B' : 'A'; return s })
  if (nouvelles.length) {
    const { error } = await db.from('seances').insert(nouvelles)
    if (error) { gererErreur(error); return }
  }
  afficherToast('Planning mis à jour')
  chargerSport()
}

// ── Aperçu d'une séance ──────────────────────────────────────
function imageExercice(ex, grande = false) {
  if (ex.image_url) return `<img class="${grande ? 'exo-image-grande' : 'exo-image'}" src="${esc(ex.image_url)}" alt="" loading="lazy" />`
  return `<div class="${grande ? 'exo-image-grande' : 'exo-image'} exo-remplacement" aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="12" r="6"/><path d="M32 18v20M20 28l12-6 12 6M32 38l-9 16M32 38l9 16"/></svg>
    <span>${esc(LIBELLES_ZONES[ex.zone] || '')}</span></div>`
}

function texteValeur(ex, valeur) {
  if (ex.mode === 'duree') return `${valeur} s${ex.cote ? ' par côté' : ''}`
  return `${valeur} répétitions${ex.cote ? ' par côté' : ''}`
}

function apercuSeance(id) {
  const s = seancesSemaine.find(x => x.id === id)
  if (!s) return
  const c = contenuSeance(s)
  const ligne = x => `<div class="exo-ligne">${imageExercice(x.exercice)}<div><div class="option-nom">${esc(x.exercice.nom)}</div>
    <div class="option-detail">${texteValeur(x.exercice, x.valeur)}</div></div></div>`
  ouvrirFeuille(`${LIBELLES_TYPES_SEANCE[s.type]} · ${libelleJourCourt(s.date_prevue)}`, `
    <p class="message-info" style="margin-top:0;">Environ ${c.dureeMin} min · niveau ${s.niveau || profil.sport_niveau || 1}</p>
    <div class="carte-titre">Échauffement</div>
    ${c.echauffement.map(x => ligne({ ...x, exercice: { ...x.exercice, mode: 'duree', cote: false } })).join('')}
    <div class="carte-titre" style="margin-top:var(--sp-4);">Circuit · ${c.tours} tours</div>
    ${c.circuit.map(ligne).join('')}
    <p class="message-info">${SPORT.REPOS_EXERCICE} s de repos entre les exercices, ${SPORT.REPOS_TOUR} s entre les tours.</p>
    ${s.statut === 'prevue' && s.date_prevue <= dateISO() ? `<button class="btn btn-primaire btn-bloc" onclick="fermerFeuille(); demarrerSeance('${s.id}')">Commencer</button>` : ''}`)
}

function afficherBibliotheque() {
  const dispo = new Set(exercicesDisponibles(_exercices, profil.materiel || {}).map(e => e.id))
  const groupes = Object.keys(LIBELLES_ZONES)
  ouvrirFeuille('Exercices', groupes.map(z => {
    const exos = _exercices.filter(e => e.zone === z)
    if (!exos.length) return ''
    return `<div class="carte-titre" style="margin-top:var(--sp-3);">${LIBELLES_ZONES[z]}</div>` + exos.map(e => `
      <details class="exo-detail ${dispo.has(e.id) ? '' : 'exo-indispo'}">
        <summary class="exo-ligne">${imageExercice(e)}<div><div class="option-nom">${esc(e.nom)}</div>
          <div class="option-detail">${dispo.has(e.id) ? texteValeur(e, valeurExercice(e, profil.sport_niveau || 1)) : e.materiel.includes('tapis') ? 'avec le tapis de sol' : "avec l'élastique"}</div></div></summary>
        ${imageExercice(e, true)}
        <ul class="consignes">${e.consignes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
        ${e.image_credit ? `<p class="message-info">Image : ${esc(e.image_credit)}</p>` : ''}
      </details>`).join('')
  }).join('') + `<p class="message-info">Exercices choisis pour ménager la nuque : pas de crunch, de relevé de buste ni d'exercice qui tire sur la tête.</p>`)
}

// ═════════════════════════════════════════════════════════════
// SÉANCE GUIDÉE
// ═════════════════════════════════════════════════════════════
function etapesSeance(c) {
  const etapes = []
  c.echauffement.forEach((x, i) => {
    etapes.push({ genre: 'travail', exercice: { ...x.exercice, mode: 'duree', cote: false }, duree: x.valeur, titre: 'Échauffement' })
    if (i < c.echauffement.length - 1) etapes.push({ genre: 'repos', duree: 10 })
  })
  etapes.push({ genre: 'repos', duree: 15, titre: 'Le circuit commence' })
  for (let t = 1; t <= c.tours; t++) {
    c.circuit.forEach((x, i) => {
      const titre = `Tour ${t} / ${c.tours}`
      if (x.exercice.mode === 'duree' && x.exercice.cote) {
        etapes.push({ genre: 'travail', exercice: x.exercice, duree: x.valeur, cote: 'Côté gauche', titre })
        etapes.push({ genre: 'repos', duree: 5, titre: 'Change de côté' })
        etapes.push({ genre: 'travail', exercice: x.exercice, duree: x.valeur, cote: 'Côté droit', titre })
      } else if (x.exercice.mode === 'duree') {
        etapes.push({ genre: 'travail', exercice: x.exercice, duree: x.valeur, titre })
      } else {
        etapes.push({ genre: 'travail', exercice: x.exercice, reps: x.valeur, titre })
      }
      if (i < c.circuit.length - 1) etapes.push({ genre: 'repos', duree: SPORT.REPOS_EXERCICE })
    })
    if (t < c.tours) etapes.push({ genre: 'repos', duree: SPORT.REPOS_TOUR, titre: `Fin du tour ${t} : bois un peu d'eau` })
  }
  return etapes
}

async function demarrerSeance(id) {
  const s = seancesSemaine.find(x => x.id === id)
  if (!s) return
  const c = contenuSeance(s)
  guidee = { seance: s, contenu: c, etapes: etapesSeance(c), index: 0, fin: null, reste: null, pause: false, debut: Date.now(), timer: null, audio: null, wakeLock: null }

  // Le son doit être initialisé pendant un geste de l'utilisatrice (exigence iPhone)
  try { guidee.audio = new (window.AudioContext || window.webkitAudioContext)() } catch (e) { guidee.audio = null }
  // Garde l'écran allumé pendant la séance (si le navigateur le permet)
  try { guidee.wakeLock = await navigator.wakeLock?.request('screen') } catch (e) { guidee.wakeLock = null }

  document.getElementById('seance-guidee').classList.remove('hidden')
  document.body.classList.add('sans-defilement')
  lancerEtape()
  guidee.timer = setInterval(tictac, 200)
}

function bip(frequence = 880, duree = 0.12) {
  const ctx = guidee?.audio
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') ctx.resume()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = frequence
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duree)
    o.start(); o.stop(ctx.currentTime + duree)
  } catch (e) { /* son indisponible */ }
}

function lancerEtape() {
  const e = guidee.etapes[guidee.index]
  guidee.fin = e.duree ? Date.now() + e.duree * 1000 : null
  guidee.reste = e.duree || null
  guidee.dernierBip = null
  afficherEtape()
}

function tictac() {
  if (!guidee || guidee.pause || !guidee.fin) return
  const reste = (guidee.fin - Date.now()) / 1000
  const s = Math.ceil(reste)
  if (s <= 3 && s >= 1 && guidee.dernierBip !== s) { guidee.dernierBip = s; bip(660, 0.1) }
  if (reste <= 0) { bip(990, 0.35); etapeSuivante(); return }
  const chrono = document.getElementById('sg-chrono')
  if (chrono) chrono.textContent = formatChrono(reste)
  const anneau = document.getElementById('sg-anneau')
  if (anneau) anneau.style.strokeDashoffset = offsetChrono(reste)
}

// Anneau du chrono : plein au départ, il se vide au fil des secondes
function offsetChrono(reste) {
  const total = guidee.etapes[guidee.index]?.duree || 1
  return (100 - Math.max(0, Math.min(1, reste / total)) * 100).toFixed(2)
}
function chronoAnneau(reste, repos = false) {
  return `<div class="sg-anneau ${repos ? 'sg-anneau-repos' : ''}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="anneau-piste" cx="50" cy="50" r="44"/>
      <circle id="sg-anneau" class="sg-anneau-trait" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100" style="stroke-dashoffset:${offsetChrono(reste)}"/></svg>
    <div id="sg-chrono" class="sg-chrono">${formatChrono(reste)}</div>
  </div>`
}

function etapeSuivante() {
  if (guidee.index >= guidee.etapes.length - 1) { terminerSeance(); return }
  guidee.index++
  lancerEtape()
}

function etapePrecedente() {
  // Revient à l'exercice précédent (en sautant les repos)
  let i = guidee.index - 1
  while (i > 0 && guidee.etapes[i].genre === 'repos') i--
  guidee.index = Math.max(0, i)
  guidee.pause = false
  lancerEtape()
}

function basculerPause() {
  if (!guidee.fin && !guidee.pause) return
  if (guidee.pause) {
    guidee.fin = Date.now() + guidee.reste * 1000
    guidee.pause = false
  } else {
    guidee.reste = (guidee.fin - Date.now()) / 1000
    guidee.pause = true
  }
  afficherEtape()
}

function prochainExercice() {
  return guidee.etapes.slice(guidee.index + 1).find(x => x.genre === 'travail')
}

function afficherEtape() {
  const e = guidee.etapes[guidee.index]
  const progression = Math.round((guidee.index / guidee.etapes.length) * 100)
  const el = document.getElementById('sg-contenu')
  if (e.genre === 'repos') {
    const suivant = prochainExercice()
    el.innerHTML = `
      <div class="sg-titre">${esc(e.titre || 'Repos')}</div>
      ${chronoAnneau(guidee.pause ? guidee.reste : e.duree, true)}
      ${suivant ? `<div class="sg-suivant">Ensuite : <strong>${esc(suivant.exercice.nom)}</strong>${suivant.cote ? ` (${suivant.cote.toLowerCase()})` : ''}</div>
        ${imageExercice(suivant.exercice, true)}` : ''}`
  } else {
    const ex = e.exercice
    el.innerHTML = `
      <div class="sg-titre">${esc(e.titre || '')}</div>
      ${imageExercice(ex, true)}
      <div class="sg-nom">${esc(ex.nom)}${e.cote ? ` · ${e.cote}` : ''}</div>
      ${e.duree ? chronoAnneau(guidee.pause ? guidee.reste : e.duree)
        : `<div class="sg-chrono">${e.reps}<span class="sg-unite">${ex.cote ? ' par côté' : ' répétitions'}</span></div>`}
      <ul class="consignes">${(ex.consignes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>`
  }
  document.getElementById('sg-barre').style.width = `${progression}%`
  document.getElementById('sg-pause').textContent = guidee.pause ? 'Reprendre' : 'Pause'
  document.getElementById('sg-pause').classList.toggle('invisible', !e.duree)
  document.getElementById('sg-suivant').textContent = e.genre === 'travail' && e.reps ? "C'est fait" : 'Passer'
}

function quitterSeance() {
  if (!confirm('Arrêter la séance ? Elle restera prévue, tu pourras la refaire plus tard.')) return
  fermerSeanceGuidee()
}

function fermerSeanceGuidee() {
  if (!guidee) return
  clearInterval(guidee.timer)
  try { guidee.wakeLock?.release() } catch (e) {}
  try { guidee.audio?.close() } catch (e) {}
  guidee = null
  document.getElementById('sg-commandes').classList.remove('hidden')
  document.querySelector('.sg-haut').classList.remove('invisible')
  document.getElementById('seance-guidee').classList.add('hidden')
  document.body.classList.remove('sans-defilement')
}

function terminerSeance() {
  clearInterval(guidee.timer)
  guidee.fin = null
  bip(990, 0.2); setTimeout(() => bip(1320, 0.35), 220)
  lancerConfettis(60)
  const minutes = Math.max(1, Math.round((Date.now() - guidee.debut) / 60000))
  guidee.minutes = minutes
  document.getElementById('sg-barre').style.width = '100%'
  document.getElementById('sg-commandes').classList.add('hidden')
  document.querySelector('.sg-haut').classList.add('invisible')
  document.getElementById('sg-contenu').innerHTML = `
    <div class="sg-titre">Séance terminée</div>
    <div class="sg-bravo">Bravo !</div>
    <p class="carte-texte" style="text-align:center;">${minutes} minute${minutes > 1 ? 's' : ''} pour toi. Comment l'as-tu trouvée ?</p>
    <div class="ressentis">
      ${RESSENTIS.map(([cle, lib, emoji]) => `<button class="btn btn-secondaire ressenti" onclick="enregistrerRessenti('${cle}')">${icone(emoji, 'ressenti-icone')}${lib}</button>`).join('')}
    </div>
    <p class="message-info" style="text-align:center;">Ton ressenti sert à ajuster la progression. « Difficile » met la progression en pause, sans rien perdre.</p>`
}

async function enregistrerRessenti(ressenti) {
  const s = guidee.seance
  const champs = { statut: 'faite', ressenti, niveau: profil.sport_niveau || 1, duree_min: guidee.minutes, faite_le: new Date().toISOString() }
  const { error } = await db.from('seances').update(champs).eq('id', s.id)
  if (error) { gererErreur(error, "Impossible d'enregistrer la séance. Réessaie."); return }
  Object.assign(s, champs)
  document.getElementById('sg-commandes').classList.remove('hidden')
  fermerSeanceGuidee()
  afficherToast(ressenti === 'difficile' ? 'Séance enregistrée. Tu l\'as faite, c\'est ce qui compte.' : 'Séance enregistrée, bien joué !')
  if (pageActive === 'sport') chargerSport()
  else chargerPage(pageActive)
}

// ── Séance du jour sur la page Aujourd'hui ───────────────────
async function chargerSeanceDuJour() {
  const el = document.getElementById('aujourdhui-sport')
  if (!el) return
  if (!(await chargerExercices()) || !_exercices.length) { el.innerHTML = ''; return }
  if (!(await preparerSemaineSport())) return
  const s = seancesSemaine.find(x => x.date_prevue === dateISO() && x.statut !== 'abandonnee')
  if (!s) { el.innerHTML = ''; return }
  if (s.statut === 'faite') {
    el.innerHTML = `<div class="carte carte-cadre avec-etiquette seance-jour"><span class="etiquette etiquette-droite">Séance du jour</span>
      <span class="seance-jour-icone">${iconeRessenti(s.ressenti)}</span>
      <div class="seance-jour-texte"><strong>Séance faite, bravo !</strong><span>Profite de ta journée.</span></div></div>`
    return
  }
  const c = contenuSeance(s)
  el.innerHTML = `
    <div class="carte carte-cadre avec-etiquette seance-jour">
      <span class="etiquette etiquette-droite">Séance du jour</span>
      <span class="seance-jour-icone">${icone('haltere')}</span>
      <div class="seance-jour-texte">
        <strong>${LIBELLES_TYPES_SEANCE[s.type]}</strong>
        <span>environ ${c.dureeMin} min · ${c.circuit.length} exercices × ${c.tours} tours</span>
      </div>
      <button class="btn btn-primaire btn-rond" onclick="demarrerSeance('${s.id}')" aria-label="Commencer la séance">${icone('lecture')}</button>
    </div>`
}
