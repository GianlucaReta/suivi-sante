// ─────────────────────────────────────────────────────────────
// Graphiques (vue semaine / mois), projection, bilan hebdomadaire du dimanche
// Dépend de : app.js, calculs.js, profil.js, suivi.js (cycles), menus.js (lundiDe)
// Chart.js est chargé seulement à l'ouverture de l'onglet Courbes.
// Règles de lecture : une seule échelle par graphique, couleurs fixes par série,
// infobulle au survol, tableau des données sous chaque graphique.
// ─────────────────────────────────────────────────────────────

let periodeCourbes = (() => { try { return localStorage.getItem('ss_periode_courbes') || 'semaine' } catch (e) { return 'semaine' } })()
let _graphiques = []

function chargerChartJs() {
  if (window.Chart) return Promise.resolve()
  return new Promise((ok, ko) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
    s.onload = ok
    s.onerror = () => ko(new Error('Failed to fetch (Chart.js)'))
    document.head.appendChild(s)
  })
}

function couleursGraphiques() {
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
  return { s1: v('--serie-1'), s2: v('--serie-2'), s3: v('--serie-3'), texte: v('--muted'), grille: v('--border-soft'),
    reference: v('--muted-soft'), regles: v('--bande-regles'), luteale: v('--bande-luteale'), surface: v('--surface') }
}

function detruireGraphiques() { _graphiques.forEach(g => g.destroy()); _graphiques = [] }

// Bandes de fond pour les phases du cycle (règles, phase lutéale) : expliquent les variations d'eau
function pluginBandesCycle(phases, c) {
  return {
    id: 'bandesCycle',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart
      if (!phases?.some(Boolean)) return
      const largeur = x.getPixelForValue(1) - x.getPixelForValue(0) || chartArea.width
      phases.forEach((p, i) => {
        if (p !== 'regles' && p !== 'luteale') return
        ctx.save()
        ctx.fillStyle = p === 'regles' ? c.regles : c.luteale
        ctx.fillRect(x.getPixelForValue(i) - largeur / 2, chartArea.top, largeur, chartArea.bottom - chartArea.top)
        ctx.restore()
      })
    },
  }
}

// Bandes du cycle sur un axe de dates réelles (x en millisecondes)
function pluginBandesCycleDates(debutMs, finMs, c) {
  return {
    id: 'bandesCycleDates',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart
      for (let t = debutMs; t <= finMs; t += 86400000) {
        const p = phaseCycle(_cycles, dateISO(new Date(t)))?.phase
        if (p !== 'regles' && p !== 'luteale') continue
        const g = Math.max(chartArea.left, x.getPixelForValue(t - 43200000))
        const d = Math.min(chartArea.right, x.getPixelForValue(t + 43200000))
        if (d <= g) continue
        ctx.save()
        ctx.fillStyle = p === 'regles' ? c.regles : c.luteale
        ctx.fillRect(g, chartArea.top, d - g, chartArea.bottom - chartArea.top)
        ctx.restore()
      }
    },
  }
}

