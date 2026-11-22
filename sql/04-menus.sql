-- ─────────────────────────────────────────────────────────────
-- Phase 4 : Recettes, menus de la semaine, liste de courses
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Recettes (référence partagée, lecture seule) ──────────
-- Remplies par recettes-import.sql, généré par import-recettes.js.
CREATE TABLE IF NOT EXISTS public.recettes (
  id            TEXT PRIMARY KEY,                 -- ex. 'poulet-riz-courgettes'
  nom           TEXT NOT NULL,
  types_repas   TEXT[] NOT NULL,                  -- petit_dejeuner, dejeuner, diner, collation
  temps_min     INTEGER NOT NULL CHECK (temps_min BETWEEN 1 AND 180),
  portions_base INTEGER NOT NULL DEFAULT 2 CHECK (portions_base BETWEEN 1 AND 12),
  etiquettes    TEXT[] NOT NULL DEFAULT '{}',     -- riche_proteines, economique, rapide, vegetarien…
  mois          INTEGER[] NOT NULL DEFAULT '{}',  -- mois de saison (vide = toute l'année)
  etapes        TEXT[] NOT NULL DEFAULT '{}',
  actif         BOOLEAN NOT NULL DEFAULT true
);

-- Ingrédients : quantités pour portions_base, reliés à un code Ciqual.
-- Les valeurs nutritionnelles sont toujours calculées depuis aliments_ciqual.
CREATE TABLE IF NOT EXISTS public.recette_ingredients (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recette_id    TEXT NOT NULL REFERENCES public.recettes(id) ON DELETE CASCADE,
  ordre         INTEGER NOT NULL DEFAULT 0,
  libelle       TEXT NOT NULL,                    -- affichage : « filet de poulet »
  ciqual_code   TEXT REFERENCES public.aliments_ciqual(code),
  grammes       NUMERIC NOT NULL CHECK (grammes > 0),
  exclusions    TEXT[] NOT NULL DEFAULT '{}',     -- clés de la liste des goûts (ex. 'viandes:volaille')
  optionnel     BOOLEAN NOT NULL DEFAULT false,
  substituts    JSONB NOT NULL DEFAULT '[]'::jsonb -- [{ libelle, ciqual_code, exclusions }]
);
CREATE INDEX IF NOT EXISTS idx_recette_ingredients_recette ON public.recette_ingredients (recette_id);

ALTER TABLE public.recettes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recette_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recettes_lecture ON public.recettes;
DROP POLICY IF EXISTS recette_ingredients_lecture ON public.recette_ingredients;
CREATE POLICY recettes_lecture ON public.recettes FOR SELECT TO authenticated USING (true);
CREATE POLICY recette_ingredients_lecture ON public.recette_ingredients FOR SELECT TO authenticated USING (true);

-- ── 2. Menus de la semaine ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menus (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  semaine_debut   DATE NOT NULL,                  -- lundi
  statut          TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'fige')),
  petit_dejeuner  BOOLEAN NOT NULL DEFAULT false, -- petits déjeuners prévus dans le menu
  collation       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, semaine_debut)
);
DROP TRIGGER IF EXISTS trg_menus_updated_at ON public.menus;
CREATE TRIGGER trg_menus_updated_at BEFORE UPDATE ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public.maj_updated_at();

CREATE TABLE IF NOT EXISTS public.menu_repas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  menu_id       UUID NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  type_repas    TEXT NOT NULL CHECK (type_repas IN ('petit_dejeuner', 'dejeuner', 'diner', 'collation')),
  recette_id    TEXT REFERENCES public.recettes(id) ON DELETE SET NULL,  -- null = repas dehors / sans recette
  propositions  TEXT[] NOT NULL DEFAULT '{}',     -- choix proposés pendant la préparation
  nb_personnes  INTEGER NOT NULL DEFAULT 2 CHECK (nb_personnes BETWEEN 1 AND 8),
  mange         BOOLEAN NOT NULL DEFAULT false,   -- ajouté au journal
  UNIQUE (menu_id, date, type_repas)
);
CREATE INDEX IF NOT EXISTS idx_menu_repas_menu ON public.menu_repas (menu_id);

-- ── 3. Liste de courses ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  menu_id       UUID NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  cle           TEXT,                             -- code Ciqual (ou null pour un ajout manuel)
  libelle       TEXT NOT NULL,
  quantite_g    NUMERIC,
  rayon         TEXT NOT NULL DEFAULT 'Autres',
  coche         BOOLEAN NOT NULL DEFAULT false,
  manuel        BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_courses_menu ON public.courses (menu_id);

-- ── 4. RLS : chaque utilisateur ne voit que ses lignes ───────
ALTER TABLE public.menus      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_repas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menus_proprietaire ON public.menus;
DROP POLICY IF EXISTS menu_repas_proprietaire ON public.menu_repas;
DROP POLICY IF EXISTS courses_proprietaire ON public.courses;
CREATE POLICY menus_proprietaire ON public.menus FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY menu_repas_proprietaire ON public.menu_repas FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY courses_proprietaire ON public.courses FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── 5. Vérification : doit renvoyer 0 ligne ──────────────────
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
