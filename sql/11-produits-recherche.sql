-- ─────────────────────────────────────────────────────────────
-- Produits scannés : recherche sans accents (nom + marque) et date de dernière utilisation
-- À lancer une fois dans Supabase → SQL Editor → Run.
-- Un produit scanné remonte en premier dans la recherche (« céréales kellogg »).
-- Un produit non utilisé depuis 30 jours est supprimé automatiquement par l'app
-- (le journal garde ses valeurs : rien n'est perdu dans l'historique).
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS recherche TEXT;
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS derniere_utilisation TIMESTAMPTZ NOT NULL DEFAULT now();

-- Texte de recherche : nom + marque, en minuscules et sans accents
CREATE OR REPLACE FUNCTION public.produits_recherche() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.recherche := lower(extensions.unaccent(coalesce(NEW.nom, '') || ' ' || coalesce(NEW.marque, '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_produits_recherche ON public.produits;
CREATE TRIGGER trg_produits_recherche BEFORE INSERT OR UPDATE OF nom, marque ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.produits_recherche();

-- Produits déjà enregistrés
UPDATE public.produits SET recherche = lower(extensions.unaccent(coalesce(nom, '') || ' ' || coalesce(marque, '')));

CREATE INDEX IF NOT EXISTS idx_produits_utilisation ON public.produits (user_id, derniere_utilisation DESC);

-- Vérification : nombre de produits scannés et le plus ancien
SELECT count(*) AS produits, min(derniere_utilisation) AS plus_ancien FROM public.produits;
