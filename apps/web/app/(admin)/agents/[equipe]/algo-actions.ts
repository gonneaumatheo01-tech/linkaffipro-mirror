"use server";

import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/agents/redirect";
import { runAlgoReport, runRecommendation, runSaveAlgoSettings } from "@/lib/site-ops/ops/lot-d/algo";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page « Ce qui marche » (`/agents/algo`, phase 21) et de l'encart de la fiche persona.
 * Appliquer / Annuler / Refuser : petits réglages pour tous, persona et quotas pour les administrateurs ; le moteur
 * revérifie les bornes au moment d'appliquer et journalise la valeur avant / après. « Rapport maintenant » et réglages
 * de l'équipe : administrateurs.
 */

const ALGO = "/agents/algo";

/** Retour : la page « Ce qui marche » (avec ses filtres) ou la fiche d'une persona. */
function returnPath(fd: FormData): string {
  const v = fd.get("from");
  if (typeof v !== "string") return ALGO;
  if (/^\/conversations\/personas\/[A-Za-z0-9_-]{1,64}$/.test(v)) return v;
  if (/^\/agents\/algo(\?[A-Za-z0-9_=&%.-]*)?$/.test(v)) return v;
  // Phase 25 : « Annuler » depuis le tableau de bord des agents.
  if (v === "/agents") return v;
  return ALGO;
}

function go(path: string, params: Record<string, string>, hash: string): never {
  const [base, query] = path.split("?");
  const q = new URLSearchParams(query ?? "");
  q.delete("ok");
  q.delete("error");
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  backTo(base ?? ALGO, Object.fromEntries(q.entries()), hash);
}

export async function recommendationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const hash = path.startsWith("/conversations")
    ? "#propositions-algorithme"
    : path === "/agents"
      ? "#reglages-appliques"
      : "#recommandations";
  // Cœur unique (phase 34) : mêmes contrôles et même journal que Kevin (`agents.algo_proposition`).
  const r = await runRecommendation(formData, siteActor(user));
  if (r.ok || r.code === "conflict") {
    revalidatePath(ALGO);
    if (path !== ALGO) revalidatePath(path.split("?")[0] ?? ALGO);
  }
  go(path, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

/** « Rapport maintenant » (ADMIN) : recalcule fiches, horaires, conversations et synthèse, puis envoie le rapport. */
export async function runAlgoReportNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const r = await runAlgoReport(formData, siteActor(user));
  if (r.ok) revalidatePath(ALGO);
  go(path, r.ok ? { ok: r.message } : { error: r.error }, "#rapports");
}

/** Réglages de l'équipe Algorithme (ADMIN) : seuils, bornes, fréquence. */
export async function saveAlgoSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const r = await runSaveAlgoSettings(formData, siteActor(user));
  if (r.ok) revalidatePath(ALGO);
  go(path, r.ok ? { ok: r.message } : { error: r.error }, "#reglages-algo");
}
