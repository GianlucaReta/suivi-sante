-- ─────────────────────────────────────────────────────────────
-- Phase 1 : Socle
-- À exécuter une fois dans Supabase → SQL Editor → New query
-- Le script peut être relancé sans risque (IF NOT EXISTS / OR REPLACE).
-- ─────────────────────────────────────────────────────────────

-- ── 1. Mise à jour automatique de updated_at ─────────────────
CREATE OR REPLACE FUNCTION public.maj_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ── 2. Table profils (une ligne par utilisateur) ─────────────
-- Les champs du questionnaire sont ajoutés en phase 2 (sql/02-profil.sql).
CREATE TABLE IF NOT EXISTS public.profils (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prenom          TEXT,
  onboarding_fait BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profils_updated_at ON public.profils;
CREATE TRIGGER trg_profils_updated_at
  BEFORE UPDATE ON public.profils
  FOR EACH ROW EXECUTE FUNCTION public.maj_updated_at();

-- ── 3. RLS : chacun ne voit et ne modifie que sa ligne ───────
ALTER TABLE public.profils ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profils_select ON public.profils;
DROP POLICY IF EXISTS profils_insert ON public.profils;
DROP POLICY IF EXISTS profils_update ON public.profils;

CREATE POLICY profils_select ON public.profils
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY profils_insert ON public.profils
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY profils_update ON public.profils
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
-- Pas de DELETE : le profil disparaît avec le compte (ON DELETE CASCADE).

-- ── 4. Création automatique du profil à la création d'un compte ─
CREATE OR REPLACE FUNCTION public.creer_profil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profils (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_creer_profil ON auth.users;
CREATE TRIGGER trg_creer_profil
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.creer_profil();

-- Pour les comptes créés avant ce script :
INSERT INTO public.profils (user_id)
  SELECT id FROM auth.users ON CONFLICT DO NOTHING;

-- ── 5. Bucket privé pour les photos de repas ─────────────────
-- 512 Ko max par fichier (les photos compressées font ~150 Ko).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos-repas', 'photos-repas', false, 524288, ARRAY['image/webp', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 524288, allowed_mime_types = ARRAY['image/webp', 'image/jpeg'];

-- Chaque fichier est rangé dans un dossier au nom de l'utilisateur : {user_id}/…
DROP POLICY IF EXISTS photos_select ON storage.objects;
DROP POLICY IF EXISTS photos_insert ON storage.objects;
DROP POLICY IF EXISTS photos_update ON storage.objects;
DROP POLICY IF EXISTS photos_delete ON storage.objects;

CREATE POLICY photos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos-repas' AND (storage.foldername(name))[1] = (select auth.uid())::text);
CREATE POLICY photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos-repas' AND (storage.foldername(name))[1] = (select auth.uid())::text);
CREATE POLICY photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'photos-repas' AND (storage.foldername(name))[1] = (select auth.uid())::text);
CREATE POLICY photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos-repas' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 6. Vérification : toutes les tables public ont la RLS ────
-- Doit renvoyer 0 ligne.
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
