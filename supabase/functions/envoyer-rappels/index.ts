// ─────────────────────────────────────────────────────────────
// Edge Function : envoi des rappels (Web Push)
//
// Deux usages :
// 1. Appelée toutes les 15 minutes par pg_cron (en-tête x-cron-secret) :
//    envoie les rappels dont l'heure vient de passer, une seule fois par jour,
//    et seulement s'ils sont utiles (ex. pas de rappel de bilan s'il est déjà fait).
// 2. Appelée depuis l'app avec { "test": true } et le jeton de l'utilisatrice connectée :
//    envoie une notification de test à ses appareils.
//
// Secrets nécessaires (Project Settings → Edge Functions → Secrets) :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.
// La vérification JWT de Supabase est désactivée pour cette fonction :
// l'accès est contrôlé ici (secret du cron ou session valide).
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "https://gianlucareta.github.io/suivi-sante/",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...ENTETES_CORS, "Content-Type": "application/json" } });

type Rappel = { actif: boolean; heure: string; jour?: number };
type Profil = { user_id: string; prenom: string | null; fuseau: string; rappels: Record<string, Rappel> };

const MESSAGES: Record<string, { titre: string; corps: string; page: string }> = {
  bilan:  { titre: "Bilan du soir 🌙", corps: "Une petite minute pour faire le point sur ta journée ?", page: "suivi" },
  seance: { titre: "Séance du jour 💪", corps: "Ta séance t'attend : 20 à 30 minutes pour toi.", page: "sport" },
  pesee:  { titre: "Pesée de la semaine ⚖️", corps: "Le matin, à jeun : c'est le bon moment pour ta pesée.", page: "suivi" },
  photo:  { titre: "Photo de ton assiette 📷", corps: "Pense à prendre ton repas en photo, si tu en as envie.", page: "journal" },
  menu:   { titre: "Menu de la semaine 🗓️", corps: "Prépare tes menus de la semaine prochaine : la liste de courses suivra.", page: "menus" },
};

// Date, jour de la semaine (1 = lundi) et minute de la journée dans le fuseau de l'utilisatrice
function maintenantLocal(fuseau: string) {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const jours: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${parties.year}-${parties.month}-${parties.day}`,
    jour: jours[parties.weekday],
    minute: (Number(parties.hour) % 24) * 60 + Number(parties.minute),
  };
}

function decaler(dateIso: string, jours: number) {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

// Le rappel est-il utile aujourd'hui ? (évite les rappels pour rien)
async function rappelUtile(db: ReturnType<typeof createClient>, type: string, userId: string, date: string, jour: number) {
  const compter = async (table: string, filtre: (q: any) => any) => {
    const { count, error } = await filtre(db.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId));
    if (error) throw error;
    return count ?? 0;
  };
  if (type === "bilan") return (await compter("bilans", (q) => q.eq("date", date))) === 0;
  if (type === "seance") return (await compter("seances", (q) => q.eq("date_prevue", date).eq("statut", "prevue"))) > 0;
  if (type === "pesee") return (await compter("pesees", (q) => q.gte("date", decaler(date, -5)))) === 0;
  if (type === "photo") return (await compter("photos_repas", (q) => q.eq("date", date))) === 0;
  if (type === "menu") {
    const lundiProchain = decaler(date, 8 - jour);
    return (await compter("menus", (q) => q.eq("semaine_debut", lundiProchain))) === 0;
  }
  return false;
}

async function envoyer(db: ReturnType<typeof createClient>, userId: string, message: { titre: string; corps: string; page: string }) {
  const { data: abonnements } = await db.from("abonnements_push").select("*").eq("user_id", userId);
  let envoyes = 0;
  for (const a of abonnements ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
        JSON.stringify(message),
        { TTL: 3600 },
      );
      envoyes++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Abonnement expiré ou révoqué : on le supprime
      if (code === 404 || code === 410) await db.from("abonnements_push").delete().eq("id", a.id);
      else console.error("Envoi impossible", code, (e as Error).message);
    }
  }
  return envoyes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES_CORS });
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const corps = await req.json().catch(() => ({}));

  // ── Notification de test, demandée depuis l'app ─────────────
  if (corps?.test) {
    const jeton = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data, error } = await db.auth.getUser(jeton);
    if (error || !data?.user) return repondre({ error: "Session invalide" }, 401);
    const n = await envoyer(db, data.user.id, { titre: "Ça marche ! 🎉", corps: "Les rappels de Suivi santé arriveront ici.", page: "reglages" });
    return repondre({ envoyes: n });
  }

  // ── Rappels programmés (pg_cron) ─────────────────────────────
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return repondre({ error: "Accès refusé" }, 401);

  const { data: profils, error } = await db.from("profils").select("user_id, prenom, fuseau, rappels").eq("onboarding_fait", true);
  if (error) return repondre({ error: error.message }, 500);

  const resultats: string[] = [];
  for (const p of (profils ?? []) as Profil[]) {
    const ici = maintenantLocal(p.fuseau || "Europe/Paris");
    for (const [type, r] of Object.entries(p.rappels ?? {})) {
      if (!r?.actif || !MESSAGES[type]) continue;
      if ((type === "pesee" || type === "menu") && r.jour && r.jour !== ici.jour) continue;
      const [h, m] = (r.heure || "00:00").split(":").map(Number);
      const minuteRappel = h * 60 + m;
      // Le cron passe toutes les 15 minutes : on envoie si l'heure est passée depuis moins de 15 minutes
      if (ici.minute < minuteRappel || ici.minute >= minuteRappel + 15) continue;
      try {
        if (!(await rappelUtile(db, type, p.user_id, ici.date, ici.jour))) continue;
        // Une seule fois par jour et par type (contrainte unique)
        const { error: e } = await db.from("rappels_envoyes").insert({ user_id: p.user_id, type, date: ici.date });
        if (e) continue;
        const n = await envoyer(db, p.user_id, MESSAGES[type]);
        resultats.push(`${type}: ${n}`);
      } catch (e) {
        console.error(type, (e as Error).message);
      }
    }
  }
  return repondre({ ok: true, envois: resultats });
});
