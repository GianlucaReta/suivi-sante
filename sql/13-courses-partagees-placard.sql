-- ─────────────────────────────────────────────────────────────
-- Liste de courses partagée (lien sans compte) et placard
-- À lancer une fois dans Supabase → SQL Editor → Run.
-- ─────────────────────────────────────────────────────────────

-- 1. Partage : un jeton secret (UUID aléatoire) par menu. Quiconque a le lien
--    peut voir la liste de courses de ce menu et cocher les articles, rien d'autre.
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS partage_jeton UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_menus_partage_jeton ON public.menus (partage_jeton) WHERE partage_jeton IS NOT NULL;

-- Lecture de la liste partagée : uniquement les champs utiles, jamais le reste du compte
CREATE OR REPLACE FUNCTION public.courses_partagees(p_jeton UUID)
RETURNS TABLE (id UUID, libelle TEXT, quantite_g NUMERIC, rayon TEXT, coche BOOLEAN, semaine DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.libelle, c.quantite_g, c.rayon, c.coche, m.semaine_debut
    FROM public.courses c
    JOIN public.menus m ON m.id = c.menu_id
   WHERE p_jeton IS NOT NULL AND m.partage_jeton = p_jeton
   ORDER BY c.rayon, c.libelle;
$$;

-- Cocher / décocher un article de la liste partagée
CREATE OR REPLACE FUNCTION public.cocher_course_partagee(p_jeton UUID, p_id UUID, p_coche BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  IF p_jeton IS NULL THEN RETURN false; END IF;
  UPDATE public.courses c SET coche = coalesce(p_coche, false)
    FROM public.menus m
   WHERE c.id = p_id AND c.menu_id = m.id AND m.partage_jeton = p_jeton;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION public.courses_partagees(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cocher_course_partagee(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.courses_partagees(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cocher_course_partagee(UUID, UUID, BOOLEAN) TO anon, authenticated;

-- 2. Placard : aliments toujours à la maison (riz, huile, épices…), retirés de la liste de courses
--    [{ "cle": "<code Ciqual>", "libelle": "riz" }]
ALTER TABLE public.profils ADD COLUMN IF NOT EXISTS placard JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Vérification
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'partage_jeton') AS colonne_partage,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'profils' AND column_name = 'placard') AS colonne_placard,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('courses_partagees', 'cocher_course_partagee')) AS fonctions;