function creerGraphique(id, { type = 'line', labels, datasets, unite = '', min, max, phases = null, entier = false, xDates = null }) {
  const el = document.getElementById(id)
  if (!el) return
  const c = couleursGraphiques()
  const g = new Chart(el, {
    type,
    data: { labels, datasets },
    plugins: xDates ? [pluginBandesCycleDates(xDates[0], xDates[1], c)] : phases ? [pluginBandesCycle(phases, c)] : [],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.filter(d => !d.reference).length > 1, position: 'top', align: 'start',
          labels: { color: c.texte, boxWidth: 10, boxHeight: 10, usePointStyle: true, filter: i => !datasets[i.datasetIndex].reference } },
        tooltip: {
          backgroundColor: c.surface, titleColor: c.texte, bodyColor: c.texte, borderColor: c.grille, borderWidth: 1, padding: 10,
          filter: i => i.raw != null && (i.raw.y === undefined || i.raw.y != null),
          callbacks: {
            title: items => xDates ? new Date(items[0].parsed.x).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : items[0]?.label,
            label: i => `${i.dataset.label} : ${formatNombre(xDates ? i.parsed.y : i.raw, entier ? 0 : 1)}${unite ? ' ' + unite : ''}`,
          },
        },
      },
      scales: {
        x: xDates
          ? { type: 'linear', min: xDates[0], max: xDates[1], grid: { display: false }, border: { color: c.grille },
              ticks: { color: c.texte, maxRotation: 0, maxTicksLimit: 6, font: { size: 10 }, callback: v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}` } } }
          : { grid: { display: false }, ticks: { color: c.texte, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } }, border: { color: c.grille } },
        y: { min, max, grid: { color: c.grille }, ticks: { color: c.texte, font: { size: 10 }, maxTicksLimit: 5 }, border: { display: false } },
      },
      elements: { line: { borderWidth: 2, tension: 0.25 }, point: { radius: 3, hoverRadius: 5 }, bar: { borderRadius: 4, borderSkipped: 'start' } },
      spanGaps: true,
    },
  })
  _graphiques.push(g)
}

function tableDonnees(colonnes, lignes) {
  return `<details class="details"><summary>Voir les données</summary>
    <table class="table-donnees"><thead><tr>${colonnes.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${lignes.map(l => `<tr>${l.map(v => `<td>${v ?? '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`
}

// ═════════════════════════════════════════════════════════════
// DONNÉES D'UNE PÉRIODE
// ═════════════════════════════════════════════════════════════
async function donneesPeriode(debut, fin) {
  const debutISO = new Date(debut + 'T00:00:00').toISOString()
  const finISO = new Date(decalerDate(fin, 1) + 'T00:00:00').toISOString()
  const [rJ, rB, rS, rSu, rE] = await Promise.all([
    db.from('journal').select('date, kcal, proteines, sucres_ajoutes').gte('date', debut).lte('date', fin),
    db.from('bilans').select('*').gte('date', debut).lte('date', fin),
    db.from('seances').select('date_prevue, date_initiale, statut').gte('date_initiale', debut).lte('date_initiale', fin),
    db.from('sucreries').select('date, type, quantite').gte('date', debut).lte('date', fin),
    db.from('envies').select('moment, satisfaite').gte('moment', debutISO).lt('moment', finISO),
  ])
  for (const r of [rJ, rB, rS, rSu, rE]) if (r.error) { gererErreur(r.error, 'Impossible de charger les données.'); return null }
  const jours = []
  for (let d = debut; d <= fin; d = decalerDate(d, 1)) {
    const j = (rJ.data || []).filter(x => x.date === d)
    const b = (rB.data || []).find(x => x.date === d)
    const su = (rSu.data || []).filter(x => x.date === d)
    const en = (rE.data || []).filter(x => dateISO(new Date(x.moment)) === d)
    jours.push({
      date: d,
      kcal: j.reduce((s, x) => s + Number(x.kcal), 0),
      proteines: j.reduce((s, x) => s + Number(x.proteines), 0),
      sucres_ajoutes: j.reduce((s, x) => s + Number(x.sucres_ajoutes), 0),
      aJournal: j.length > 0,
      depense: b ? depenseAjustee(b.kcal_repos, b.kcal_actives, profil.pct_calories_actives ?? 50) : null,
      sommeil_min: b?.sommeil_min ?? null,
      humeur: b?.humeur ?? null,
      cookies: su.filter(x => x.type === 'cookie').reduce((s, x) => s + Number(x.quantite), 0),
      chocolat: su.filter(x => x.type === 'chocolat').reduce((s, x) => s + Number(x.quantite), 0),
      sucreries: su.reduce((s, x) => s + Number(x.quantite), 0),
      envies: en.length,
      enviesPassees: en.filter(x => x.satisfaite === false).length,
    })
  }
  return { jours, seances: rS.data || [] }
}

// ═════════════════════════════════════════════════════════════
// BILAN DE LA SEMAINE (chaque dimanche)
// ═════════════════════════════════════════════════════════════
// Le dimanche : la semaine en cours. Les autres jours : la dernière semaine complète.
function lundiDuBilan() {
  const auj = new Date(dateISO() + 'T12:00:00')
  return auj.getDay() === 0 ? lundiDe() : decalerDate(lundiDe(), -7)
}

async function calculerBilanSemaine(lundi) {
  const dimanche = decalerDate(lundi, 6)
  const [d, rAvant, rP] = await Promise.all([
    donneesPeriode(lundi, dimanche),
    db.from('sucreries').select('quantite').gte('date', decalerDate(lundi, -7)).lt('date', lundi),
    db.from('pesees').select('date, poids').lte('date', dimanche).gte('date', decalerDate(lundi, -10)).order('date'),
  ])
  if (!d) return null
  const pesees = rP.data || []
  const avant = pesees.filter(p => p.date < lundi).at(-1) || pesees[0]
  const apres = pesees.filter(p => p.date >= lundi).at(-1)
  return bilanSemaine({
    jours: d.jours,
    cibleKcal: cibleKcalDuJour(), cibleProteines: profil.cible_proteines,
    seancesFaites: d.seances.filter(s => s.statut === 'faite').length,
    seancesPrevues: d.seances.length,
    sucreriesAvant: (rAvant.data || []).reduce((s, x) => s + Number(x.quantite), 0),
    poidsDebut: avant && apres && avant !== apres ? Number(avant.poids) : null,
    poidsFin: apres ? Number(apres.poids) : null,
  })
}

function renduBilanSemaine(b, lundi) {
  return `
    <div class="carte carte-aujourdhui">
      <div class="carte-titre">Ton bilan de la semaine</div>
      <p class="message-info" style="margin-top:0;">Du ${formatDate(lundi)} au ${formatDate(decalerDate(lundi, 6))}</p>
      <div class="sous-titre-carte">Points forts</div>
      <ul class="liste-bilan">${b.pointsForts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      <div class="sous-titre-carte">Sucre</div>
      <p class="carte-texte">${esc(b.tendanceSucre)}</p>
      <div class="sous-titre-carte">Conseil</div>
      <p class="carte-texte">${esc(b.conseil)}</p>
    </div>`
}

async function chargerBilanSemaineAujourdhui() {
  const el = document.getElementById('aujourdhui-bilan-semaine')
  if (!el) return
  const jour = new Date().getDay()
  if (jour !== 0 && jour !== 1) { el.innerHTML = ''; return }   // dimanche et lundi
  const lundi = lundiDuBilan()
  const b = await calculerBilanSemaine(lundi)
  el.innerHTML = b ? renduBilanSemaine(b, lundi) : ''
}

// ═════════════════════════════════════════════════════════════
// ONGLET COURBES
// ═════════════════════════════════════════════════════════════
function changerPeriodeCourbes(p) {
  periodeCourbes = p
  try { localStorage.setItem('ss_periode_courbes', p) } catch (e) {}
  afficherCourbes()
}

async function afficherCourbes() {
  const el = document.getElementById('suivi-onglet')
  detruireGraphiques()
  const auj = dateISO()
  const nbJours = periodeCourbes === 'mois' ? 30 : 7
  const debut = decalerDate(auj, -(nbJours - 1))
  const semainesPoids = periodeCourbes === 'mois' ? 26 : 8

  let donnees, pesees, lundiBilan, bilan
  try {
    [, donnees, { data: pesees }] = await Promise.all([
      chargerChartJs(),
      donneesPeriode(debut, auj),
      db.from('pesees').select('*').gte('date', decalerDate(auj, -7 * semainesPoids)).order('date'),
      chargerCycles(),
    ])
  } catch (e) { gererErreur(e, 'Impossible de charger les graphiques.'); return }
  if (!donnees) return
  lundiBilan = lundiDuBilan()
  bilan = await calculerBilanSemaine(lundiBilan)

  const jours = donnees.jours
  const libelle = d => {
    const x = new Date(d + 'T12:00:00')
    return periodeCourbes === 'mois' ? `${x.getDate()}/${x.getMonth() + 1}` : x.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
  }
  const labels = jours.map(j => libelle(j.date))
  const phases = jours.map(j => phaseCycle(_cycles, j.date)?.phase || null)
  pesees = pesees || []
  const objectif = Number(profil.poids_objectif)
  const proj = projectionObjectif(pesees, objectif, auj)
  const seancesFaites = donnees.seances.filter(s => s.statut === 'faite').length
  const seancesAbandon = donnees.seances.filter(s => s.statut === 'abandonnee').length
  const seancesPrevues = donnees.seances.filter(s => s.statut === 'prevue').length
  const avecJournal = jours.filter(j => j.aJournal)
  const avecDepense = jours.filter(j => j.aJournal && j.depense != null)
  let cumul = 0
  const deficitCumule = jours.map(j => { if (j.aJournal && j.depense != null) cumul += j.depense - j.kcal; return j.aJournal && j.depense != null ? cumul : null })
  const moy = (a, k) => a.length ? Math.round(a.reduce((s, x) => s + x[k], 0) / a.length) : null
  const h = m => m == null ? null : Math.round(m / 6) / 10
  const legendeCycle = phases.some(p => p === 'regles' || p === 'luteale')
    ? `<p class="message-info legende"><span class="pastille" style="background:var(--bande-regles)"></span> règles <span class="pastille" style="background:var(--bande-luteale)"></span> phase lutéale (rétention d'eau possible)</p>` : ''

  el.innerHTML = `
    <div class="segmente segmente-large" style="margin-bottom:var(--sp-4);">
      <button class="${periodeCourbes === 'semaine' ? 'active' : ''}" onclick="changerPeriodeCourbes('semaine')">7 derniers jours</button>
      <button class="${periodeCourbes === 'mois' ? 'active' : ''}" onclick="changerPeriodeCourbes('mois')">30 derniers jours</button>
    </div>

    ${bilan ? renduBilanSemaine(bilan, lundiBilan) : ''}

    <div class="carte">
      <div class="carte-titre">Poids</div>
      ${pesees.length ? `<div class="graphique"><canvas id="g-poids" aria-label="Courbe du poids"></canvas></div>` : '<p class="carte-texte">Pas encore de pesée.</p>'}
      <p class="carte-texte">${proj.date ? `Au rythme actuel (${formatNombre(proj.parSemaine, 2)} kg par semaine), arrivée à ${formatNombre(objectif, 1)} kg vers le <strong>${new Date(proj.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.`
        : proj.atteint ? 'Objectif atteint, bravo !' : proj.raison === 'stable' ? 'Poids stable sur les dernières semaines : c\'est normal par moments (eau, cycle, muscle). La projection reviendra avec les prochaines pesées.'
        : 'La projection apparaîtra après quelques pesées hebdomadaires (au moins 2, sur 10 jours ou plus).'}</p>
      ${pesees.length ? `<p class="message-info">${proj.date ? 'Pointillés : la tendance des 4 prochaines semaines au rythme actuel.' : ''}${pesees.some(p => ['regles', 'luteale'].includes(phaseCycle(_cycles, p.date)?.phase)) ? ' Fond coloré : règles ou phase lutéale, quand l\'eau peut faire varier le poids.' : ''}</p>` : ''}
      ${pesees.length ? tableDonnees(['Date', 'Poids (kg)', 'Masse grasse (%)', 'Muscle (%)'], [...pesees].reverse().map(p => [formatDate(p.date), formatNombre(p.poids, 1), p.masse_grasse_pct != null ? formatNombre(p.masse_grasse_pct, 1) : null, p.masse_musculaire_pct != null ? formatNombre(p.masse_musculaire_pct, 1) : null])) : ''}
    </div>

    ${pesees.some(p => p.masse_grasse_pct != null || p.masse_musculaire_pct != null) ? `
    <div class="carte">
      <div class="carte-titre">Composition corporelle (estimations)</div>
      <div class="graphique"><canvas id="g-composition" aria-label="Masse grasse et masse musculaire"></canvas></div>
      <p class="message-info">Mesures par impédance : à lire comme une tendance, elles varient avec l'hydratation.</p>
    </div>` : ''}

    <div class="carte">
      <div class="carte-titre">Calories mangées et dépensées</div>
      <div class="graphique"><canvas id="g-calories" aria-label="Calories mangées et dépensées par jour"></canvas></div>
      <div class="ligne"><span>Moyenne mangée</span><span class="ligne-valeur">${moy(avecJournal, 'kcal') != null ? formatNombre(moy(avecJournal, 'kcal')) + ' kcal / jour' : '–'}</span></div>
      <div class="ligne"><span>Moyenne dépensée</span><span class="ligne-valeur">${avecDepense.length ? formatNombre(Math.round(avecDepense.reduce((s, j) => s + j.depense, 0) / avecDepense.length)) + ' kcal / jour' : '–'}</span></div>
      ${tableDonnees(['Jour', 'Mangées', 'Dépensées'], jours.map(j => [libelle(j.date), j.aJournal ? formatNombre(j.kcal) : null, j.depense != null ? formatNombre(j.depense) : null]))}
    </div>

    <div class="carte">
      <div class="carte-titre">Déficit cumulé</div>
      ${avecDepense.length ? `<div class="graphique graphique-petit"><canvas id="g-deficit" aria-label="Déficit cumulé"></canvas></div>
      <p class="carte-texte">${cumul >= 0 ? `${formatNombre(cumul)} kcal de déficit sur la période, soit environ <strong>${formatNombre(cumul / 7700, 1)} kg</strong> de masse grasse.` : `Léger surplus sur la période (${formatNombre(-cumul)} kcal) : ça arrive, la tendance sur plusieurs semaines compte plus.`}</p>
      <p class="message-info">Calculé les jours où le journal et le bilan du soir sont remplis.</p>`
      : '<p class="carte-texte">Remplis le journal et le bilan du soir pour voir ton déficit cumulé.</p>'}
    </div>

    <div class="carte">
      <div class="carte-titre">Protéines</div>
      <div class="graphique graphique-petit"><canvas id="g-proteines" aria-label="Protéines par jour"></canvas></div>
      <p class="message-info">Objectif atteint ${avecJournal.filter(j => profil.cible_proteines && j.proteines >= profil.cible_proteines * 0.95).length} jour(s) sur ${avecJournal.length} jour(s) avec journal.</p>
    </div>

    <div class="carte">
      <div class="carte-titre">Sport</div>
      <div class="reperes reperes-3">
        <div class="repere"><span class="repere-valeur">${seancesFaites}</span><span class="repere-unite">faite${seancesFaites > 1 ? 's' : ''}</span></div>
        <div class="repere"><span class="repere-valeur">${seancesPrevues}</span><span class="repere-unite">à venir</span></div>
        <div class="repere"><span class="repere-valeur">${seancesAbandon}</span><span class="repere-unite">pas cette fois</span></div>
      </div>
    </div>

    <div class="carte">
      <div class="carte-titre">Sucre</div>
      <div class="sous-titre-carte">Sucres ajoutés (g par jour)</div>
      <div class="graphique graphique-petit"><canvas id="g-sucres" aria-label="Sucres ajoutés par jour"></canvas></div>
      <div class="sous-titre-carte">Cookies et carrés de chocolat</div>
      <div class="graphique graphique-petit"><canvas id="g-sucreries" aria-label="Cookies et chocolat par jour"></canvas></div>
      <div class="sous-titre-carte">Envies de sucre</div>
      <div class="graphique graphique-petit"><canvas id="g-envies" aria-label="Envies de sucre par jour"></canvas></div>
      ${legendeCycle}
      ${tableDonnees(['Jour', 'Sucres ajoutés (g)', 'Cookies', 'Chocolat', 'Envies'], jours.map(j => [libelle(j.date), j.aJournal ? formatNombre(j.sucres_ajoutes) : null, j.cookies, j.chocolat, j.envies]))}
    </div>

    <div class="carte">
      <div class="carte-titre">Sommeil</div>
      <div class="graphique graphique-petit"><canvas id="g-sommeil" aria-label="Heures de sommeil"></canvas></div>
      <div class="sous-titre-carte">Humeur (1 à 5)</div>
      <div class="graphique graphique-petit"><canvas id="g-humeur" aria-label="Humeur"></canvas></div>
      ${tableDonnees(['Jour', 'Sommeil (h)', 'Humeur'], jours.map(j => [libelle(j.date), j.sommeil_min != null ? formatNombre(h(j.sommeil_min), 1) : null, j.humeur]))}
    </div>`

  const c = couleursGraphiques()

  // Poids : courbe + objectif + projection (pointillés), phases du cycle en fond
  if (pesees.length) {
    const ms = d => new Date(d + 'T12:00:00').getTime()
    const points = pesees.map(p => ({ x: ms(p.date), y: Number(p.poids) }))
    const debutMs = points[0].x - 2 * 86400000   // l'axe commence à la première pesée affichée
    const derniere = points.at(-1)
    // Projection : 4 semaines au rythme actuel (la date d'arrivée est donnée dans le texte)
    const projection = proj.date ? [derniere, { x: derniere.x + 28 * 86400000, y: Math.max(objectif, derniere.y - proj.parSemaine * 4) }] : []
    const finMs = proj.date ? projection[1].x : ms(auj)
    const minPoids = Math.min(...points.map(p => p.y))
    const objectifVisible = objectif && minPoids - objectif <= 3
    creerGraphique('g-poids', {
      unite: 'kg', xDates: [debutMs, finMs],
      datasets: [
        { label: 'Poids', data: points, borderColor: c.s1, backgroundColor: c.s1, pointRadius: 4 },
        ...(proj.date ? [{ label: 'Projection', data: projection, borderColor: c.s1, borderDash: [5, 5], pointRadius: 0, reference: true }] : []),
        ...(objectifVisible ? [{ label: 'Objectif', data: [{ x: debutMs, y: objectif }, { x: finMs, y: objectif }], borderColor: c.reference, borderDash: [2, 4], pointRadius: 0, borderWidth: 1.5, reference: true }] : []),
      ],
    })
  }
  if (document.getElementById('g-composition')) {
    const ms = d => new Date(d + 'T12:00:00').getTime()
    creerGraphique('g-composition', {
      unite: '%', xDates: [ms(pesees[0].date), ms(pesees.at(-1).date)],
      datasets: [
        { label: 'Masse grasse', data: pesees.filter(p => p.masse_grasse_pct != null).map(p => ({ x: ms(p.date), y: Number(p.masse_grasse_pct) })), borderColor: c.s2, backgroundColor: c.s2 },
        { label: 'Masse musculaire', data: pesees.filter(p => p.masse_musculaire_pct != null).map(p => ({ x: ms(p.date), y: Number(p.masse_musculaire_pct) })), borderColor: c.s3, backgroundColor: c.s3 },
      ],
    })
  }
  creerGraphique('g-calories', {
    type: 'bar', labels, unite: 'kcal', entier: true,
    datasets: [
      { label: 'Mangées', data: jours.map(j => j.aJournal ? j.kcal : null), backgroundColor: c.s1, maxBarThickness: 18, order: 2 },
      { type: 'line', label: 'Dépensées', data: jours.map(j => j.depense), borderColor: c.s2, backgroundColor: c.s2, order: 1 },
      ...(cibleKcalDuJour() ? [{ type: 'line', label: 'Cible', data: jours.map(() => cibleKcalDuJour()), borderColor: c.reference, borderDash: [2, 4], pointRadius: 0, borderWidth: 1.5, reference: true, order: 0 }] : []),
    ],
  })
  if (document.getElementById('g-deficit')) {
    creerGraphique('g-deficit', { labels, unite: 'kcal', entier: true, datasets: [{ label: 'Déficit cumulé', data: deficitCumule, borderColor: c.s3, backgroundColor: c.s3 }] })
  }
  creerGraphique('g-proteines', {
    type: 'bar', labels, unite: 'g', entier: true, min: 0,
    datasets: [
      { label: 'Protéines', data: jours.map(j => j.aJournal ? Math.round(j.proteines) : null), backgroundColor: c.s1, maxBarThickness: 18 },
      ...(profil.cible_proteines ? [{ type: 'line', label: 'Objectif', data: jours.map(() => profil.cible_proteines), borderColor: c.reference, borderDash: [2, 4], pointRadius: 0, borderWidth: 1.5, reference: true }] : []),
    ],
  })
  creerGraphique('g-sucres', { type: 'bar', labels, unite: 'g', entier: true, min: 0, phases,
    datasets: [{ label: 'Sucres ajoutés', data: jours.map(j => j.aJournal ? Math.round(j.sucres_ajoutes) : null), backgroundColor: c.s2, maxBarThickness: 18 }] })
  creerGraphique('g-sucreries', { type: 'bar', labels, entier: true, min: 0, phases,
    datasets: [
      { label: 'Cookies', data: jours.map(j => j.cookies), backgroundColor: c.s2, stack: 's', maxBarThickness: 18 },
      { label: 'Chocolat', data: jours.map(j => j.chocolat), backgroundColor: c.s1, stack: 's', maxBarThickness: 18 },
    ] })
  _graphiques.at(-1).options.scales.x.stacked = true
  _graphiques.at(-1).options.scales.y.stacked = true
  _graphiques.at(-1).options.scales.y.ticks.precision = 0
  _graphiques.at(-1).update()
  creerGraphique('g-envies', { type: 'bar', labels, entier: true, min: 0, phases,
    datasets: [{ label: 'Envies', data: jours.map(j => j.envies), backgroundColor: c.s3, maxBarThickness: 18 }] })
  _graphiques.at(-1).options.scales.y.ticks.precision = 0
  _graphiques.at(-1).update()
  creerGraphique('g-sommeil', { type: 'bar', labels, unite: 'h', min: 0,
    datasets: [
      { label: 'Sommeil', data: jours.map(j => h(j.sommeil_min)), backgroundColor: c.s1, maxBarThickness: 18 },
      { type: 'line', label: 'Repère 7 h', data: jours.map(() => 7), borderColor: c.reference, borderDash: [2, 4], pointRadius: 0, borderWidth: 1.5, reference: true },
    ] })
  creerGraphique('g-humeur', { labels, min: 1, max: 5, entier: true,
    datasets: [{ label: 'Humeur', data: jours.map(j => j.humeur), borderColor: c.s2, backgroundColor: c.s2 }] })
}
