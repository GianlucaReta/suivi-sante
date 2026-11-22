-- ─────────────────────────────────────────────────────────────
-- Phase 5 : Sport à la maison
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Exercices (référence partagée, lecture seule) ─────────
-- Remplis par exercices-import.sql, généré par import-exercices.js.
CREATE TABLE IF NOT EXISTS public.exercices (
  id            TEXT PRIMARY KEY,
  nom           TEXT NOT NULL,
  wger_id       INTEGER,
  materiel      TEXT NOT NULL CHECK (materiel IN ('aucun', 'tapis', 'elastique', 'tapis_elastique')),
  zone          TEXT NOT NULL CHECK (zone IN ('jambes', 'fessiers', 'gainage', 'haut_du_corps', 'cardio')),
  mode          TEXT NOT NULL CHECK (mode IN ('reps', 'duree')),
  base          INTEGER NOT NULL CHECK (base > 0),   -- répétitions ou secondes au niveau 1
  cote          BOOLEAN NOT NULL DEFAULT false,      -- à faire de chaque côté
  consignes     TEXT[] NOT NULL DEFAULT '{}',
  image_url     TEXT,                                -- image wger (null = image de remplacement)
  image_credit  TEXT,                                -- auteur et licence de l'image
  actif         BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.exercices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exercices_lecture ON public.exercices;
CREATE POLICY exercices_lecture ON public.exercices FOR SELECT TO authenticated USING (true);

-- ── 2. Séances planifiées ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  semaine_debut DATE NOT NULL,                       -- lundi de la semaine
  date_prevue   DATE NOT NULL,                       -- date actuelle (après report éventuel)
  date_initiale DATE NOT NULL,                       -- date prévue au départ
  type          TEXT NOT NULL DEFAULT 'A' CHECK (type IN ('A', 'B')),  -- A : bas du corps, B : haut du corps et gainage
  statut        TEXT NOT NULL DEFAULT 'prevue' CHECK (statut IN ('prevue', 'faite', 'abandonnee')),
  ressenti      TEXT CHECK (ressenti IN ('facile', 'correct', 'difficile')),
  niveau        INTEGER,                             -- niveau utilisé pour la séance faite
  duree_min     INTEGER,
  faite_le      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seances_user_semaine ON public.seances (user_id, semaine_debut);
-- Jamais plus d'une séance prévue ou faite par jour
CREATE UNIQUE INDEX IF NOT EXISTS idx_seances_un_par_jour ON public.seances (user_id, date_prevue) WHERE statut <> 'abandonnee';

ALTER TABLE public.seances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seances_proprietaire ON public.seances;
CREATE POLICY seances_proprietaire ON public.seances FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── 3. Progression (dans le profil) ──────────────────────────
ALTER TABLE public.profils
  ADD COLUMN IF NOT EXISTS sport_niveau      INTEGER NOT NULL DEFAULT 1 CHECK (sport_niveau BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS sport_niveau_date DATE;  -- date du dernier changement de niveau

-- ── 4. Vérification : doit renvoyer 0 ligne ──────────────────
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
