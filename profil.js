// ─────────────────────────────────────────────────────────────
// Profil : questionnaire de premier lancement, réglages, objectifs
// Dépend de : app.js (db, profil, utilisateur, outils), calculs.js
// ─────────────────────────────────────────────────────────────

// ── LISTE DES EXCLUSIONS ALIMENTAIRES ────────────────────────
// Tout est autorisé par défaut : on coche seulement ce qu'on n'aime pas.
// Clé enregistrée : 'groupe' (tout le groupe) ou 'groupe:aliment'.
const GROUPES_ALIMENTS = [
  { cle: 'viandes', libelle: 'Viandes', items: [
    ['boeuf', 'Bœuf'], ['porc', 'Porc'], ['veau', 'Veau'], ['agneau', 'Agneau'],
    ['volaille', 'Poulet, dinde'], ['canard', 'Canard'], ['charcuterie', 'Charcuterie, jambon'], ['abats', 'Abats'] ] },
  { cle: 'poissons', libelle: 'Poissons et fruits de mer', items: [
    ['poissons_blancs', 'Poissons blancs (cabillaud, colin…)'], ['saumon', 'Saumon'], ['thon', 'Thon'],
    ['sardines_maquereau', 'Sardines, maquereau'], ['crevettes', 'Crevettes'], ['moules', 'Moules'],
    ['crustaces', 'Crabe, homard'], ['surimi', 'Surimi'] ] },
  { cle: 'oeufs', libelle: 'Œufs', items: [['oeufs', 'Œufs']] },
  { cle: 'laitiers', libelle: 'Produits laitiers', items: [
    ['lait', 'Lait'], ['yaourt', 'Yaourt'], ['fromage_blanc', 'Fromage blanc, skyr'], ['fromages', 'Fromages affinés'],
    ['chevre', 'Fromage de chèvre'], ['bleu', 'Fromages bleus'], ['creme', 'Crème fraîche'], ['beurre', 'Beurre'] ] },
  { cle: 'legumes', libelle: 'Légumes', items: [
    ['brocoli', 'Brocoli'], ['chou_fleur', 'Chou-fleur'], ['choux', 'Chou, chou de Bruxelles'], ['epinards', 'Épinards'],
    ['courgette', 'Courgette'], ['aubergine', 'Aubergine'], ['poivron', 'Poivron'], ['tomate', 'Tomate'],
    ['champignons', 'Champignons'], ['carotte', 'Carotte'], ['haricots_verts', 'Haricots verts'], ['petits_pois', 'Petits pois'],
    ['poireau', 'Poireau'], ['oignon', 'Oignon'], ['ail', 'Ail'], ['betterave', 'Betterave'], ['celeri', 'Céleri'],
    ['endive', 'Endive'], ['concombre', 'Concombre'], ['radis', 'Radis'], ['courge', 'Courge, potiron'],
    ['fenouil', 'Fenouil'], ['salade', 'Salade verte'], ['avocat', 'Avocat'] ] },
  { cle: 'fruits', libelle: 'Fruits', items: [
    ['pomme', 'Pomme'], ['poire', 'Poire'], ['banane', 'Banane'], ['orange', 'Orange, clémentine'], ['kiwi', 'Kiwi'],
    ['fruits_rouges', 'Fruits rouges'], ['raisin', 'Raisin'], ['ananas', 'Ananas'], ['mangue', 'Mangue'],
    ['peche', 'Pêche, nectarine, abricot'], ['melon', 'Melon, pastèque'], ['fruits_secs', 'Fruits secs'] ] },
  { cle: 'feculents', libelle: 'Féculents', items: [
    ['riz', 'Riz'], ['pates', 'Pâtes'], ['pommes_de_terre', 'Pommes de terre'], ['patate_douce', 'Patate douce'],
    ['semoule', 'Semoule'], ['boulgour', 'Boulgour'], ['quinoa', 'Quinoa'], ['pain', 'Pain'], ['flocons_avoine', "Flocons d'avoine"] ] },
  { cle: 'legumineuses', libelle: 'Légumineuses', items: [
    ['lentilles', 'Lentilles'], ['pois_chiches', 'Pois chiches'], ['haricots_rouges', 'Haricots rouges'],
    ['haricots_blancs', 'Haricots blancs'], ['pois_casses', 'Pois cassés'], ['tofu', 'Tofu, soja'] ] },
  { cle: 'epices', libelle: 'Épices et herbes', items: [
    ['piment', 'Piment'], ['curry', 'Curry'], ['cumin', 'Cumin'], ['gingembre', 'Gingembre'], ['coriandre', 'Coriandre'],
    ['persil', 'Persil'], ['basilic', 'Basilic'], ['menthe', 'Menthe'], ['aneth', 'Aneth'], ['paprika', 'Paprika'] ] },
  { cle: 'autres', libelle: 'Autres', items: [
    ['fruits_a_coque', 'Noix, amandes, noisettes'], ['olives', 'Olives'], ['moutarde', 'Moutarde'],
    ['vinaigre', 'Vinaigre'], ['lait_coco', 'Lait de coco'] ] },
]

