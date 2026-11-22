-- ─────────────────────────────────────────────────────────────
-- Phase 3 : Aliments, produits scannés, journal, photos
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- Peut être relancé sans risque.
-- ─────────────────────────────────────────────────────────────

-- Recherche rapide par morceau de mot (ILIKE '%pomm%')
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ── 1. Table Ciqual (référence partagée, lecture seule) ──────
-- Remplie une seule fois par import CSV (voir README, « Importer Ciqual »).
CREATE TABLE IF NOT EXISTS public.aliments_ciqual (
  code          TEXT PRIMARY KEY,           -- alim_code Ciqual
  nom           TEXT NOT NULL,              -- alim_nom_fr
  nom_recherche TEXT NOT NULL,              -- nom sans accents, en minuscules
  groupe        TEXT,
  sous_groupe   TEXT,
  rayon         TEXT,                       -- rayon de supermarché (liste de courses)
  categorie     TEXT,                       -- pour les repères visuels : viande_poisson, feculent, legume, fruit, matiere_grasse, laitier, boisson, sucre, autre
  sucre_ajoute  BOOLEAN NOT NULL DEFAULT false, -- les sucres de cet aliment comptent comme sucres ajoutés
  kcal          NUMERIC,                    -- valeurs pour 100 g
  proteines     NUMERIC,
  glucides      NUMERIC,
  sucres        NUMERIC,
  lipides       NUMERIC,
  fibres        NUMERIC,
  sel           NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_ciqual_recherche ON public.aliments_ciqual USING gin (nom_recherche extensions.gin_trgm_ops);

ALTER TABLE public.aliments_ciqual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ciqual_lecture ON public.aliments_ciqual;
CREATE POLICY ciqual_lecture ON public.aliments_ciqual FOR SELECT TO authenticated USING (true);
-- Aucune politique d'écriture : seul l'import depuis le dashboard peut écrire.

-- ── 2. Produits du commerce (cache Open Food Facts, corrigeable) ─
CREATE TABLE IF NOT EXISTS public.produits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  code_barres   TEXT NOT NULL,
  nom           TEXT NOT NULL,
  marque        TEXT,
  portion_g     NUMERIC,                    -- taille d'une portion (ex. 1 biscuit = 12 g)
  portion_libelle TEXT,
  categorie     TEXT NOT NULL DEFAULT 'autre',
  sucre_ajoute  BOOLEAN NOT NULL DEFAULT false,
  kcal          NUMERIC,
  proteines     NUMERIC,
  glucides      NUMERIC,
  sucres        NUMERIC,
  lipides       NUMERIC,
  fibres        NUMERIC,
  sel           NUMERIC,
  source        TEXT NOT NULL DEFAULT 'openfoodfacts' CHECK (source IN ('openfoodfacts', 'manuel')),
  corrige       BOOLEAN NOT NULL DEFAULT false,  -- valeurs corrigées à la main
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_barres)
);
DROP TRIGGER IF EXISTS trg_produits_updated_at ON public.produits;
CREATE TRIGGER trg_produits_updated_at BEFORE UPDATE ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.maj_updated_at();

-- ── 3. Journal alimentaire ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date          DATE NOT NULL,
  heure         TIME NOT NULL,              -- heure de saisie, modifiable
  type_repas    TEXT NOT NULL CHECK (type_repas IN ('petit_dejeuner', 'dejeuner', 'diner', 'collation')),
  source        TEXT NOT NULL CHECK (source IN ('ciqual', 'produit', 'recette', 'libre')),
  ref           TEXT,                       -- code Ciqual, id produit ou id recette
  nom           TEXT NOT NULL,
  quantite_g    NUMERIC NOT NULL CHECK (quantite_g > 0 AND quantite_g <= 5000),
  repere        TEXT,                       -- ex. '1 poing', '2 c. à soupe' (affichage)
  -- Valeurs calculées pour la quantité, figées au moment de la saisie
  kcal          NUMERIC NOT NULL DEFAULT 0,
  proteines     NUMERIC NOT NULL DEFAULT 0,
  glucides      NUMERIC NOT NULL DEFAULT 0,
  sucres        NUMERIC NOT NULL DEFAULT 0,
  sucres_ajoutes NUMERIC NOT NULL DEFAULT 0,
  lipides       NUMERIC NOT NULL DEFAULT 0,
  fibres        NUMERIC NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_user_date ON public.journal (user_id, date);
DROP TRIGGER IF EXISTS trg_journal_updated_at ON public.journal;
CREATE TRIGGER trg_journal_updated_at BEFORE UPDATE ON public.journal
  FOR EACH ROW EXECUTE FUNCTION public.maj_updated_at();

-- ── 4. Photos des repas (fichiers dans le bucket privé photos-repas) ─
CREATE TABLE IF NOT EXISTS public.photos_repas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  date          DATE NOT NULL,
  type_repas    TEXT NOT NULL CHECK (type_repas IN ('petit_dejeuner', 'dejeuner', 'diner', 'collation')),
  chemin        TEXT NOT NULL UNIQUE,       -- {user_id}/{date}/{id}.webp
  taille_octets INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_user_date ON public.photos_repas (user_id, date);

-- ── 5. RLS : chaque utilisateur ne voit que ses lignes ───────
ALTER TABLE public.produits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos_repas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['produits', 'journal', 'photos_repas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_proprietaire', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)',
      t || '_proprietaire', t);
  END LOOP;
END $$;

-- ── 6. Réglage : suppression automatique des photos de plus de 6 mois ─
ALTER TABLE public.profils
  ADD COLUMN IF NOT EXISTS suppression_auto_photos BOOLEAN NOT NULL DEFAULT false;

-- ── 7. Taille de la base (indicateur dans les réglages) ──────
CREATE OR REPLACE FUNCTION public.taille_base()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_database_size(current_database());
$$;
REVOKE ALL ON FUNCTION public.taille_base() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.taille_base() TO authenticated;

-- ── 8. Vérification : doit renvoyer 0 ligne ──────────────────
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
