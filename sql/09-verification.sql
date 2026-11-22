-- ─────────────────────────────────────────────────────────────
-- Phase 9 : vérification (lecture seule : ne modifie aucune donnée)
-- À lancer dans Supabase → SQL Editor → Run, quand tu veux contrôler
-- la sécurité et l'espace utilisé. Une seule ligne de résultat par contrôle.
-- ─────────────────────────────────────────────────────────────

-- État de la tâche planifiée (pg_cron peut ne pas être encore installé : on vérifie d'abord)
CREATE OR REPLACE FUNCTION pg_temp.etat_cron() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN 'pas encore créée (sql/08b)'; END IF;
  EXECUTE $q$SELECT CASE WHEN active THEN '✓ active (' || schedule || ')' ELSE '✗ inactive' END FROM cron.job WHERE jobname = 'rappels-push'$q$ INTO r;
  RETURN coalesce(r, 'pas encore créée (sql/08b)');
END $$;

WITH
tables_public AS (
  SELECT c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
-- Tables personnelles (avec user_id) dont une politique n'est pas limitée au propriétaire
politiques_ouvertes AS (
  SELECT p.tablename, p.policyname
  FROM pg_policies p
  JOIN information_schema.columns col ON col.table_schema = 'public' AND col.table_name = p.tablename AND col.column_name = 'user_id'
  WHERE p.schemaname = 'public'
    AND coalesce(p.qual, '') NOT LIKE '%auth.uid()%'
    AND coalesce(p.with_check, '') NOT LIKE '%auth.uid()%'
),
-- Tables de référence : lecture seule (aucune politique d'écriture)
ecriture_reference AS (
  SELECT tablename, policyname FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('aliments_ciqual', 'recettes', 'recette_ingredients', 'exercices')
    AND cmd <> 'SELECT'
),
-- Politiques ouvertes au rôle anon (aucune ne devrait exister)
politiques_anon AS (
  SELECT schemaname, tablename, policyname FROM pg_policies
  WHERE 'anon' = ANY (roles) OR 'public' = ANY (roles)
),
photos AS (
  SELECT count(*) AS nb, coalesce(sum((metadata->>'size')::bigint), 0) AS octets
  FROM storage.objects WHERE bucket_id = 'photos-repas'
)
SELECT 'Tables sans RLS (doit être vide)' AS controle,
       coalesce(string_agg(relname, ', '), '✓ aucune') AS resultat
  FROM tables_public WHERE NOT relrowsecurity
UNION ALL
SELECT 'Politiques non limitées au propriétaire (doit être vide)',
       coalesce(string_agg(tablename || '.' || policyname, ', '), '✓ aucune') FROM politiques_ouvertes
UNION ALL
SELECT 'Écriture possible sur les tables de référence (doit être vide)',
       coalesce(string_agg(tablename || '.' || policyname, ', '), '✓ aucune') FROM ecriture_reference
UNION ALL
SELECT 'Politiques ouvertes aux visiteurs non connectés (doit être vide)',
       coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname, ', '), '✓ aucune') FROM politiques_anon
UNION ALL
SELECT 'Bucket photos-repas privé',
       CASE WHEN (SELECT public FROM storage.buckets WHERE id = 'photos-repas') THEN '✗ PUBLIC : à corriger' ELSE '✓ privé' END
UNION ALL
SELECT 'Comptes utilisateurs', (SELECT count(*)::text FROM auth.users)
UNION ALL
SELECT 'Taille de la base (limite gratuite : 500 Mo)', pg_size_pretty(pg_database_size(current_database()))
UNION ALL
SELECT 'Photos (limite gratuite : 1 Go, partagée entre les projets)', nb || ' photos · ' || pg_size_pretty(octets) FROM photos
UNION ALL
SELECT 'Plus grosses tables', (
  SELECT string_agg(relname || ' ' || pg_size_pretty(pg_total_relation_size(c.oid)), ', ' ORDER BY pg_total_relation_size(c.oid) DESC)
  FROM (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5) c)
UNION ALL
SELECT 'Tâche planifiée des rappels', pg_temp.etat_cron()
UNION ALL
SELECT 'Derniers rappels envoyés', coalesce((SELECT string_agg(type || ' le ' || to_char(envoye_le AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI'), ', ') FROM (SELECT * FROM public.rappels_envoyes ORDER BY envoye_le DESC LIMIT 5) r), 'aucun pour l''instant');
