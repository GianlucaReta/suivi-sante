// ─────────────────────────────────────────────────────────────
// Suivi quotidien : bilan du soir, pesée hebdomadaire, module sucre, cycle
// Dépend de : app.js, calculs.js, profil.js, journal.js (totaux), sport.js
// ─────────────────────────────────────────────────────────────

const ONGLETS_SUIVI = [['bilan', 'Bilan'], ['pesee', 'Pesée'], ['sucre', 'Sucre'], ['cycle', 'Cycle']]
const EMOJIS_ECHELLE = ['😞', '😕', '😐', '🙂', '😄']
const DECLENCHEURS = [['stress', 'Stress'], ['ennui', 'Ennui'], ['fatigue', 'Fatigue'], ['apres_repas', 'Après un repas'], ['soir', 'Le soir'], ['emotion', 'Émotion'], ['recompense', 'Envie de me faire plaisir'], ['autre', 'Autre']]
const IDEES_ALTERNATIVES = ['Un thé ou une infusion', 'Un fruit', 'Un yaourt nature avec un peu de miel', 'Un carré de chocolat noir 70 %', 'Une poignée d\'amandes',
  'Un grand verre d\'eau pétillante', 'Marcher 10 minutes', 'Me brosser les dents', 'Appeler ou écrire à quelqu\'un', 'Attendre 10 minutes et voir si l\'envie passe']
const LIBELLES_PHASES = {
  regles: ['Règles', 'Fatigue et envies de sucre possibles : sois douce avec toi.'],
  folliculaire: ['Phase folliculaire', 'Souvent une période d\'énergie : bon moment pour les séances.'],
  ovulation: ['Ovulation', 'Le poids peut varier un peu ces jours-ci.'],
  luteale: ['Phase lutéale', 'Rétention d\'eau possible : le poids peut monter de 0,5 à 1,5 kg sans aucune prise de gras. Les envies de sucre sont aussi plus fréquentes.'],
}

let ongletSuivi = (() => { try { return localStorage.getItem('ss_onglet_suivi') || 'bilan' } catch (e) { return 'bilan' } })()
let dateBilan = dateISO()
let _bilanSaisie = {}
let _cycles = []

function changerOngletSuivi(o) {
  ongletSuivi = o
  try { localStorage.setItem('ss_onglet_suivi', o) } catch (e) {}
  chargerSuivi()
}

async function chargerSuivi() {
  const el = document.getElementById('suivi-contenu')
  const tete = `<div class="segmente segmente-large" style="margin-bottom:var(--sp-4);">
    ${ONGLETS_SUIVI.map(([k, l]) => `<button class="${ongletSuivi === k ? 'active' : ''}" onclick="changerOngletSuivi('${k}')">${l}</button>`).join('')}</div>`
  el.innerHTML = tete + '<div id="suivi-onglet"><div class="spinner" style="margin:var(--sp-6) auto;"></div></div>'
  if (ongletSuivi === 'bilan') await afficherBilan()
  if (ongletSuivi === 'pesee') await afficherPesees()
  if (ongletSuivi === 'sucre') await afficherSucre()
  if (ongletSuivi === 'cycle') await afficherCycle()
}

function boutonsEchelle(champ, valeur, fn = 'choisirEchelleBilan') {
  return `<div class="echelle">${EMOJIS_ECHELLE.map((e, i) => `<button type="button" class="echelle-btn ${valeur === i + 1 ? 'active' : ''}" onclick="${fn}('${champ}', ${i + 1})" aria-label="${i + 1} sur 5">${e}</button>`).join('')}</div>`
}

function nombreChamp(id) {
  const v = document.getElementById(id)?.value?.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return isNaN(n) ? NaN : n
}

// ═════════════════════════════════════════════════════════════
// BILAN DU SOIR
// ═════════════════════════════════════════════════════════════
async function donneesDuJour(date) {
  const [rB, rJ, rS, rE] = await Promise.all([
    db.from('bilans').select('*').eq('date', date).maybeSingle(),
    db.from('journal').select('kcal, proteines').eq('date', date),
    db.from('seances').select('statut, ressenti, duree_min').eq('date_prevue', date).eq('statut', 'faite'),
    db.from('envies').select('id').gte('moment', new Date(date + 'T00:00:00').toISOString()).lt('moment', new Date(decalerDate(date, 1) + 'T00:00:00').toISOString()),
  ])
  if (rB.error) { gererErreur(rB.error, 'Impossible de charger le bilan.'); return null }
  return {
    bilan: rB.data,
    kcalMangees: (rJ.data || []).reduce((s, e) => s + Number(e.kcal), 0),
    proteines: (rJ.data || []).reduce((s, e) => s + Number(e.proteines), 0),
    nbAliments: rJ.data?.length || 0,
    seance: rS.data?.[0] || null,
    nbEnvies: rE.data?.length || 0,
  }
}