const JOURS_SEMAINE = [[1, 'L', 'Lundi'], [2, 'M', 'Mardi'], [3, 'M', 'Mercredi'], [4, 'J', 'Jeudi'], [5, 'V', 'Vendredi'], [6, 'S', 'Samedi'], [7, 'D', 'Dimanche']]

// Poids actuel : dernière pesée (phase 6), sinon poids de départ
let dernierPoids = null
function poidsActuel() { return dernierPoids ?? (profil?.poids_depart != null ? Number(profil.poids_depart) : null) }

function objectifsActuels() {
  if (!profil) return null
  return calculerObjectifs(profil, poidsActuel())
}

// Cible du jour selon la phase (perte, stabilisation, maintien)
function cibleKcalDuJour() {
  if (!profil?.cible_kcal) return null
  if (profil.phase === 'stabilisation' && profil.date_debut_stabilisation) {
    const o = objectifsActuels()
    return cibleStabilisation({
      cibleDepart: profil.cible_kcal, maintien: o.maintien,
      dateDebut: profil.date_debut_stabilisation, semaines: profil.semaines_stabilisation,
    }).cible
  }
  if (profil.phase === 'maintien') return objectifsActuels()?.maintien ?? profil.cible_kcal
  return profil.cible_kcal
}

// ── SAUVEGARDE ───────────────────────────────────────────────
async function sauvegarderProfil(champs) {
  const { data, error } = await db.from('profils').update(champs).eq('user_id', utilisateur.id).select().single()
  if (error) { gererErreur(error, "Impossible d'enregistrer. Réessaie dans un instant."); return false }
  profil = data
  return true
}

// Champs de cible recalculés à partir du profil et du poids actuel
function champsCible(p, poids) {
  const o = calculerObjectifs(p, poids)
  if (!o) return {}
  return {
    poids_reference: poids,
    date_calcul_cible: dateISO(),
    cible_kcal: o.cible,
    cible_proteines: o.proteines.cible,
  }
}

// ═════════════════════════════════════════════════════════════
// QUESTIONNAIRE (premier lancement + modification depuis les réglages)
// ═════════════════════════════════════════════════════════════
const ETAPES_QUESTIONNAIRE = ['toi', 'objectif', 'gouts', 'cuisine', 'sport', 'recap']
let questionnaire = { mode: 'onboarding', etape: 0, brouillon: null, recherche: '', groupesOuverts: new Set() }

function ouvrirQuestionnaire(mode = 'onboarding', etape = 'toi') {
  questionnaire = {
    mode,
    etape: Math.max(0, ETAPES_QUESTIONNAIRE.indexOf(etape)),
    brouillon: structuredClone(profil || {}),
    recherche: '',
    groupesOuverts: new Set(),
  }
  const b = questionnaire.brouillon
  b.sexe ??= 'femme'
  b.activite ??= 'faible'
  b.exclusions ??= []
  b.exclusions_aliments ??= []
  b.materiel ??= { elastique: true, tapis: false }
  b.jours_sport ??= [1, 3, 5]
  b.seances_par_semaine ??= 3
  b.duree_seance ??= 25
  b.temps_cuisine_max ??= 40
  b.nb_personnes_defaut ??= 2

  document.getElementById('questionnaire').classList.remove('hidden')
  document.body.classList.add('sans-defilement')
  afficherEtapeQuestionnaire()
}

function fermerQuestionnaire() {
  document.getElementById('questionnaire').classList.add('hidden')
  document.body.classList.remove('sans-defilement')
}

function afficherEtapeQuestionnaire() {
  const { mode, etape } = questionnaire
  const nom = ETAPES_QUESTIONNAIRE[etape]
  const enOnboarding = mode === 'onboarding'

  // Barre de progression (premier lancement seulement)
  const prog = document.getElementById('q-progression')
  prog.classList.toggle('hidden', !enOnboarding)
  prog.querySelector('div').style.width = `${((etape + 1) / ETAPES_QUESTIONNAIRE.length) * 100}%`

  document.getElementById('q-contenu').innerHTML = RENDU_ETAPES[nom]()
  afficherMessage('q-erreur', '')

  const btnRetour = document.getElementById('q-retour')
  const btnSuivant = document.getElementById('q-suivant')
  if (enOnboarding) {
    btnRetour.textContent = 'Retour'
    btnRetour.classList.toggle('invisible', etape === 0)
    btnSuivant.textContent = nom === 'recap' ? "C'est parti" : 'Continuer'
  } else {
    btnRetour.textContent = 'Annuler'
    btnRetour.classList.remove('invisible')
    btnSuivant.textContent = 'Enregistrer'
  }
  document.getElementById('q-contenu').scrollTop = 0
  if (nom === 'objectif') majApercuObjectif()
}

