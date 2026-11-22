# Plan d'architecture : site de suivi santé

Proposition à valider avant de démarrer la phase 1.

## 1. Ce que je reprends de Suivi-projets-SEGEDIA

- HTML, CSS et JS natif, sans build. Un `index.html` qui contient toutes les pages (`<div id="page-xxx" class="page">`) et toutes les modales (`.modal-overlay.hidden`). Navigation par `showPage('xxx')`.
- Un client Supabase global `db = createClient(SUPABASE_URL, SUPABASE_KEY)` en tête de `app.js`, chargé par CDN jsdelivr.
- Code en français : `chargerXxx()` pour lire et afficher, `sauvegarderXxx()` pour écrire, `ouvrirModalXxx()` / `fermerModals()`, sections séparées par `// ── TITRE ───`.
- Rendu par gabarits `innerHTML` avec des template literals, et un état en variables globales.
- Gestion des erreurs : `const { data, error } = await db.from(...)`, puis `if (error) { console.error(error); afficherToast('…', true); return }`.
- Préférences locales de l'appareil dans `localStorage`, avec un préfixe (`ss_`).
- SQL dans des fichiers `.sql` à la racine, à coller dans Supabase → SQL Editor. Edge Functions en Deno dans `supabase/functions/<nom>/index.ts`, avec les secrets lus par `Deno.env.get()`.
- Scripts d'import Node à lancer une fois, comme `import.js`.
- Déploiement : GitHub Pages depuis la racine de la branche `main`, sans GitHub Actions.

## 2. Ce que je change, et pourquoi

| Autre site | Nouveau site | Raison |
|---|---|---|
| Code PIN vérifié côté navigateur, avec la clé publique | Supabase Auth, code OTP à 6 chiffres par e-mail, session persistante | Exigé par le prompt. Sans vraie session, RLS est impossible. |
| Pas de RLS : la clé publique lit et écrit tout | RLS sur toutes les tables, `auth.uid() = user_id` | Ce sont des données de santé. |
| Beaucoup de styles en ligne (`style="…"`) | Classes CSS dans `style.css`, valeurs en variables `:root` | Pour appliquer la charte Claude Design plus tard, et le mode sombre. |
| `alert()` | `afficherToast()` uniquement | `alert()` passe mal dans une PWA iPhone. |
| Données injectées telles quelles dans `innerHTML` | Petit helper `esc()` sur tout texte saisi | Évite qu'un nom de produit Open Food Facts casse la page. |
| Mise en page pour ordinateur, avec sidebar | Mobile d'abord : barre d'onglets en bas sur téléphone, sidebar au-dessus de 960 px | Usage principal sur iPhone. |

## 3. Fichiers

Décision : la logique est découpée en plusieurs fichiers JS, un par module, chargés avec des `<script>` classiques dans `index.html` (sans build ni `import`). Toutes les fonctions restent globales, comme dans l'autre site, pour que les `onclick="…"` du HTML continuent de marcher. L'ordre de chargement compte : `app.js` (config, `db`, outils) d'abord, puis les modules, et `init.js` en dernier.

```
index.html            pages + modales
style.css             variables :root (clair + sombre), composants
app.js                config Supabase, client db, navigation, outils (esc, toast, dates)
auth.js               connexion OTP, session, déconnexion, détection de pause Supabase
profil.js             questionnaire, réglages, calculs (phase 2)
journal.js            aliments, scan, journal, photos (phase 3)
menus.js              recettes, menus, courses (phase 4)
sport.js              planning, séance guidée (phase 5)
suivi.js              bilan, pesée, cycle, sucre (phase 6)
graphiques.js         (phase 7)
notifications.js      (phase 8)
init.js               démarrage
sql/                  un fichier SQL par phase (01-socle.sql, 02-profil.sql…), à coller dans le SQL Editor
manifest.json         PWA : nom, icônes, mode standalone
service-worker.js     PWA : cache des fichiers, réception des notifications push
icons/                icônes 192 / 512 / apple-touch-icon + image d'exercice de remplacement
schema.sql            tables, index, RLS, bucket photos (phase 1, puis complété à chaque phase)
import-ciqual.js      script Node, lancé une fois (phase 3)
recettes.json         base de recettes (phase 4) + import-recettes.js
import-exercices.js   récupère wger une fois, filtre selon les règles nuque (phase 5)
supabase/functions/envoyer-rappels/index.ts   Web Push programmé (phase 8)
README.md
```