async function afficherBilan() {
  const el = document.getElementById('suivi-onglet')
  const d = await donneesDuJour(dateBilan)
  if (!d) return
  const b = d.bilan || {}
  _bilanSaisie = { sommeil_qualite: b.sommeil_qualite ?? null, humeur: b.humeur ?? null }
  const h = b.sommeil_min != null ? Math.floor(b.sommeil_min / 60) : ''
  const m = b.sommeil_min != null ? b.sommeil_min % 60 : ''
  el.innerHTML = `
    <div class="nav-jour">
      <button class="btn btn-secondaire" onclick="dateBilan = decalerDate(dateBilan, -1); afficherBilan()" aria-label="Jour précédent">‹</button>
      <span class="nav-jour-libelle">${libelleDate(dateBilan)}</span>
      <button class="btn btn-secondaire" onclick="dateBilan = decalerDate(dateBilan, 1); afficherBilan()" ${dateBilan >= dateISO() ? 'disabled' : ''} aria-label="Jour suivant">›</button>
    </div>
    ${d.bilan ? renduResultatBilan(d) : ''}
    <div class="carte">
      <div class="carte-titre">${d.bilan ? 'Modifier le bilan' : 'Bilan du soir'}</div>
      <p class="message-info" style="margin-top:0;">Moins d'une minute : recopie les chiffres de ta montre.</p>
      <div class="grille-2">
        <label class="champ"><span class="champ-label">Calories actives</span><input id="bs-actives" class="input" inputmode="numeric" value="${esc(b.kcal_actives ?? '')}" placeholder="kcal" /></label>
        <label class="champ"><span class="champ-label">Calories au repos</span><input id="bs-repos" class="input" inputmode="numeric" value="${esc(b.kcal_repos ?? '')}" placeholder="kcal" /></label>
      </div>
      <label class="champ"><span class="champ-label">Nombre de pas</span><input id="bs-pas" class="input" inputmode="numeric" value="${esc(b.pas ?? '')}" /></label>
      <div class="champ"><span class="champ-label">Sommeil de la nuit dernière</span>
        <div class="grille-2">
          <div class="input-unite"><input id="bs-som-h" class="input" inputmode="numeric" value="${h}" placeholder="7" /><span>h</span></div>
          <div class="input-unite"><input id="bs-som-m" class="input" inputmode="numeric" value="${m}" placeholder="30" /><span>min</span></div>
        </div></div>
      <div class="champ"><span class="champ-label">Qualité du sommeil</span>${boutonsEchelle('sommeil_qualite', _bilanSaisie.sommeil_qualite)}</div>
      <div class="champ"><span class="champ-label">Humeur de la journée</span>${boutonsEchelle('humeur', _bilanSaisie.humeur)}</div>
      <div class="auto-rempli">
        <div><strong>${formatNombre(d.kcalMangees)}</strong> kcal mangées <span class="option-detail">(journal, ${d.nbAliments} aliment${d.nbAliments > 1 ? 's' : ''})</span></div>
        <div>${d.seance ? `Séance de sport faite ✓` : 'Pas de séance de sport'}</div>
        <div>${d.nbEnvies} envie${d.nbEnvies > 1 ? 's' : ''} de sucre notée${d.nbEnvies > 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-primaire btn-bloc" onclick="enregistrerBilan()">Enregistrer le bilan</button>
    </div>`
}

function choisirEchelleBilan(champ, v) {
  _bilanSaisie[champ] = _bilanSaisie[champ] === v ? null : v
  document.querySelectorAll(`.echelle-btn[onclick*="'${champ}'"]`).forEach((b, i) => b.classList.toggle('active', _bilanSaisie[champ] === i + 1))
}

async function enregistrerBilan() {
  const actives = nombreChamp('bs-actives'), repos = nombreChamp('bs-repos'), pas = nombreChamp('bs-pas')
  const h = nombreChamp('bs-som-h'), m = nombreChamp('bs-som-m')
  if ([actives, repos, pas, h, m].some(v => Number.isNaN(v))) { afficherToast('Un des champs n\'est pas un nombre.', true); return }
  if (h != null && (h < 0 || h > 16)) { afficherToast('Sommeil : indique les heures (entre 0 et 16).', true); return }
  if (m != null && (m < 0 || m > 59)) { afficherToast('Sommeil : les minutes vont de 0 à 59.', true); return }
  if (actives != null && actives > 5000 || repos != null && repos > 5000) { afficherToast('Les calories semblent trop élevées : vérifie les chiffres de la montre.', true); return }
  const ligne = {
    user_id: utilisateur.id, date: dateBilan,
    kcal_actives: actives != null ? Math.round(actives) : null, kcal_repos: repos != null ? Math.round(repos) : null,
    pas: pas != null ? Math.round(pas) : null,
    sommeil_min: h != null || m != null ? Math.round((h || 0) * 60 + (m || 0)) : null,
    sommeil_qualite: _bilanSaisie.sommeil_qualite, humeur: _bilanSaisie.humeur,
  }
  const { error } = await db.from('bilans').upsert(ligne, { onConflict: 'user_id,date' })
  if (error) { gererErreur(error, "Impossible d'enregistrer le bilan."); return }
  afficherToast('Bilan enregistré 🌙')
  afficherBilan()
}

function renduResultatBilan(d) {
  const b = d.bilan
  const depense = depenseAjustee(b.kcal_repos, b.kcal_actives, profil.pct_calories_actives ?? 50)
  const deficit = depense != null ? depense - d.kcalMangees : null
  const cibleP = profil.cible_proteines || 0
  const protOk = cibleP && d.proteines >= cibleP * 0.95
  const message = messageDuSoir({ deficit, proteinesAtteintes: protOk, sportFait: !!d.seance, sommeilMin: b.sommeil_min, kcalMangees: d.nbAliments ? d.kcalMangees : 0, graine: b.date })
  return `
    <div class="carte carte-aujourdhui">
      <div class="carte-titre">Ta journée</div>
      <div class="reperes">
        <div class="repere"><span class="repere-valeur">${depense != null ? formatNombre(depense) : '–'}</span><span class="repere-unite">kcal dépensées*</span></div>
        <div class="repere"><span class="repere-valeur">${formatNombre(d.kcalMangees)}</span><span class="repere-unite">kcal mangées</span></div>
      </div>
      <div class="ligne"><span>${deficit == null ? 'Déficit' : deficit >= 0 ? 'Déficit du jour' : 'Au-dessus de la dépense'}</span><span class="ligne-valeur">${deficit != null ? formatNombre(Math.abs(deficit)) + ' kcal' : 'renseigne la montre'}</span></div>
      <div class="ligne"><span>Protéines</span><span class="ligne-valeur">${formatNombre(d.proteines)} / ${formatNombre(cibleP)} g ${protOk ? '✓' : ''}</span></div>
      <p class="carte-texte" style="margin-top:var(--sp-3);">${esc(message)}</p>
      <p class="message-info">* calories au repos + ${profil.pct_calories_actives ?? 50} % des calories actives (réglable dans les réglages).</p>
    </div>`
}