function retourQuestionnaire() {
  if (questionnaire.mode !== 'onboarding') { fermerQuestionnaire(); return }
  if (questionnaire.etape > 0) { questionnaire.etape--; afficherEtapeQuestionnaire() }
}

async function suivantQuestionnaire() {
  const nom = ETAPES_QUESTIONNAIRE[questionnaire.etape]
  const erreur = lireEtValiderEtape(nom)
  if (erreur) { afficherMessage('q-erreur', erreur); return }

  const btn = document.getElementById('q-suivant')
  btn.disabled = true
  const ok = await enregistrerEtape(nom)
  btn.disabled = false
  if (!ok) return

  if (questionnaire.mode === 'onboarding' && nom !== 'recap') {
    questionnaire.etape++
    afficherEtapeQuestionnaire()
    return
  }
  // Le nouveau poids est passé sous l'objectif : on redemande l'objectif
  if (nom === 'toi' && !profil.poids_objectif) {
    questionnaire.etape = ETAPES_QUESTIONNAIRE.indexOf('objectif')
    afficherEtapeQuestionnaire()
    afficherMessage('q-erreur', 'Ton poids a changé : indique un nouveau poids visé.')
    return
  }
  fermerQuestionnaire()
  if (questionnaire.mode === 'onboarding') afficherToast('Ton espace est prêt 🌿')
  else afficherToast('Enregistré')
  chargerPage(pageActive || 'aujourdhui')
}

// Enregistre les champs de l'étape. En premier lancement, on enregistre à chaque étape
// pour ne rien perdre si l'app est fermée en cours de route.
async function enregistrerEtape(nom) {
  const b = questionnaire.brouillon
  let champs = {}
  if (nom === 'toi') champs = { prenom: b.prenom, sexe: b.sexe, date_naissance: b.date_naissance, taille_cm: b.taille_cm, poids_depart: b.poids_depart, activite: b.activite, date_depart: b.date_depart || dateISO() }
  if (nom === 'objectif') champs = { poids_objectif: b.poids_objectif }
  if (nom === 'gouts') champs = { exclusions: b.exclusions, exclusions_aliments: b.exclusions_aliments }
  if (nom === 'cuisine') champs = { temps_cuisine_max: b.temps_cuisine_max, nb_personnes_defaut: b.nb_personnes_defaut }
  if (nom === 'sport') champs = { materiel: b.materiel, jours_sport: b.jours_sport, seances_par_semaine: b.seances_par_semaine, duree_seance: b.duree_seance }
  if (nom === 'recap') champs = { onboarding_fait: true }

  // Le profil ou l'objectif change : on recalcule la cible avec le poids actuel
  if (nom === 'toi' || nom === 'objectif' || nom === 'recap') {
    const poids = dernierPoids ?? Number(b.poids_depart)
    Object.assign(champs, champsCible({ ...b, ...champs }, poids))
  }
  // L'objectif ne peut pas dépasser le nouveau poids de départ : on l'efface pour le redemander
  if (nom === 'toi' && b.poids_objectif && Number(b.poids_objectif) >= Number(b.poids_depart)) {
    champs.poids_objectif = null
    b.poids_objectif = null
  }
  return sauvegarderProfil(champs)
}

// ── LECTURE ET VALIDATION DES CHAMPS ─────────────────────────
function lireNombre(id) {
  const v = document.getElementById(id)?.value?.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return isNaN(n) ? NaN : n
}

function lireEtValiderEtape(nom) {
  const b = questionnaire.brouillon
  if (nom === 'toi') {
    b.prenom = document.getElementById('q-prenom').value.trim() || null
    b.date_naissance = document.getElementById('q-naissance').value || null
    b.taille_cm = lireNombre('q-taille')
    b.poids_depart = lireNombre('q-poids')
    const age = calculerAge(b.date_naissance)
    if (!b.date_naissance || age === null) return 'Indique ta date de naissance.'
    if (age < 16 || age > 90) return "Le site est prévu pour les adultes : vérifie la date de naissance."
    if (!b.taille_cm || isNaN(b.taille_cm) || b.taille_cm < 120 || b.taille_cm > 230) return 'Indique ta taille en centimètres (par exemple 166).'
    if (!b.poids_depart || isNaN(b.poids_depart) || b.poids_depart < 30 || b.poids_depart > 300) return 'Indique ton poids en kilos (par exemple 65).'
  }
  if (nom === 'objectif') {
    b.poids_objectif = lireNombre('q-objectif')
    const min = poidsMinSain(b.taille_cm)
    if (!b.poids_objectif || isNaN(b.poids_objectif)) return 'Indique le poids que tu vises.'
    if (b.poids_objectif >= b.poids_depart) return 'Le poids visé doit être inférieur à ton poids actuel.'
    if (b.poids_objectif < min) return `Pour rester en bonne santé, le site ne propose pas d'objectif sous ${formatNombre(min, 1)} kg pour ta taille.`
  }
  if (nom === 'sport') {
    if (!b.jours_sport.length) return 'Choisis au moins un jour possible.'
    if (b.jours_sport.length < 3) return 'Choisis au moins 3 jours possibles, pour pouvoir caser 3 séances.'
    if (b.seances_par_semaine > b.jours_sport.length) b.seances_par_semaine = b.jours_sport.length
  }
  return null
}

