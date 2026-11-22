-- ─────────────────────────────────────────────────────────────
-- Recettes favorites (le cœur ❤ sur une recette)
-- À lancer une fois dans Supabase → SQL Editor → Run.
-- Une recette favorite revient plus souvent dans les menus proposés.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recettes_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  recette_id  TEXT NOT NULL REFERENCES public.recettes(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recette_id)
);

-- RLS : chaque utilisateur ne voit et ne modifie que ses favoris
ALTER TABLE public.recettes_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recettes_favorites_proprietaire ON public.recettes_favorites;
CREATE POLICY recettes_favorites_proprietaire ON public.recettes_favorites FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- Vérification : doit renvoyer 0 ligne
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
