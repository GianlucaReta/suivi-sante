# Suivi santé

Site personnel de suivi forme et perte de poids, pensé pour l'iPhone (installable sur l'écran d'accueil) et utilisable sur ordinateur.

- HTML, CSS et JavaScript natif, sans framework ni étape de build
- Données : Supabase (projet dédié, Row Level Security sur toutes les tables)
- Hébergement : GitHub Pages
- Connexion : code à 6 chiffres reçu par e-mail, sans mot de passe

> Ce README est complété à chaque phase. La version complète (utilisation, vérifications) arrive en phase 9.

## ⏳ À faire plus tard

- [ ] **Importer la table Ciqual** (en attente : ciqual.anses.fr, recherche.data.gouv.fr et les fichiers de data.gouv.fr étaient en maintenance le 22/11/2026).
  1. Réessayer [ciqual.anses.fr](https://ciqual.anses.fr) (rubrique *Téléchargement*), ou la [page data.gouv.fr](https://www.data.gouv.fr/fr/datasets/table-de-composition-nutritionnelle-des-aliments-ciqual-2020/) → onglet **Fichiers** → « Table Ciqual 2020 en Français » **XLS (3,5 Mo)** → **Télécharger**. Si la version actualisée de recherche.data.gouv.fr est disponible, la préférer.
  2. Suivre la section **« Importer la table Ciqual »** ci-dessous (export CSV depuis Numbers, `node import-ciqual.js`, import dans Supabase).
  3. Compléter la base de recettes jusqu'à 150 à 200 recettes (demander à Claude, avec le fichier Ciqual sous la main pour reprendre les noms exacts), puis la relier aux codes Ciqual (voir la section « Importer les recettes »).
  - En attendant : le scan de code-barres et la saisie libre fonctionnent. La recherche d'aliments et les recettes restent vides tant que Ciqual n'est pas importée.

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Toutes les pages et fenêtres |
| `style.css` | Styles. Couleurs, polices et espacements en variables dans `:root` (mode sombre inclus) |
| `app.js` | Configuration Supabase, client `db`, navigation, outils communs (`esc`, `afficherToast`, `gererErreur`, `dateISO`) |
| `auth.js` | Connexion par code, session, déconnexion, détection d'un serveur en pause |
| `calculs.js` | Règles de santé (calculs purs, testés : `node tests/calculs.test.js`) |
| `profil.js` | Questionnaire, réglages du profil, exclusions alimentaires |
| `journal.js` | Journal alimentaire, recherche Ciqual, scan Open Food Facts, photos |
| `menus.js` | Menus de la semaine, portions ajustées, liste de courses |
| `sport.js` | Planning des séances avec report, séance guidée, progression |
| `suivi.js` | Bilan du soir, pesée hebdomadaire, module sucre, cycle menstruel |
| `exercices.json` | Exercices présélectionnés (sans risque pour la nuque) |
| `import-exercices.js` | Récupère les images wger et génère le SQL d'import des exercices |
| `recettes.json` | Base de recettes (ingrédients reliés aux noms Ciqual) |
| `import-recettes.js` | Relie les recettes aux codes Ciqual et génère le SQL d'import |
| `init.js` | Démarrage (chargé en dernier) |
| `manifest.json`, `service-worker.js`, `icons/` | Installation sur iPhone (PWA), cache, notifications |
| `sql/` | Scripts à exécuter dans Supabase, un par phase, dans l'ordre (coller tout le fichier et cliquer sur **Run** sans rien sélectionner) |
| `import-ciqual.js` | Conversion de la table Ciqual pour l'import (lancé une fois) |

Les modules s'ajoutent phase par phase (`menus.js`, `sport.js`…). Ce sont des `<script>` classiques : toutes les fonctions sont globales.

---

## Importer la table Ciqual (une seule fois)

La table Ciqual de l'ANSES donne la composition de ~3 200 aliments de base. Elle sert à la recherche d'aliments et au calcul des recettes.

1. **Exécuter `sql/03-journal.sql`** dans le SQL Editor de Supabase (si ce n'est pas déjà fait).
2. **Télécharger la table** sur [ciqual.anses.fr](https://ciqual.anses.fr), rubrique *Téléchargement*. Prends la version tableur en français, la plus récente (fichier `.xls` ou `.xlsx`). Elle existe aussi sur [data.gouv.fr](https://www.data.gouv.fr/fr/datasets/table-de-composition-nutritionnelle-des-aliments-ciqual-2020/).
3. **L'exporter en CSV** : ouvre le fichier dans Numbers (ou Excel), puis *Fichier → Exporter vers → CSV* (Numbers) ou *Enregistrer sous → CSV UTF-8* (Excel). Les fichiers `.csv` ne sont jamais publiés sur GitHub (`.gitignore`).
4. **Le convertir**, dans le Terminal, depuis ce dossier :
   ```bash
   node import-ciqual.js "/chemin/vers/Table Ciqual.csv"
   ```
   Le script affiche le nombre d'aliments convertis et crée `ciqual-import.csv`.
5. **L'importer** : Supabase → **Table Editor** → table `aliments_ciqual` → **Insert** → **Import data from CSV** → choisis `ciqual-import.csv` → **Import data**.
6. Vérifier dans le SQL Editor : `select count(*) from aliments_ciqual;` doit donner environ 3 000 à 3 500.

Pas besoin de clé secrète : le script ne fait que convertir un fichier sur ton ordinateur, et l'import passe par le dashboard.

## Importer les exercices

1. Exécuter `sql/05-sport.sql` dans le SQL Editor (si ce n'est pas déjà fait).
2. Dans le Terminal, depuis ce dossier :
   ```bash
   node import-exercices.js
   ```
   Le script récupère les images sur l'API gratuite wger et liste les exercices sans image (une image de remplacement est utilisée).
3. Coller le contenu de `exercices-import.sql` dans le SQL Editor → **Run**.

Pour ajouter ou retirer un exercice : modifier `exercices.json`, puis refaire les étapes 2 et 3. Un exercice retiré est désactivé, pas supprimé.

## Importer les recettes (après Ciqual)

Les recettes sont décrites dans `recettes.json`. Chaque ingrédient porte le **nom** de l'aliment Ciqual correspondant, jamais de valeurs nutritionnelles : le site les calcule toujours depuis la table Ciqual.

1. Exécuter `sql/04-menus.sql` dans le SQL Editor (si ce n'est pas déjà fait).
2. Dans le Terminal, depuis ce dossier :
   ```bash
   node import-recettes.js ciqual-import.csv
   ```
3. Lire `recettes-rapport.txt` :
   - **correspondances approchées** : vérifier que l'aliment retenu est le bon (même aliment, même état cru/cuit) ;
   - **introuvables** : corriger le nom `ciqual` de l'ingrédient dans `recettes.json`, puis relancer l'étape 2.
   Une recette dont un ingrédient obligatoire n'est pas relié n'est jamais proposée.
4. Coller le contenu de `recettes-import.sql` dans le SQL Editor → **Run**. Le script peut être relancé après chaque modification de `recettes.json`.

---

## Installation

### 1. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com) → **New project**.
   - Nom : `suivi-sante`
   - Région : **West EU (Paris)**
   - Mot de passe de la base : génère-le et garde-le dans ton gestionnaire de mots de passe. Le site n'en a pas besoin.
2. Une fois le projet prêt : **SQL Editor** → **New query** → colle le contenu de `sql/01-socle.sql` → **Run**.
   La dernière requête doit renvoyer **0 ligne**, ce qui confirme que toutes les tables ont la RLS.

### 2. Régler la connexion par code

Dans **Authentication** :

1. **Sign In / Providers** :
   - Sur la page elle-même, section **User Signups** en haut : **Allow new users to sign up** **désactivé**, puis **Save changes**. Personne ne peut se créer de compte. Les comptes sont ajoutés à la main (étape 3).
   - Clic sur **Email** : provider activé, **Email OTP Length** `6`, **Email OTP Expiration** `900` secondes (15 min).
2. **Envoi des e-mails (SMTP)** : sans SMTP personnalisé, Supabase interdit de modifier le modèle d'e-mail, et le modèle par défaut contient un lien, pas de code. On branche donc une boîte Gmail (gratuit, 500 e-mails par jour) :
   1. Sur le compte Google qui enverra les codes (la validation en deux étapes doit être activée) : [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → nom `Supabase` → **Créer**. Note le mot de passe de 16 lettres affiché.
   2. Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP** :
      - Sender email : l'adresse Gmail ; Sender name : `Suivi santé`
      - Host : `smtp.gmail.com` ; Port : `465`
      - Username : l'adresse Gmail ; Password : le mot de passe de 16 lettres
      - **Save changes**
   3. **Authentication → Rate Limits** : passe la limite d'envoi d'e-mails à `10` par heure. C'est largement suffisant et ça limite les abus.
3. **Emails → Templates → Magic link or OTP** (modifiable une fois le SMTP branché) : le site envoie un code, pas un lien. Remplace le sujet et le contenu (bouton **Source**) :
   - Sujet : `Ton code de connexion : {{ .Token }}`
   - Contenu :
     ```html
     <h2>Ton code de connexion</h2>
     <p>Saisis ce code dans Suivi santé :</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:6px;">{{ .Token }}</p>
     <p>Il est valable 15 minutes. Si tu n'as rien demandé, ignore cet e-mail.</p>
     ```
4. **URL Configuration** → **Site URL** : `https://gianlucareta.github.io/suivi-sante/`

> Comme la session reste ouverte, il n'y a besoin d'un code qu'à la première connexion sur chaque appareil.

### 3. Créer le compte de l’utilisatrice

**Authentication → Users → Add user → Create new user** :
- son adresse e-mail ;
- un mot de passe long au hasard (il ne servira jamais) ;
- coche **Auto Confirm User**.

Le profil est créé automatiquement par le script SQL. Un deuxième compte s'ajoutera plus tard de la même façon.

### 4. Brancher le site sur Supabase

L'URL de l'API est `https://<identifiant-du-projet>.supabase.co`. L'identifiant est celui qu'on voit dans l'adresse du dashboard (`…/dashboard/project/<identifiant>`). Pour la clé : **Project Settings → API Keys** → clé **publishable** (`sb_publishable_…`). Les deux se mettent en haut de `app.js` :

```js
const SUPABASE_URL = 'https://uwzsqkvzshrnxvpdjelo.supabase.co'
const SUPABASE_KEY = 'sb_publishable_…'
```

⚠️ Ne mets **jamais** la clé *secret* / *service_role* dans le code. Elle donnerait accès à tout en contournant la RLS.

### 5. Mettre en ligne sur GitHub Pages

1. Sur GitHub : **New repository** → nom `suivi-sante`, **Public**, sans README.
2. Dans ce dossier :
   ```bash
   git remote add origin https://github.com/GianlucaReta/suivi-sante.git
   ```
   ```bash
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages** → *Deploy from a branch* → `main` / `/ (root)` → **Save**.
   Le site est en ligne au bout d'une minute environ, à l'adresse `https://gianlucareta.github.io/suivi-sante/`.

À chaque mise en ligne, change `CACHE_VERSION` dans `service-worker.js` et `APP_VERSION` dans `app.js`. Les téléphones récupèrent ainsi la nouvelle version.

### 6. Installer le site sur l'iPhone

1. Ouvre l'adresse du site dans **Safari** (pas Chrome).
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Ouvre l'app depuis l'icône, puis connecte-toi avec le code reçu par e-mail.

La session de l'app installée est séparée de celle de Safari. Connecte-toi bien **dans l'app**. Elle reste connectée jusqu'à un clic sur « Se déconnecter ».

---

## Projet en pause

Un projet Supabase gratuit se met en pause après **7 jours sans activité**. Le site affiche alors « Le serveur ne répond pas ».

Pour le relancer : [supabase.com](https://supabase.com) → le projet → **Restore project**. Le redémarrage prend quelques minutes. Aucune donnée n'est perdue.

---

## Sécurité

- RLS activée sur chaque table. Chaque ligne est liée à `user_id` et n'est visible que par son propriétaire.
- Seule la clé publique figure dans le code.
- Aucune donnée personnelle dans le dépôt.
- Les photos sont dans un bucket privé, rangées par utilisateur, et affichées par URL signée temporaire.