// ── RENDU DES ÉTAPES ─────────────────────────────────────────
const RENDU_ETAPES = {
  toi() {
    const b = questionnaire.brouillon
    return `
      <h2 class="q-titre">Faisons connaissance</h2>
      <p class="q-intro">Ces informations servent à calculer tes besoins. Tu pourras tout modifier plus tard dans les réglages.</p>
      <label class="champ"><span class="champ-label">Prénom (facultatif)</span>
        <input id="q-prenom" class="input" type="text" autocomplete="given-name" value="${esc(b.prenom || '')}" /></label>
      <div class="champ"><span class="champ-label">Pour la formule de calcul</span>
        <div class="segmente segmente-large" id="q-sexe">
          ${[['femme', 'Femme'], ['homme', 'Homme']].map(([v, l]) => `<button type="button" class="${b.sexe === v ? 'active' : ''}" onclick="choisirSexe('${v}')">${l}</button>`).join('')}
        </div></div>
      <label class="champ"><span class="champ-label">Date de naissance</span>
        <input id="q-naissance" class="input" type="date" max="${dateISO()}" value="${esc(b.date_naissance || '')}" /></label>
      <div class="grille-2">
        <label class="champ"><span class="champ-label">Taille (cm)</span>
          <input id="q-taille" class="input" type="text" inputmode="decimal" placeholder="166" value="${esc(b.taille_cm ?? '')}" /></label>
        <label class="champ"><span class="champ-label">Poids actuel (kg)</span>
          <input id="q-poids" class="input" type="text" inputmode="decimal" placeholder="65" value="${esc(b.poids_depart ?? '')}" /></label>
      </div>
      <div class="champ"><span class="champ-label">Ton activité au quotidien, hors séances de sport</span>
        <div class="choix-liste">
          ${Object.entries(NIVEAUX_ACTIVITE).map(([cle, n]) => `
            <button type="button" class="choix ${b.activite === cle ? 'active' : ''}" onclick="choisirActivite('${cle}')">
              <span class="choix-titre">${n.libelle}</span><span class="choix-detail">${n.detail}</span>
            </button>`).join('')}
        </div></div>`
  },

  objectif() {
    const b = questionnaire.brouillon
    const min = poidsMinSain(b.taille_cm)
    return `
      <h2 class="q-titre">Ton objectif</h2>
      <p class="q-intro">Le site vise une perte d'environ <strong>0,4 à 0,5 kg par semaine</strong> : le rythme le plus rapide qui reste sain et limite l'effet rebond.</p>
      <label class="champ"><span class="champ-label">Poids visé (kg)</span>
        <input id="q-objectif" class="input" type="text" inputmode="decimal" placeholder="55" value="${esc(b.poids_objectif ?? '')}" oninput="majApercuObjectif()" /></label>
      <p class="message-info" style="margin-top:calc(-1 * var(--sp-2));">Pour ta taille, un poids sain commence à ${formatNombre(min, 1)} kg.</p>
      <div id="q-apercu" class="apercu"></div>`
  },

  gouts() {
    return `
      <h2 class="q-titre">Ce que tu n'aimes pas</h2>
      <p class="q-intro">Tout est autorisé par défaut. Coche seulement ce que tu ne veux pas voir dans tes menus.</p>
      <div class="champ">
        <input id="q-recherche" class="input" type="search" placeholder="Rechercher un aliment…" value="${esc(questionnaire.recherche)}"
          oninput="rechercherExclusion(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();ajouterExclusionPrecise()}" />
      </div>
      <div id="q-exclusions">${renduExclusions()}</div>`
  },

  cuisine() {
    const b = questionnaire.brouillon
    return `
      <h2 class="q-titre">En cuisine</h2>
      <p class="q-intro">Pas d'horaires imposés : tu notes tes repas quand tu les prends, petit déjeuner compris seulement si tu en prends un.</p>
      <div class="champ"><span class="champ-label">Temps de préparation maximum par repas : <strong id="q-temps-val">${b.temps_cuisine_max} min</strong></span>
        <input id="q-temps" class="curseur" type="range" min="10" max="90" step="5" value="${b.temps_cuisine_max}"
          oninput="questionnaire.brouillon.temps_cuisine_max = Number(this.value); document.getElementById('q-temps-val').textContent = this.value + ' min'" /></div>
      <div class="champ"><span class="champ-label">Nombre de personnes aux repas, par défaut</span>
        ${renduCompteur('nb_personnes_defaut', 1, 8, b.nb_personnes_defaut, n => `${n} personne${n > 1 ? 's' : ''}`)}
        <p class="message-info">Sert à calculer la liste de courses. Réglable repas par repas.</p></div>`
  },

  sport() {
    const b = questionnaire.brouillon
    const maxSeances = Math.min(6, Math.max(3, b.jours_sport.length))
    return `
      <h2 class="q-titre">Sport à la maison</h2>
      <p class="q-intro">Des séances courtes, adaptées à ton matériel et sans exercice qui force sur la nuque.</p>
      <div class="champ"><span class="champ-label">Matériel disponible</span>
        <div class="choix-liste">
          ${renduCaseMateriel('elastique', 'Élastique de résistance', '')}
          ${renduCaseMateriel('tapis', 'Tapis de sol', 'Coche-le le jour où tu l\'as : les exercices au sol s\'activeront.')}
        </div></div>
      <div class="champ"><span class="champ-label">Jours possibles</span>
        <div class="jours">
          ${JOURS_SEMAINE.map(([n, court, long]) => `<button type="button" class="jour ${b.jours_sport.includes(n) ? 'active' : ''}" title="${long}" aria-label="${long}" aria-pressed="${b.jours_sport.includes(n)}" onclick="basculerJourSport(${n})">${court}</button>`).join('')}
        </div></div>
      <div class="champ"><span class="champ-label">Séances par semaine</span>
        <div class="segmente segmente-large">
          ${[3, 4, 5, 6].map(n => `<button type="button" class="${b.seances_par_semaine === n ? 'active' : ''}" ${n > maxSeances ? 'disabled' : ''} onclick="choisirChamp('seances_par_semaine', ${n})">${n}</button>`).join('')}
        </div>
        ${b.jours_sport.length < 6 ? `<p class="message-info">Pas plus de séances que de jours possibles.</p>` : ''}</div>
      <div class="champ"><span class="champ-label">Durée d'une séance</span>
        <div class="segmente segmente-large">
          ${[20, 25, 30].map(n => `<button type="button" class="${b.duree_seance === n ? 'active' : ''}" onclick="choisirChamp('duree_seance', ${n})">${n} min</button>`).join('')}
        </div></div>`
  },

  recap() {
    const b = questionnaire.brouillon
    const o = calculerObjectifs(b, Number(b.poids_depart))
    if (!o) return `<p class="message-erreur">Il manque des informations : reviens aux étapes précédentes.</p>`
    return `
      <h2 class="q-titre">${b.prenom ? `Tout est prêt, ${esc(b.prenom)}` : 'Tout est prêt'}</h2>
      <p class="q-intro">Voici tes repères de départ. Ils s'ajusteront tout seuls au fil de ta progression.</p>
      ${renduCarteObjectifs(o, b)}
      <p class="message-info">Ce sont des repères, pas des règles strictes : une journée au-dessus ou en dessous ne change rien, c'est la tendance qui compte.</p>`
  },
}