// ═════════════════════════════════════════════════════════════
// PESÉE HEBDOMADAIRE
// ═════════════════════════════════════════════════════════════
async function chargerDernierePesee() {
  const { data, error } = await db.from('pesees').select('date, poids').order('date', { ascending: false }).limit(1)
  if (error) { console.error(error); return }
  dernierPoids = data?.[0] ? Number(data[0].poids) : null
}

async function chargerCycles() {
  const { data, error } = await db.from('cycles').select('*').order('date_debut')
  if (error) { console.error(error); return [] }
  _cycles = data || []
  return _cycles
}

const CHAMPS_IMPEDANCE = [
  ['masse_grasse_pct', 'Masse grasse', '%', -1], ['masse_hydrique_pct', 'Masse hydrique', '%', 1],
  ['masse_musculaire_pct', 'Masse musculaire', '%', 1], ['masse_osseuse_kg', 'Masse osseuse', 'kg', 0],
  ['graisse_viscerale', 'Graisse viscérale', '', -1], ['tmb', 'TMB (balance)', 'kcal', 0], ['imc', 'IMC', '', 0],
]

async function afficherPesees() {
  const el = document.getElementById('suivi-onglet')
  const [rP] = await Promise.all([db.from('pesees').select('*').order('date', { ascending: false }).limit(12), chargerCycles()])
  if (rP.error) { gererErreur(rP.error, 'Impossible de charger les pesées.'); return }
  const pesees = rP.data || []
  const der = pesees[0], prec = pesees[1]
  const joursDepuis = der ? Math.round((new Date(dateISO() + 'T12:00:00') - new Date(der.date + 'T12:00:00')) / 86400000) : null
  const phase = phaseCycle(_cycles, dateISO())
  const o = objectifsActuels()
  const fleche = (a, b, sens) => {
    if (a == null || b == null || Number(a) === Number(b)) return ''
    const monte = Number(a) > Number(b)
    const bien = sens === 0 ? null : (monte ? sens > 0 : sens < 0)
    return `<span class="tendance ${bien === true ? 'tendance-bien' : bien === false ? 'tendance-neutre' : ''}">${monte ? '↗' : '↘'}</span>`
  }

  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Pesée de la semaine</div>
      <p class="carte-texte">Pèse-toi <strong>une fois par semaine, le même jour, le matin, à jeun</strong>, après être passée aux toilettes. C'est la tendance sur plusieurs semaines qui compte, pas une pesée isolée.</p>
      ${der ? `<p class="message-info">Dernière pesée ${joursDepuis === 0 ? "aujourd'hui" : joursDepuis === 1 ? 'hier' : `il y a ${joursDepuis} jours`}.</p>` : ''}
      ${phase && ['luteale', 'regles'].includes(phase.phase) ? `<p class="info-cycle">🌙 ${LIBELLES_PHASES[phase.phase][0]} : ${LIBELLES_PHASES[phase.phase][1]}</p>` : ''}
      <button class="btn btn-primaire btn-bloc" style="margin-top:var(--sp-3);" onclick="ouvrirPesee()">${der?.date === dateISO() ? 'Modifier la pesée du jour' : 'Noter une pesée'}</button>
    </div>
    ${der ? `
    <div class="carte">
      <div class="carte-titre">Dernière pesée · ${formatDate(der.date)}</div>
      <div class="reperes">
        <div class="repere"><span class="repere-valeur">${formatNombre(der.poids, 1)} kg ${fleche(der.poids, prec?.poids, -1)}</span><span class="repere-unite">${prec ? `${Number(der.poids) <= Number(prec.poids) ? '−' : '+'}${formatNombre(Math.abs(der.poids - prec.poids), 1)} kg depuis le ${formatDate(prec.date)}` : 'poids'}</span></div>
        <div class="repere"><span class="repere-valeur">${profil.poids_objectif ? formatNombre(Math.max(0, der.poids - profil.poids_objectif), 1) + ' kg' : '–'}</span><span class="repere-unite">avant l'objectif</span></div>
      </div>
      ${CHAMPS_IMPEDANCE.filter(([k]) => der[k] != null).map(([k, lib, u, sens]) => `
        <div class="ligne"><span>${lib}</span><span class="ligne-valeur">${formatNombre(der[k], k === 'tmb' ? 0 : 1)} ${u} ${fleche(der[k], prec?.[k], sens)}</span></div>`).join('')}
      ${der.tmb && o ? `<p class="message-info">TMB calculé par le site (Mifflin-St Jeor) : ${formatNombre(o.tmb)} kcal, contre ${formatNombre(der.tmb)} kcal pour la balance.</p>` : ''}
      <p class="message-info">Masse grasse, eau et muscles sont des <strong>estimations</strong> de la balance (impédancemétrie) : elles varient selon l'hydratation. Regarde-les comme des tendances ; le poids reste la donnée de référence.</p>
    </div>
    <div class="carte">
      <div class="carte-titre">Historique</div>
      ${pesees.map((p, i) => `<button class="ligne ligne-action" onclick="ouvrirPesee('${p.date}')"><span>${formatDate(p.date)}</span><span class="ligne-valeur">${formatNombre(p.poids, 1)} kg ${fleche(p.poids, pesees[i + 1]?.poids, -1)}</span><span class="chevron">›</span></button>`).join('')}
    </div>` : ''}`
}

async function ouvrirPesee(date = dateISO()) {
  const { data: p } = await db.from('pesees').select('*').eq('date', date).maybeSingle()
  const champ = (id, lib, v, aide = '') => `<label class="champ"><span class="champ-label">${lib}</span>
    <input id="${id}" class="input" type="text" inputmode="decimal" value="${v == null ? '' : String(v).replace('.', ',')}" placeholder="${aide}" /></label>`
  ouvrirFeuille(p ? 'Modifier la pesée' : 'Nouvelle pesée', `
    <label class="champ"><span class="champ-label">Date</span><input id="pe-date" class="input" type="date" max="${dateISO()}" value="${date}" /></label>
    ${champ('pe-poids', 'Poids (kg)', p?.poids, '65,0')}
    <p class="message-info">Facultatif : les autres valeurs de la balance Terraillon.</p>
    <div class="grille-2">
      ${champ('pe-mg', 'Masse grasse (%)', p?.masse_grasse_pct)}
      ${champ('pe-mh', 'Masse hydrique (%)', p?.masse_hydrique_pct)}
      ${champ('pe-mm', 'Masse musculaire (%)', p?.masse_musculaire_pct)}
      ${champ('pe-mo', 'Masse osseuse (kg)', p?.masse_osseuse_kg)}
      ${champ('pe-tmb', 'TMB (kcal)', p?.tmb)}
      ${champ('pe-imc', 'IMC', p?.imc)}
      ${champ('pe-gv', 'Graisse viscérale', p?.graisse_viscerale)}
    </div>
    <div class="feuille-actions">
      ${p ? `<button class="btn btn-danger" onclick="supprimerPesee('${p.id}')">Supprimer</button>` : `<button class="btn btn-secondaire" onclick="fermerFeuille()">Annuler</button>`}
      <button class="btn btn-primaire" onclick="enregistrerPesee()">Enregistrer</button>
    </div>`)
}

async function enregistrerPesee() {
  const date = document.getElementById('pe-date').value || dateISO()
  const v = id => nombreChamp(id)
  const ligne = {
    user_id: utilisateur.id, date, poids: v('pe-poids'),
    masse_grasse_pct: v('pe-mg'), masse_hydrique_pct: v('pe-mh'), masse_musculaire_pct: v('pe-mm'),
    masse_osseuse_kg: v('pe-mo'), tmb: v('pe-tmb') != null ? Math.round(v('pe-tmb')) : null, imc: v('pe-imc'), graisse_viscerale: v('pe-gv'),
  }
  if (!ligne.poids || isNaN(ligne.poids) || ligne.poids < 30 || ligne.poids > 300) { afficherToast('Indique ton poids en kilos (par exemple 64,2).', true); return }
  if (Object.values(ligne).some(x => Number.isNaN(x))) { afficherToast('Une des valeurs n\'est pas un nombre.', true); return }
  const { error } = await db.from('pesees').upsert(ligne, { onConflict: 'user_id,date' })
  if (error) { gererErreur(error, "Impossible d'enregistrer la pesée (vérifie que les valeurs sont plausibles)."); return }
  fermerFeuille()
  await apresPesee()
  if (pageActive === 'suivi') chargerSuivi(); else chargerPage(pageActive)
}

async function supprimerPesee(id) {
  if (!confirm('Supprimer cette pesée ?')) return
  const { error } = await db.from('pesees').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  fermerFeuille()
  await chargerDernierePesee()
  chargerSuivi()
}

// Règles de santé après une pesée : recalcul tous les 2 kg, alerte de rythme, objectif atteint
async function apresPesee() {
  const { data: pesees } = await db.from('pesees').select('date, poids').order('date', { ascending: false }).limit(6)
  await chargerDernierePesee()
  const poids = dernierPoids
  const messages = ['Pesée enregistrée']

  // Objectif atteint : début de la stabilisation (remontée progressive des calories)
  if (profil.phase === 'perte' && profil.poids_objectif && poids <= Number(profil.poids_objectif)) {
    await sauvegarderProfil({ phase: 'stabilisation', date_debut_stabilisation: dateISO() })
    ouvrirFeuille('Objectif atteint 🎉', `
      <p class="carte-texte">Bravo, tu as atteint ${formatNombre(profil.poids_objectif, 1)} kg ! C'est le fruit de semaines de régularité.</p>
      <p class="carte-texte" style="margin-top:var(--sp-3);">Place maintenant à la <strong>stabilisation</strong> : pendant ${profil.semaines_stabilisation} semaines, tes calories vont remonter doucement jusqu'à ton niveau d'équilibre. C'est ce qui permet d'éviter l'effet rebond.</p>
      <button class="btn btn-primaire btn-bloc" style="margin-top:var(--sp-4);" onclick="fermerFeuille()">Super</button>`)
    return
  }
  // Recalcul de la cible à chaque 2 kg perdus
  if (profil.phase === 'perte' && besoinRecalcul(Number(profil.poids_reference), poids)) {
    const ancienne = profil.cible_kcal
    const perdus = Number(profil.poids_reference) - poids
    if (await sauvegarderProfil(champsCible(profil, poids))) {
      messages.push(`Nouvelle étape franchie : −${formatNombre(perdus, 1)} kg. Tes repères sont mis à jour (${formatNombre(ancienne)} → ${formatNombre(profil.cible_kcal)} kcal)`)
    }
  }
  afficherToast(messages.join(' · '))
  // Alerte douce : perte trop rapide deux semaines de suite
  if (alerteRythmeTropRapide(pesees || [])) {
    ouvrirFeuille('Un petit mot sur le rythme', `
      <p class="carte-texte">Tu perds plus d'1 kg par semaine depuis deux semaines. C'est un rythme rapide : au-delà, on risque de perdre du muscle et d'avoir un effet rebond.</p>
      <p class="carte-texte" style="margin-top:var(--sp-3);">N'hésite pas à manger un peu plus, surtout des protéines et des féculents complets, et à bien dormir. Si tu as un doute, parles-en à un professionnel de santé.</p>
      <button class="btn btn-primaire btn-bloc" style="margin-top:var(--sp-4);" onclick="fermerFeuille()">Compris</button>`)
  }
}

// Fin de la stabilisation : passage en maintien
async function verifierPhase() {
  if (profil?.phase !== 'stabilisation' || !profil.date_debut_stabilisation) return
  const o = objectifsActuels()
  if (!o) return
  const s = cibleStabilisation({ cibleDepart: profil.cible_kcal, maintien: o.maintien, dateDebut: profil.date_debut_stabilisation, semaines: profil.semaines_stabilisation })
  if (s.terminee) await sauvegarderProfil({ phase: 'maintien' })
}

// ═════════════════════════════════════════════════════════════
// MODULE SUCRE
// ═════════════════════════════════════════════════════════════
async function afficherSucre() {
  const el = document.getElementById('suivi-onglet')
  const auj = dateISO()
  const il8sem = decalerDate(lundiDe(), -49)
  const il35j = decalerDate(auj, -35)
  const debutSuivi = profil.date_depart || il8sem
  const [rS, rE, rA, rJ, rB, rSerie] = await Promise.all([
    db.from('sucreries').select('*').gte('date', il8sem).order('created_at'),
    db.from('envies').select('*').gte('moment', new Date(decalerDate(auj, -30) + 'T00:00:00').toISOString()).order('moment', { ascending: false }),
    db.from('alternatives').select('*').order('created_at'),
    db.from('journal').select('date, sucres_ajoutes').gte('date', il35j),
    db.from('bilans').select('date, sommeil_min').gte('date', decalerDate(auj, -60)),
    db.from('sucreries').select('date').gte('date', debutSuivi),
  ])
  if (rS.error) { gererErreur(rS.error, 'Impossible de charger le suivi du sucre.'); return }
  const sucreries = rS.data || [], envies = rE.data || [], alternatives = rA.data || []

  const serie = serieSansCraquage((rSerie.data || []).map(s => s.date), auj, debutSuivi)
  const sa = moyennesSucresAjoutes(rJ.data || [], auj)
  const analyse = analyserEnvies(envies)
  const lien = lienSommeilEnvies(rB.data || [], envies)

  // Cookies et chocolat par semaine (8 semaines)
  const semaines = []
  for (let i = 7; i >= 0; i--) {
    const lundi = decalerDate(lundiDe(), -7 * i)
    const dim = decalerDate(lundi, 6)
    const sem = sucreries.filter(s => s.date >= lundi && s.date <= dim)
    semaines.push({ lundi, cookie: sem.filter(s => s.type === 'cookie').reduce((a, s) => a + Number(s.quantite), 0), chocolat: sem.filter(s => s.type === 'chocolat').reduce((a, s) => a + Number(s.quantite), 0) })
  }
  const cetteSemaine = semaines.at(-1), semPrec = semaines.at(-2)
  const aujourdHui = sucreries.filter(s => s.date === auj)
  const prochainBadge = BADGES_SERIE.find(b => b > serie.actuelle)

  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Jours sans cookie ni chocolat</div>
      <div class="reperes">
        <div class="repere"><span class="repere-valeur">${serie.actuelle}</span><span class="repere-unite">jour${serie.actuelle > 1 ? 's' : ''} en cours</span></div>
        <div class="repere"><span class="repere-valeur">${serie.record}</span><span class="repere-unite">ton record</span></div>
      </div>
      <div class="badges">${BADGES_SERIE.map(b => `<span class="badge-serie ${serie.record >= b ? 'obtenu' : ''}" title="${b} jours">${serie.record >= b ? '🏅' : '○'} ${b} j</span>`).join('')}</div>
      <p class="message-info">${serie.actuelle === 0 ? 'Une nouvelle série commence demain. Chaque jour compte, et tes badges restent acquis.' : prochainBadge ? `Prochain badge à ${prochainBadge} jours.` : 'Tous les badges sont à toi 🎉'}</p>
    </div>

    <div class="carte">
      <div class="carte-titre">Aujourd'hui</div>
      <div class="actions-sucre">
        <button class="btn btn-secondaire" onclick="ajouterSucrerie('cookie')">🍪 + 1 cookie</button>
        <button class="btn btn-secondaire" onclick="ajouterSucrerie('chocolat')">🍫 + 1 carré</button>
      </div>
      ${aujourdHui.length ? `<p class="message-info">Noté aujourd'hui : ${aujourdHui.map(s => `${s.type === 'cookie' ? '🍪' : '🍫'}`).join(' ')} <button class="btn btn-lien" onclick="annulerDerniereSucrerie('${aujourdHui.at(-1).id}')">annuler le dernier</button></p>` : ''}
      <button class="btn btn-primaire btn-bloc" style="margin-top:var(--sp-3);" onclick="ouvrirEnvie()">J'ai une envie de sucre</button>
    </div>

    <div class="carte">
      <div class="carte-titre">Cette semaine</div>
      <div class="ligne"><span>🍪 Cookies</span><span class="ligne-valeur">${formatNombre(cetteSemaine.cookie)} ${comparaison(cetteSemaine.cookie, semPrec.cookie)}</span></div>
      <div class="ligne"><span>🍫 Carrés de chocolat</span><span class="ligne-valeur">${formatNombre(cetteSemaine.chocolat)} ${comparaison(cetteSemaine.chocolat, semPrec.chocolat)}</span></div>
      ${renduBarresSemaines(semaines)}
      <div class="ligne"><span>Sucres ajoutés (moyenne par jour)</span><span class="ligne-valeur">${sa.semaine != null ? sa.semaine + ' g' : '–'}</span></div>
      ${sa.semaine != null && sa.avant != null ? `<p class="message-info">${sa.semaine < sa.avant ? `En baisse par rapport aux 4 semaines précédentes (${sa.avant} g/jour). Bien joué !` : sa.semaine === sa.avant ? `Stable par rapport aux 4 semaines précédentes (${sa.avant} g/jour).` : `Un peu plus que les 4 semaines précédentes (${sa.avant} g/jour). Pas de quota : on regarde juste la tendance.`}</p>` : '<p class="message-info">Calculé depuis ton journal alimentaire. La comparaison apparaîtra après quelques semaines.</p>'}
    </div>

    <div class="carte">
      <div class="carte-titre">Tes envies (30 derniers jours)</div>
      ${analyse.total ? `
        <div class="ligne"><span>Envies notées</span><span class="ligne-valeur">${analyse.total}</span></div>
        <div class="ligne"><span>Passées sans craquer</span><span class="ligne-valeur">${analyse.total - analyse.satisfaites}</span></div>
        ${analyse.moments.length ? `<div class="ligne"><span>Moment le plus fréquent</span><span class="ligne-valeur">${TRANCHES_HORAIRES.find(t => t[0] === analyse.moments[0][0])[1]}</span></div>` : ''}
        ${analyse.declencheurs.length ? `<div class="ligne"><span>Déclencheurs fréquents</span><span class="ligne-valeur">${analyse.declencheurs.slice(0, 3).map(([k, n]) => `${(DECLENCHEURS.find(d => d[0] === k) || [, k])[1].toLowerCase()} (${n})`).join(', ')}</span></div>` : ''}
      ` : '<p class="carte-texte">Note tes envies quand elles arrivent : le site te montrera les moments et les déclencheurs les plus fréquents.</p>'}
      ${lien ? `<p class="info-cycle">😴 Les jours après une nuit de moins de 7 h, tu notes en moyenne ${formatNombre(lien.moyCourt, 1)} envie(s), contre ${formatNombre(lien.moyLong, 1)} après une nuit plus longue. Bien dormir t'aide vraiment.</p>` : ''}
    </div>

    <div class="carte">
      <div class="carte-titre">Mes alternatives</div>
      <p class="message-info" style="margin-top:0;">Ce qui marche vraiment pour toi : elles te seront proposées quand tu noteras une envie.</p>
      ${alternatives.map(a => `<div class="ligne"><span>${esc(a.texte)}</span><button class="btn btn-lien" onclick="supprimerAlternative('${a.id}')" aria-label="Retirer">✕</button></div>`).join('')}
      <form class="recherche-barre" style="margin-top:var(--sp-3);" onsubmit="event.preventDefault(); ajouterAlternative(document.getElementById('alt-nouvelle').value)">
        <input id="alt-nouvelle" class="input" type="text" maxlength="120" placeholder="Ex. un carré de chocolat noir" />
        <button class="btn btn-secondaire" type="submit">Ajouter</button>
      </form>
      ${alternatives.length < 6 ? `<div class="puces" style="margin-top:var(--sp-3);">${IDEES_ALTERNATIVES.filter(i => !alternatives.some(a => a.texte === i)).slice(0, 6).map(i => `<button class="puce" onclick="ajouterAlternative(${esc(JSON.stringify(i))})">+ ${esc(i)}</button>`).join('')}</div>` : ''}
    </div>`
}

function comparaison(n, avant) {
  if (avant == null || n === avant) return ''
  return n < avant ? `<span class="tendance tendance-bien">↘ ${formatNombre(avant)} la semaine dernière</span>` : `<span class="tendance">↗ ${formatNombre(avant)} la semaine dernière</span>`
}

// Petite courbe de tendance : barres empilées cookies + chocolat sur 8 semaines
function renduBarresSemaines(semaines) {
  const max = Math.max(1, ...semaines.map(s => s.cookie + s.chocolat))
  return `<div class="barres-semaines" role="img" aria-label="Cookies et chocolat sur 8 semaines">
    ${semaines.map(s => `<div class="barre-semaine" title="Semaine du ${formatDate(s.lundi)} : ${s.cookie} cookie(s), ${s.chocolat} carré(s)">
      <div class="bs-pile"><div class="bs-choco" style="height:${s.chocolat / max * 100}%"></div><div class="bs-cookie" style="height:${s.cookie / max * 100}%"></div></div>
      <span>${new Date(s.lundi + 'T12:00:00').getDate()}/${new Date(s.lundi + 'T12:00:00').getMonth() + 1}</span></div>`).join('')}
  </div>
  <p class="message-info legende"><span class="pastille bs-cookie"></span> cookies <span class="pastille bs-choco"></span> chocolat · 8 dernières semaines</p>`
}

async function ajouterSucrerie(type) {
  const { error } = await db.from('sucreries').insert({ date: dateISO(), type, quantite: 1 })
  if (error) { gererErreur(error, "Impossible d'enregistrer."); return }
  afficherToast(type === 'cookie' ? 'Cookie noté. Aucun jugement, on regarde juste la tendance.' : 'Carré de chocolat noté.')
  rafraichirSucre()
}

async function annulerDerniereSucrerie(id) {
  const { error } = await db.from('sucreries').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  rafraichirSucre()
}

function rafraichirSucre() {
  if (pageActive === 'suivi') chargerSuivi()
  else chargerPage(pageActive)
}

// ── Journal des envies ───────────────────────────────────────
let _envie = {}

async function ouvrirEnvie() {
  const { data: alternatives } = await db.from('alternatives').select('texte').order('created_at')
  _envie = { intensite: 3, declencheur: null, humeur: null, satisfaite: null, alternative: null }
  const alts = (alternatives || []).map(a => a.texte)
  ouvrirFeuille('Une envie de sucre', `
    ${alts.length ? `<div class="carte-titre">Et si tu essayais…</div>
      <div class="puces">${alts.map((a, i) => `<button type="button" class="puce puce-choix" data-alt="${i}" onclick="choisirAlternative(${i}, this)">${esc(a)}</button>`).join('')}</div>`
      : `<p class="message-info" style="margin-top:0;">Ajoute tes alternatives préférées dans l'onglet Sucre : elles s'afficheront ici.</p>`}
    <div class="champ" style="margin-top:var(--sp-4);"><span class="champ-label">Intensité de l'envie</span>
      <div class="echelle">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="echelle-btn ${n === 3 ? 'active' : ''}" onclick="choisirEchelleEnvie('intensite', ${n})">${n}</button>`).join('')}</div></div>
    <div class="champ"><span class="champ-label">Déclencheur</span>
      <div class="puces">${DECLENCHEURS.map(([k, l]) => `<button type="button" class="puce puce-choix" data-decl="${k}" onclick="choisirDeclencheur('${k}')">${l}</button>`).join('')}</div></div>
    <div class="champ"><span class="champ-label">Ton humeur</span>${boutonsEchelle('humeur', null, 'choisirEchelleEnvie')}</div>
    <div class="champ"><span class="champ-label">L'envie a-t-elle été satisfaite ?</span>
      <div class="segmente segmente-large">
        <button type="button" data-sat="oui" onclick="choisirSatisfaite(true)">Oui</button>
        <button type="button" data-sat="non" onclick="choisirSatisfaite(false)">Non, elle est passée</button>
        <button type="button" data-sat="nsp" class="active" onclick="choisirSatisfaite(null)">Pas encore</button>
      </div></div>
    <label class="champ"><span class="champ-label">Heure</span><input id="env-heure" class="input" type="time" value="${heureActuelle()}" /></label>
    <button class="btn btn-primaire btn-bloc" onclick="enregistrerEnvie()">Noter l'envie</button>
    <p class="message-info">Noter une envie, c'est déjà prendre du recul. Bravo de le faire.</p>`)
  window._altsEnvie = alts
}