Les scripts d'import ont besoin d'écrire dans des tables protégées. Ils liront la clé service_role depuis une variable d'environnement au moment du lancement (`SUPABASE_SERVICE_KEY=… node import-ciqual.js`). Cette clé n'est jamais écrite dans un fichier.

## 4. Tables Supabase

**Tables de référence**, partagées et en lecture seule pour les utilisateurs connectés (pas de `user_id`) :
- `aliments_ciqual` : code, nom, groupe, rayon, kcal, protéines, glucides, sucres, lipides, fibres pour 100 g (environ 3 200 lignes).
- `recettes`, `recette_ingredients` (recette_id, ciqual_code, grammes, substituts).
- `exercices` : wger_id, nom, description, image_url, matériel, type (répétitions ou durée), sûr pour la nuque.

**Tables personnelles**, avec `user_id` et RLS :
- `profils` : âge, taille, objectif, activité, temps de cuisine, % de calories actives compté, matériel, jours et nombre de séances, phase (perte ou stabilisation), cible kcal, poids de référence du dernier recalcul, réglages des rappels.
- `exclusions` : catégorie ou aliment précis.
- `produits` : cache Open Food Facts par code-barres, valeurs corrigeables à la main.
- `journal` : date, heure, type de repas, source (ciqual, produit ou recette), quantité en g, nutriments calculés au moment de la saisie, chemin de la photo.
- `menus`, `menu_repas` : semaine, statut brouillon ou figé, recette, portions, nombre de personnes.
- `courses` : menu, aliment, quantité, rayon, coché.
- `seances` : date prévue, date réelle, statut (prévue, faite, reportée, abandonnée), ressenti, et `niveaux_exercices` pour la progression.
- `bilans` : un par jour, avec calories actives, calories au repos, pas, sommeil, qualité du sommeil, humeur.
- `pesees`, `cycles`, `envies`, `sucreries` (cookies et chocolat par jour), `alternatives`.
- `abonnements_push` : point d'envoi de chaque appareil.

**Stockage** : bucket privé `photos-repas`, chemin `{user_id}/{date}/{id}.webp`, RLS sur le dossier de l'utilisateur, affichage par URL signée.

Un deuxième utilisateur (toi) pourra être ajouté plus tard sans rien changer, puisque tout est déjà lié à `user_id`.

## 4 bis. Décisions validées

- Dépôt GitHub `suivi-sante`, public (aucune donnée personnelle dedans). Le prompt, qui contient le profil personnel, est exclu par `.gitignore`.
- Inscriptions publiques désactivées : le compte de l’utilisatrice est créé à la main dans Supabase, et la connexion utilise `shouldCreateUser: false`. Un second compte s'ajoutera de la même façon.
- Jour sans craquage : un jour sans cookie ni chocolat noté.
- Exercices : présélection dans le script d'import (règles nuque + matériel), liste soumise pour validation, puis import dans `exercices`.

## 5. Phases

Comme dans le prompt, avec une validation et un commit à la fin de chacune :

1. Socle
2. Profil et calculs
3. Aliments et journal
4. Recettes et menus (la base de recettes est générée ici, une fois Ciqual importée, pour relier chaque ingrédient à un vrai code)
5. Sport
6. Suivi quotidien
7. Graphiques
8. Notifications
9. Vérification et README

## 6. Points techniques à connaître

- **Code OTP** : il faut modifier le modèle d'e-mail « Magic Link » dans Supabase pour qu'il affiche `{{ .Token }}` au lieu du lien. Je te guiderai.
- **Limite d'e-mails** : le service d'e-mails gratuit de Supabase est limité à quelques envois par heure. Ça suffit, car la session reste ouverte.
- **Inscriptions** : je recommande de désactiver les inscriptions publiques une fois le compte de l’utilisatrice créé, pour que personne d'autre ne puisse se créer un compte.
- **Dépôt public** : GitHub Pages gratuit impose un dépôt public. Le code sera visible, mais aucune donnée personnelle n'y sera.
- **Projet en pause** : si le projet Supabase est en pause après 7 jours sans activité, la page affichera un message clair au lieu d'un écran vide.