function renduCompteur(champ, min, max, valeur, libelle) {
  return `
    <div class="compteur">
      <button type="button" class="btn btn-secondaire" ${valeur <= min ? 'disabled' : ''} onclick="changerCompteur('${champ}', -1, ${min}, ${max})" aria-label="Moins">−</button>
      <span class="compteur-valeur">${libelle(valeur)}</span>
      <button type="button" class="btn btn-secondaire" ${valeur >= max ? 'disabled' : ''} onclick="changerCompteur('${champ}', 1, ${min}, ${max})" aria-label="Plus">+</button>
    </div>`
}

function renduCaseMateriel(cle, titre, detail) {
  const actif = !!questionnaire.brouillon.materiel[cle]
  return `
    <button type="button" class="choix choix-case ${actif ? 'active' : ''}" aria-pressed="${actif}" onclick="basculerMateriel('${cle}')">
      <span class="case">${actif ? '✓' : ''}</span>
      <span><span class="choix-titre">${titre}</span>${detail ? `<span class="choix-detail">${detail}</span>` : ''}</span>
    </button>`
}

// Carte « tes repères » (récap du questionnaire, page Aujourd'hui, réglages)
function renduCarteObjectifs(o, p) {
  const date = o.dateEstimee ? o.dateEstimee.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null
  return `
    <div class="reperes">
      <div class="repere"><span class="repere-valeur">${formatNombre(o.cible)}</span><span class="repere-unite">kcal / jour</span></div>
      <div class="repere"><span class="repere-valeur">${o.proteines.cible} g</span><span class="repere-unite">protéines / jour</span></div>
    </div>
    <div class="ligne"><span>Objectif</span><span class="ligne-valeur">${formatNombre(p.poids_objectif, 1)} kg${o.resteKg ? ` (−${formatNombre(o.resteKg, 1)} kg)` : ''}</span></div>
    ${date ? `<div class="ligne"><span>Arrivée estimée</span><span class="ligne-valeur">vers ${date}</span></div>` : ''}
    <div class="ligne"><span>Rythme</span><span class="ligne-valeur">≈ ${formatNombre(o.vitesseKgSemaine, 2)} kg / semaine</span></div>
    ${o.plancherAtteint ? `<p class="message-info">Ta cible est au plancher de 1 200 kcal : le site ne descend jamais plus bas. La perte sera un peu plus lente, et c'est très bien ainsi.</p>` : ''}`
}

