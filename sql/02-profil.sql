-- ─────────────────────────────────────────────────────────────
-- Phase 2 : Profil, questionnaire et règles de santé
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.profils
  -- Profil
  ADD COLUMN IF NOT EXISTS sexe                 TEXT    CHECK (sexe IN ('femme', 'homme')),
  ADD COLUMN IF NOT EXISTS date_naissance       DATE,
  ADD COLUMN IF NOT EXISTS taille_cm            NUMERIC CHECK (taille_cm BETWEEN 120 AND 230),
  ADD COLUMN IF NOT EXISTS poids_depart         NUMERIC CHECK (poids_depart BETWEEN 30 AND 300),
  ADD COLUMN IF NOT EXISTS date_depart          DATE,
  ADD COLUMN IF NOT EXISTS poids_objectif       NUMERIC CHECK (poids_objectif BETWEEN 30 AND 300),
  ADD COLUMN IF NOT EXISTS activite             TEXT    CHECK (activite IN ('sedentaire', 'faible', 'moderee', 'elevee')),

  -- Alimentation
  -- exclusions : clés de la liste du site (ex. 'legumes:champignons', ou 'legumes' pour tout le groupe)
  ADD COLUMN IF NOT EXISTS exclusions           TEXT[]  NOT NULL DEFAULT '{}',
  -- exclusions_aliments : aliments précis [{ "libelle": "...", "ciqual_code": "..." | null }]
  ADD COLUMN IF NOT EXISTS exclusions_aliments  JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS temps_cuisine_max    INTEGER NOT NULL DEFAULT 40 CHECK (temps_cuisine_max BETWEEN 5 AND 180),
  ADD COLUMN IF NOT EXISTS nb_personnes_defaut  INTEGER NOT NULL DEFAULT 2  CHECK (nb_personnes_defaut BETWEEN 1 AND 8),

  -- Sport
  ADD COLUMN IF NOT EXISTS materiel             JSONB   NOT NULL DEFAULT '{"elastique": true, "tapis": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS jours_sport          INTEGER[] NOT NULL DEFAULT '{1,3,5}',  -- 1 = lundi … 7 = dimanche
  ADD COLUMN IF NOT EXISTS seances_par_semaine  INTEGER NOT NULL DEFAULT 3  CHECK (seances_par_semaine BETWEEN 3 AND 6),
  ADD COLUMN IF NOT EXISTS duree_seance         INTEGER NOT NULL DEFAULT 25 CHECK (duree_seance BETWEEN 20 AND 30),

  -- Bilan du soir : part des calories actives de la montre prise en compte
  ADD COLUMN IF NOT EXISTS pct_calories_actives INTEGER NOT NULL DEFAULT 50 CHECK (pct_calories_actives BETWEEN 0 AND 100),

  -- Règles de santé (calculées par le site, enregistrées pour l'historique)
  ADD COLUMN IF NOT EXISTS phase                TEXT    NOT NULL DEFAULT 'perte' CHECK (phase IN ('perte', 'stabilisation', 'maintien')),
  ADD COLUMN IF NOT EXISTS poids_reference      NUMERIC,      -- poids utilisé pour le dernier calcul de la cible
  ADD COLUMN IF NOT EXISTS date_calcul_cible    DATE,
  ADD COLUMN IF NOT EXISTS cible_kcal           INTEGER CHECK (cible_kcal >= 1200),  -- plancher absolu
  ADD COLUMN IF NOT EXISTS cible_proteines      INTEGER,
  ADD COLUMN IF NOT EXISTS date_debut_stabilisation DATE,
  ADD COLUMN IF NOT EXISTS semaines_stabilisation   INTEGER NOT NULL DEFAULT 6 CHECK (semaines_stabilisation BETWEEN 4 AND 8);

-- L'objectif doit être inférieur au poids de départ
ALTER TABLE public.profils DROP CONSTRAINT IF EXISTS profils_objectif_inferieur;
ALTER TABLE public.profils ADD CONSTRAINT profils_objectif_inferieur
  CHECK (poids_objectif IS NULL OR poids_depart IS NULL OR poids_objectif < poids_depart);

-- Les jours de sport sont entre 1 (lundi) et 7 (dimanche)
ALTER TABLE public.profils DROP CONSTRAINT IF EXISTS profils_jours_sport_valides;
ALTER TABLE public.profils ADD CONSTRAINT profils_jours_sport_valides
  CHECK (jours_sport <@ ARRAY[1,2,3,4,5,6,7]);

-- La RLS de la phase 1 couvre déjà ces colonnes (une ligne par utilisateur).
