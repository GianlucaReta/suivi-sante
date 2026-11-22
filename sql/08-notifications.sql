-- ─────────────────────────────────────────────────────────────
-- Phase 8 : Notifications (Web Push)
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run
-- (sans rien sélectionner). Peut être relancé sans risque.
-- La planification (pg_cron) est dans 08b-planification.sql, à lancer APRÈS
-- le déploiement de l'Edge Function.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Abonnements push (un par appareil) ────────────────────
CREATE TABLE IF NOT EXISTS public.abonnements_push (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  appareil    TEXT,                      -- ex. « iPhone », pour s'y retrouver dans les réglages
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.abonnements_push ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS abonnements_push_proprietaire ON public.abonnements_push;
CREATE POLICY abonnements_push_proprietaire ON public.abonnements_push FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- ── 2. Rappels envoyés (évite d'envoyer deux fois le même rappel) ─
-- Écrite uniquement par l'Edge Function (clé service_role) : aucune politique d'écriture.
CREATE TABLE IF NOT EXISTS public.rappels_envoyes (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  date      DATE NOT NULL,
  envoye_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, date)
);
ALTER TABLE public.rappels_envoyes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rappels_envoyes_lecture ON public.rappels_envoyes;
CREATE POLICY rappels_envoyes_lecture ON public.rappels_envoyes FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- ── 3. Réglages des rappels (dans le profil) ─────────────────
-- jour : 1 = lundi … 7 = dimanche (pour les rappels hebdomadaires)
ALTER TABLE public.profils
  ADD COLUMN IF NOT EXISTS rappels JSONB NOT NULL DEFAULT '{
    "bilan":  { "actif": true,  "heure": "21:30" },
    "seance": { "actif": true,  "heure": "18:00" },
    "pesee":  { "actif": true,  "heure": "08:30", "jour": 7 },
    "photo":  { "actif": false, "heure": "13:15" },
    "menu":   { "actif": true,  "heure": "18:30", "jour": 7 }
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS fuseau TEXT NOT NULL DEFAULT 'Europe/Paris';

-- ── 4. Vérification : doit renvoyer 0 ligne ──────────────────
SELECT relname AS table_sans_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