function majApercuObjectif() {
  const el = document.getElementById('q-apercu')
  if (!el) return
  afficherMessage('q-erreur', '')
  const b = questionnaire.brouillon
  const obj = lireNombre('q-objectif')
  if (!obj || isNaN(obj) || obj >= b.poids_depart || obj < poidsMinSain(b.taille_cm)) { el.innerHTML = ''; return }
  const o = calculerObjectifs({ ...b, poids_objectif: obj }, Number(b.poids_depart))
  el.innerHTML = o ? renduCarteObjectifs(o, { ...b, poids_objectif: obj }) : ''
}

// ── ACTIONS DES ÉTAPES ───────────────────────────────────────
// On relit les champs texte avant de redessiner, pour ne pas perdre la saisie.
function relireChampsToi() {
  if (!document.getElementById('q-prenom')) return
  const b = questionnaire.brouillon
  b.prenom = document.getElementById('q-prenom').value.trim() || null
  b.date_naissance = document.getElementById('q-naissance').value || null
  b.taille_cm = lireNombre('q-taille')
  b.poids_depart = lireNombre('q-poids')
}
function choisirSexe(v)     { relireChampsToi(); questionnaire.brouillon.sexe = v; afficherEtapeQuestionnaire() }
function choisirActivite(v) { relireChampsToi(); questionnaire.brouillon.activite = v; afficherEtapeQuestionnaire() }
function choisirChamp(champ, v) { questionnaire.brouillon[champ] = v; afficherEtapeQuestionnaire() }

function changerCompteur(champ, delta, min, max) {
  const b = questionnaire.brouillon
  b[champ] = Math.min(max, Math.max(min, (b[champ] || min) + delta))
  afficherEtapeQuestionnaire()
}

function basculerMateriel(cle) {
  const m = questionnaire.brouillon.materiel
  m[cle] = !m[cle]
  afficherEtapeQuestionnaire()
}

function basculerJourSport(n) {
  const b = questionnaire.brouillon
  b.jours_sport = b.jours_sport.includes(n) ? b.jours_sport.filter(j => j !== n) : [...b.jours_sport, n].sort()
  if (b.seances_par_semaine > Math.max(3, b.jours_sport.length)) b.seances_par_semaine = Math.max(3, b.jours_sport.length)
  afficherEtapeQuestionnaire()
}

// ── EXCLUSIONS ───────────────────────────────────────────────
function sansAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

function renduExclusions() {
  const b = questionnaire.brouillon
  const q = sansAccents(questionnaire.recherche.trim())
  let html = ''

  // Aliments précis ajoutés à la main
  if (b.exclusions_aliments.length) {
    html += `<div class="groupe-excl ouvert"><div class="groupe-excl-tete"><span class="groupe-excl-nom">Aliments précis</span></div><div class="puces">
      ${b.exclusions_aliments.map((a, i) => `<button type="button" class="puce active" onclick="retirerExclusionPrecise(${i})" aria-label="Retirer ${esc(a.libelle)}">${esc(a.libelle)} <span aria-hidden="true">×</span></button>`).join('')}
    </div></div>`
  }

  let trouves = 0
  for (const g of GROUPES_ALIMENTS) {
    const groupeExclu = b.exclusions.includes(g.cle)
    const items = q ? g.items.filter(([, lib]) => sansAccents(lib).includes(q) || sansAccents(g.libelle).includes(q)) : g.items
    if (!items.length) continue
    trouves += items.length
    const nbCoches = g.items.filter(([cle]) => b.exclusions.includes(`${g.cle}:${cle}`)).length
    const ouvert = q || questionnaire.groupesOuverts.has(g.cle)
    const resume = groupeExclu ? 'tout le groupe' : nbCoches ? `${nbCoches} exclu${nbCoches > 1 ? 's' : ''}` : ''
    html += `
      <div class="groupe-excl ${ouvert ? 'ouvert' : ''}">
        <button type="button" class="groupe-excl-tete" onclick="basculerGroupeOuvert('${g.cle}')" aria-expanded="${!!ouvert}">
          <span class="groupe-excl-nom">${g.libelle}</span>
          <span class="groupe-excl-resume">${resume}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>
        ${ouvert ? `<div class="puces">
          ${g.items.length > 1 ? `<button type="button" class="puce puce-groupe ${groupeExclu ? 'active' : ''}" aria-pressed="${groupeExclu}" onclick="basculerExclusion('${g.cle}')">Tout le groupe</button>` : ''}
          ${items.map(([cle, lib]) => {
            const actif = groupeExclu || b.exclusions.includes(`${g.cle}:${cle}`)
            return `<button type="button" class="puce ${actif ? 'active' : ''}" aria-pressed="${actif}" ${groupeExclu ? 'disabled' : ''} onclick="basculerExclusion('${g.cle}:${cle}')">${esc(lib)}</button>`
          }).join('')}
        </div>` : ''}
      </div>`
  }

  if (q) {
    html += `<button type="button" class="btn btn-secondaire btn-bloc" style="margin-top:var(--sp-3);" onclick="ajouterExclusionPrecise()">
      Exclure « ${esc(questionnaire.recherche.trim())} »</button>`
    if (!trouves) html = `<p class="message-info" style="margin-bottom:var(--sp-3);">Pas dans la liste, mais tu peux l'exclure quand même.</p>` + html
  }
  return html
}

