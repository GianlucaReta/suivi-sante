-- ─────────────────────────────────────────────────────────────
-- Phase 6 : Bilan du soir, pesée, cycle, sucre
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- (sans rien sélectionner dans l'éditeur). Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Bilan du soir (un par jour) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.bilans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date             DATE NOT NULL,
  kcal_actives     INTEGER CHECK (kcal_actives BETWEEN 0 AND 5000),   -- montre
  kcal_repos       INTEGER CHECK (kcal_repos BETWEEN 0 AND 5000),     -- montre
  pas              INTEGER CHECK (pas BETWEEN 0 AND 100000),
  sommeil_min      INTEGER CHECK (sommeil_min BETWEEN 0 AND 1440),    -- sommeil de la nuit précédente
  sommeil_qualite  INTEGER CHECK (sommeil_qualite BETWEEN 1 AND 5),
  humeur           INTEGER CHECK (humeur BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- ── 2. Pesées (balance Terraillon) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.pesees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date                  DATE NOT NULL,
  poids                 NUMERIC NOT NULL CHECK (poids BETWEEN 30 AND 300),
  masse_grasse_pct      NUMERIC CHECK (masse_grasse_pct BETWEEN 1 AND 70),
  masse_hydrique_pct    NUMERIC CHECK (masse_hydrique_pct BETWEEN 20 AND 80),
  masse_musculaire_pct  NUMERIC CHECK (masse_musculaire_pct BETWEEN 10 AND 70),
  masse_osseuse_kg      NUMERIC CHECK (masse_osseuse_kg BETWEEN 0.5 AND 10),
  tmb                   INTEGER CHECK (tmb BETWEEN 600 AND 4000),
  imc                   NUMERIC CHECK (imc BETWEEN 10 AND 70),
  graisse_viscerale     NUMERIC CHECK (graisse_viscerale BETWEEN 1 AND 60),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- ── 3. Cycle menstruel (données privées) ─────────────────────
CREATE TABLE IF NOT EXISTS public.cycles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date_debut    DATE NOT NULL,            -- premier jour des règles
  duree_regles  INTEGER NOT NULL DEFAULT 5 CHECK (duree_regles BETWEEN 1 AND 15),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date_debut)
);

-- ── 4. Sucre : cookies et chocolat, envies, alternatives ─────
CREATE TABLE IF NOT EXISTS public.sucreries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date        DATE NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('cookie', 'chocolat')),
  quantite    NUMERIC NOT NULL DEFAULT 1 CHECK (quantite > 0 AND quantite <= 50),  -- cookies ou carrés
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sucreries_user_date ON public.sucreries (user_id, date);

CREATE TABLE IF NOT EXISTS public.envies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  moment        TIMESTAMPTZ NOT NULL DEFAULT now(),
  intensite     INTEGER NOT NULL CHECK (intensite BETWEEN 1 AND 5),
  declencheur   TEXT,                     -- stress, ennui, fatigue, apres_repas, soir, emotion, recompense, autre
  humeur        INTEGER CHECK (humeur BETWEEN 1 AND 5),
  satisfaite    BOOLEAN,                  -- l'envie a-t-elle été satisfaite ?
  alternative   TEXT,                     -- alternative choisie, le cas échéant
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_envies_user_moment ON public.envies (user_id, moment);

CREATE TABLE IF NOT EXISTS public.alternatives (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  texte       TEXT NOT NULL CHECK (length(texte) BETWEEN 1 AND 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. RLS : chaque utilisateur ne voit que ses lignes ───────
ALTER TABLE public.bilans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sucreries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alternatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bilans_proprietaire ON public.bilans;
DROP POLICY IF EXISTS pesees_proprietaire ON public.pesees;
DROP POLICY IF EXISTS cycles_proprietaire ON public.cycles;
DROP POLICY IF EXISTS sucreries_proprietaire ON public.sucreries;
DROP POLICY IF EXISTS envies_proprietaire ON public.envies;
DROP POLICY IF EXISTS alternatives_proprietaire ON public.alternatives;

CREATE POLICY bilans_proprietaire ON public.bilans FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY pesees_proprietaire ON public.pesees FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY cycles_proprietaire ON public.cycles FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY sucreries_proprietaire ON public.sucreries FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY envies_proprietaire ON public.envies FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY alternatives_proprietaire ON public.alternatives FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS trg_bilans_updated_at ON public.bilans;
CREATE TRIGGER trg_bilans_updated_at BEFORE UPDATE ON public.bilans
  FOR EACH ROW EXECUTE FUNCTION public.maj_updated_at();

-- ── 6. Vérification : doit renvoyer 0 ligne ──────────────────
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
