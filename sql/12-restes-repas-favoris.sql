-- ─────────────────────────────────────────────────────────────
-- Restes du dîner pour le lendemain midi, et repas favoris
-- À lancer une fois dans Supabase → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────

-- 1. Menus : un déjeuner peut être « les restes du dîner de la veille »
ALTER TABLE public.menu_repas ADD COLUMN IF NOT EXISTS restes BOOLEAN NOT NULL DEFAULT false;

-- 2. Repas favoris : un repas habituel (ex. céréales + lait + kiwi) noté en un geste, modifiable
CREATE TABLE IF NOT EXISTS public.repas_favoris (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  nom                  TEXT NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 80),
  type_repas           TEXT CHECK (type_repas IN ('petit_dejeuner', 'dejeuner', 'diner', 'collation')),
  -- Aliments du repas, avec leurs valeurs pour la quantité enregistrée :
  -- [{ source, ref, nom, quantite_g, repere, kcal, proteines, glucides, sucres, sucres_ajoutes, lipides, fibres }]
  elements             JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(elements) = 'array'),
  derniere_utilisation TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repas_favoris_user ON public.repas_favoris (user_id, derniere_utilisation DESC);

ALTER TABLE public.repas_favoris ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repas_favoris_proprietaire ON public.repas_favoris;
CREATE POLICY repas_favoris_proprietaire ON public.repas_favoris FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- Vérification : doit renvoyer 0 ligne
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