function majExclusions() { document.getElementById('q-exclusions').innerHTML = renduExclusions() }

let _exclTimer = null
let _suggestionsExcl = []

function rechercherExclusion(v) {
  questionnaire.recherche = v
  majExclusions()
  clearTimeout(_exclTimer)
  if (v.trim().length >= 3) _exclTimer = setTimeout(() => suggestionsCiqualExclusion(v), 300)
}

// Suggestions depuis la table Ciqual : l'aliment exclu est relié à son code
async function suggestionsCiqualExclusion(v) {
  const mots = motsRecherche(v)
  if (!mots.length) return
  let req = db.from('aliments_ciqual').select('code, nom').limit(6)
  for (const m of mots) req = req.ilike('nom_recherche', `%${m}%`)
  const { data, error } = await req
  if (error || questionnaire.recherche !== v || !data?.length) return
  _suggestionsExcl = data.sort((a, b) => a.nom.length - b.nom.length)
  const el = document.getElementById('q-exclusions')
  if (!el) return
  el.insertAdjacentHTML('beforeend', `
    <div class="resultats-titre" style="margin-top:var(--sp-4);">Dans la base d'aliments</div>
    <div class="puces">${_suggestionsExcl.map((a, i) => `<button type="button" class="puce" onclick="ajouterExclusionCiqual(${i})">${esc(a.nom)}</button>`).join('')}</div>`)
}

function ajouterExclusionCiqual(i) {
  const a = _suggestionsExcl[i]
  const b = questionnaire.brouillon
  if (a && !b.exclusions_aliments.some(x => x.ciqual_code === a.code)) {
    b.exclusions_aliments = [...b.exclusions_aliments, { libelle: a.nom, ciqual_code: a.code }]
  }
  questionnaire.recherche = ''
  document.getElementById('q-recherche').value = ''
  majExclusions()
}

function basculerGroupeOuvert(cle) {
  const s = questionnaire.groupesOuverts
  s.has(cle) ? s.delete(cle) : s.add(cle)
  majExclusions()
}

function basculerExclusion(cle) {
  const b = questionnaire.brouillon
  if (b.exclusions.includes(cle)) b.exclusions = b.exclusions.filter(x => x !== cle)
  else {
    b.exclusions = [...b.exclusions, cle]
    // Exclure tout le groupe remplace les choix individuels
    if (!cle.includes(':')) b.exclusions = b.exclusions.filter(x => !x.startsWith(cle + ':'))
  }
  majExclusions()
}

function ajouterExclusionPrecise() {
  const libelle = questionnaire.recherche.trim()
  if (!libelle) return
  const b = questionnaire.brouillon
  if (!b.exclusions_aliments.some(a => sansAccents(a.libelle) === sansAccents(libelle))) {
    // ciqual_code sera relié à la base d'aliments à l'étape 3
    b.exclusions_aliments = [...b.exclusions_aliments, { libelle, ciqual_code: null }]
  }
  questionnaire.recherche = ''
  document.getElementById('q-recherche').value = ''
  majExclusions()
}

function retirerExclusionPrecise(i) {
  const b = questionnaire.brouillon
  b.exclusions_aliments = b.exclusions_aliments.filter((_, j) => j !== i)
  majExclusions()
}

// Libellés lisibles des exclusions (réglages)
function libellesExclusions(p) {
  const libs = []
  for (const cle of p.exclusions || []) {
    const [g, item] = cle.split(':')
    const groupe = GROUPES_ALIMENTS.find(x => x.cle === g)
    if (!groupe) continue
    if (!item) libs.push(`${groupe.libelle} (tout)`)
    else { const it = groupe.items.find(([c]) => c === item); if (it) libs.push(it[1]) }
  }
  for (const a of p.exclusions_aliments || []) libs.push(a.libelle)
  return libs
}

