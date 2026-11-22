-- ─────────────────────────────────────────────────────────────
-- Phase 8 (suite) : planification des rappels avec pg_cron
-- À exécuter APRÈS avoir déployé l'Edge Function envoyer-rappels (voir README).
--
-- ⚠️ Avant de lancer : remplace COLLE-ICI-LE-CRON-SECRET (plus bas) par la même
-- valeur que le secret CRON_SECRET de l'Edge Function, directement dans le SQL Editor.
-- Ne l'enregistre jamais dans ce fichier : le secret est stocké chiffré dans le Vault.
-- ─────────────────────────────────────────────────────────────

-- Extensions : pg_cron (tâches planifiées) et pg_net (appels HTTP depuis la base)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Secret partagé avec l'Edge Function, stocké chiffré dans le Vault
DO $$
BEGIN
  PERFORM vault.create_secret('COLLE-ICI-LE-CRON-SECRET', 'cron_secret_rappels', 'Secret de l''appel pg_cron vers envoyer-rappels');
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Le secret existe déjà : pour le changer, utilise vault.update_secret.';
END $$;

-- Tâche toutes les 15 minutes (remplacée si elle existe déjà)
SELECT cron.unschedule('rappels-push') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rappels-push');
SELECT cron.schedule(
  'rappels-push',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://uwzsqkvzshrnxvpdjelo.supabase.co/functions/v1/envoyer-rappels',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_rappels')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Vérification : la tâche doit apparaître
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'rappels-push';