function choisirAlternative(i, btn) {
  _envie.alternative = _envie.alternative === window._altsEnvie[i] ? null : window._altsEnvie[i]
  document.querySelectorAll('[data-alt]').forEach(b => b.classList.toggle('active', b === btn && !!_envie.alternative))
}
function choisirDeclencheur(k) {
  _envie.declencheur = _envie.declencheur === k ? null : k
  document.querySelectorAll('[data-decl]').forEach(b => b.classList.toggle('active', b.dataset.decl === _envie.declencheur))
}
function choisirEchelleEnvie(champ, v) {
  _envie[champ] = v
  const boutons = champ === 'intensite'
    ? document.querySelectorAll('.feuille .echelle')[0].children
    : document.querySelectorAll('.feuille .echelle')[1].children
  ;[...boutons].forEach((b, i) => b.classList.toggle('active', i + 1 === v))
}
function choisirSatisfaite(v) {
  _envie.satisfaite = v
  document.querySelectorAll('[data-sat]').forEach(b => b.classList.toggle('active', b.dataset.sat === (v === true ? 'oui' : v === false ? 'non' : 'nsp')))
}

async function enregistrerEnvie() {
  const [h, m] = (document.getElementById('env-heure').value || heureActuelle()).split(':').map(Number)
  const moment = new Date(); moment.setHours(h, m, 0, 0)
  const { error } = await db.from('envies').insert({ moment: moment.toISOString(), intensite: _envie.intensite, declencheur: _envie.declencheur,
    humeur: _envie.humeur, satisfaite: _envie.satisfaite, alternative: _envie.alternative })
  if (error) { gererErreur(error, "Impossible d'enregistrer l'envie."); return }
  fermerFeuille()
  afficherToast(_envie.satisfaite === false ? 'Envie passée sans craquer : bravo 👏' : 'Envie notée')
  rafraichirSucre()
}