// ═════════════════════════════════════════════════════════════
// RÉGLAGES DU PROFIL
// ═════════════════════════════════════════════════════════════
function chargerReglagesProfil() {
  const el = document.getElementById('reglages-profil')
  if (!el || !profil) return
  const p = profil
  const o = objectifsActuels()
  const exclusions = libellesExclusions(p)
  const jours = JOURS_SEMAINE.filter(([n]) => (p.jours_sport || []).includes(n)).map(([, , l]) => l.slice(0, 3).toLowerCase()).join(', ')
  const materiel = [p.materiel?.elastique && 'élastique', p.materiel?.tapis && 'tapis de sol'].filter(Boolean).join(', ') || 'aucun'

  el.innerHTML = `
    <div class="carte">
      <div class="carte-titre">Mes repères</div>
      ${o ? renduCarteObjectifs({ ...o, cible: cibleKcalDuJour() ?? o.cible }, p) : '<p class="carte-texte">Complète ton profil pour voir tes repères.</p>'}
      ${o ? `
      <details class="details">
        <summary>Comment c'est calculé ?</summary>
        <div class="ligne"><span>Métabolisme de base (Mifflin-St Jeor)</span><span class="ligne-valeur">${formatNombre(o.tmb)} kcal</span></div>
        <div class="ligne"><span>Dépense estimée (${NIVEAUX_ACTIVITE[p.activite]?.libelle.toLowerCase() || ''})</span><span class="ligne-valeur">${formatNombre(o.depense)} kcal</span></div>
        <div class="ligne"><span>Déficit</span><span class="ligne-valeur">${formatNombre(o.deficit)} kcal</span></div>
        <div class="ligne"><span>Protéines (1,6 à 1,8 g/kg)</span><span class="ligne-valeur">${o.proteines.min} à ${o.proteines.max} g</span></div>
        <div class="ligne"><span>Calculé pour</span><span class="ligne-valeur">${formatNombre(p.poids_reference ?? o.poids, 1)} kg, le ${formatDate(p.date_calcul_cible)}</span></div>
        <p class="message-info">Plancher absolu : 1 200 kcal. La cible est recalculée à chaque fois que tu perds 2 kg. À l'objectif, une phase de stabilisation de ${p.semaines_stabilisation} semaines remonte les calories progressivement. Le TMB mesuré par la balance s'affichera en comparaison après ta première pesée.</p>
      </details>` : ''}
    </div>

    <div class="carte">
      <div class="carte-titre">Mon profil</div>
      ${ligneReglage('Profil', `${calculerAge(p.date_naissance) ?? '-'} ans · ${formatNombre(p.taille_cm)} cm · ${formatNombre(p.poids_depart, 1)} kg au départ`, "ouvrirQuestionnaire('reglage','toi')")}
      ${ligneReglage('Activité', NIVEAUX_ACTIVITE[p.activite]?.libelle || '-', "ouvrirQuestionnaire('reglage','toi')")}
      ${ligneReglage('Objectif', p.poids_objectif ? `${formatNombre(p.poids_objectif, 1)} kg` : '-', "ouvrirQuestionnaire('reglage','objectif')")}
    </div>

    <div class="carte">
      <div class="carte-titre">Alimentation</div>
      ${ligneReglage("Je n'aime pas", exclusions.length ? esc(exclusions.slice(0, 4).join(', ')) + (exclusions.length > 4 ? ` et ${exclusions.length - 4} autres` : '') : 'rien d\'exclu', "ouvrirQuestionnaire('reglage','gouts')")}
      ${ligneReglage('Cuisine', `${p.temps_cuisine_max} min max · ${p.nb_personnes_defaut} pers.`, "ouvrirQuestionnaire('reglage','cuisine')")}
    </div>

    <div class="carte">
      <div class="carte-titre">Sport</div>
      ${ligneReglage('Séances', `${p.seances_par_semaine} × ${p.duree_seance} min · ${jours}`, "ouvrirQuestionnaire('reglage','sport')")}
      ${ligneReglage('Matériel', materiel, "ouvrirQuestionnaire('reglage','sport')")}
    </div>

    <div class="carte">
      <div class="carte-titre">Bilan du soir</div>
      <div class="champ" style="margin:0;">
        <span class="champ-label">Calories actives de la montre comptées : <strong id="reglage-pct-val">${p.pct_calories_actives} %</strong></span>
        <input class="curseur" type="range" min="0" max="100" step="5" value="${p.pct_calories_actives}"
          oninput="document.getElementById('reglage-pct-val').textContent = this.value + ' %'"
          onchange="enregistrerPctCaloriesActives(this.value)" />
        <p class="message-info">L'Apple Watch surestime souvent les calories actives : seule cette part est comptée dans la dépense du jour.</p>
      </div>
    </div>`
}

function ligneReglage(titre, valeur, action) {
  return `<button type="button" class="ligne ligne-action" onclick="${action}">
    <span>${titre}</span><span class="ligne-valeur">${valeur}</span><span class="chevron" aria-hidden="true">›</span></button>`
}

async function enregistrerPctCaloriesActives(v) {
  if (await sauvegarderProfil({ pct_calories_actives: Number(v) })) afficherToast('Enregistré')
}