async function ajouterAlternative(texte) {
  texte = String(texte || '').trim()
  if (!texte) return
  const { error } = await db.from('alternatives').insert({ texte: texte.slice(0, 120) })
  if (error) { gererErreur(error); return }
  chargerSuivi()
}

async function supprimerAlternative(id) {
  const { error } = await db.from('alternatives').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  chargerSuivi()
}

// ═════════════════════════════════════════════════════════════
// CYCLE MENSTRUEL
// ═════════════════════════════════════════════════════════════
async function afficherCycle() {
  const el = document.getElementById('suivi-onglet')
  await chargerCycles()
  const phase = phaseCycle(_cycles, dateISO())
  const derniere = _cycles.at(-1)
  el.innerHTML = `
    ${phase && phase.phase !== 'inconnue' ? `
    <div class="carte carte-aujourdhui">
      <div class="carte-titre">${LIBELLES_PHASES[phase.phase][0]} · jour ${phase.jour}</div>
      <p class="carte-texte">${LIBELLES_PHASES[phase.phase][1]}</p>
      <p class="message-info">Cycle moyen estimé : ${phase.longueur} jours. Prochaines règles vers le ${phase.prochaines.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.</p>
    </div>` : `<div class="carte"><p class="carte-texte">${_cycles.length ? 'Pas de début de règles noté récemment : ajoute le dernier pour estimer ta phase.' : 'Note le début de tes règles (comme dans Flo) : le site estimera ta phase et l\'affichera sur les graphiques de poids et d\'envies, pour expliquer les variations liées à l\'eau.'}</p></div>`}

    <div class="carte">
      <div class="carte-titre">Début des règles</div>
      <div class="grille-2">
        <label class="champ"><span class="champ-label">Premier jour</span><input id="cy-date" class="input" type="date" max="${dateISO()}" value="${dateISO()}" /></label>
        <label class="champ"><span class="champ-label">Durée (jours)</span><input id="cy-duree" class="input" inputmode="numeric" value="${derniere?.duree_regles || 5}" /></label>
      </div>
      <button class="btn btn-primaire btn-bloc" onclick="enregistrerCycle()">Enregistrer</button>
    </div>

    ${_cycles.length ? `<div class="carte"><div class="carte-titre">Historique</div>
      ${[..._cycles].reverse().map((c, i, arr) => {
        const suivant = arr[i - 1]
        const duree = suivant ? Math.round((new Date(suivant.date_debut) - new Date(c.date_debut)) / 86400000) : null
        return `<div class="ligne"><span>${formatDate(c.date_debut)}</span><span class="ligne-valeur">${c.duree_regles} j de règles${duree ? ` · cycle de ${duree} j` : ''}</span>
          <button class="btn btn-lien" onclick="supprimerCycle('${c.id}')" aria-label="Supprimer">✕</button></div>`
      }).join('')}</div>` : ''}
    <p class="message-info" style="text-align:center;">🔒 Ces données sont privées : elles ne sont visibles que par toi.</p>`
}

async function enregistrerCycle() {
  const date = document.getElementById('cy-date').value
  const duree = Number(document.getElementById('cy-duree').value)
  if (!date) { afficherToast('Indique le premier jour des règles.', true); return }
  if (!duree || duree < 1 || duree > 15) { afficherToast('La durée des règles va de 1 à 15 jours.', true); return }
  const { error } = await db.from('cycles').upsert({ user_id: utilisateur.id, date_debut: date, duree_regles: Math.round(duree) }, { onConflict: 'user_id,date_debut' })
  if (error) { gererErreur(error, "Impossible d'enregistrer."); return }
  afficherToast('Enregistré')
  afficherCycle()
}

async function supprimerCycle(id) {
  if (!confirm('Supprimer ce début de règles ?')) return
  const { error } = await db.from('cycles').delete().eq('id', id)
  if (error) { gererErreur(error); return }
  afficherCycle()
}

// ── Raccourcis sur la page Aujourd'hui ───────────────────────
async function chargerRaccourcisSuivi() {
  const el = document.getElementById('aujourdhui-suivi')
  if (!el) return
  const auj = dateISO()
  const [{ data: bilan }, { data: pesees }] = await Promise.all([
    db.from('bilans').select('id').eq('date', auj).maybeSingle(),
    db.from('pesees').select('date').order('date', { ascending: false }).limit(1),
  ])
  const derniere = pesees?.[0]?.date
  const peseeDue = !derniere || (new Date(auj) - new Date(derniere)) / 86400000 >= 7
  const soir = new Date().getHours() >= 18
  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Noter rapidement</div>
      <div class="actions-sucre">
        <button class="btn btn-secondaire" onclick="ajouterSucrerie('cookie')">🍪 Cookie</button>
        <button class="btn btn-secondaire" onclick="ajouterSucrerie('chocolat')">🍫 Chocolat</button>
        <button class="btn btn-secondaire" onclick="ouvrirEnvie()">✋ Envie</button>
      </div>
      ${peseeDue ? `<button class="btn btn-lien" style="padding-left:0;" onclick="ongletSuivi='pesee'; showPage('suivi')">⚖️ C'est le moment de ta pesée de la semaine</button>` : ''}
      ${!bilan ? `<button class="btn ${soir ? 'btn-primaire' : 'btn-secondaire'} btn-bloc" style="margin-top:var(--sp-3);" onclick="dateBilan = dateISO(); ongletSuivi = 'bilan'; showPage('suivi')">🌙 Faire le bilan du soir</button>`
        : `<p class="message-info">Bilan du soir fait ✓</p>`}
    </div>`
}
