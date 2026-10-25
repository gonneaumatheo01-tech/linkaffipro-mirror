"use server";

import { revalidatePath } from "next/cache";
import { ADS_PATH } from "@/lib/agents/ads/display";
import { backTo } from "@/lib/agents/redirect";
import { runMarkAdsRecommendation, runSaveAdsAlertSettings, runSaveAdsThresholds } from "@/lib/site-ops/ops/lot-d/ads";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agent Ads (`/agents/ads`, phase 24).
 * - « Fait » / « Refuser » (avec commentaire) : managers compris. Le client dit ce qu'il a fait lui-même chez Meta ou
 *   TikTok : rien n'est jamais changé sur les plateformes (le moteur n'a aucune fonction d'écriture). Le moteur
 *   (`markAdsRecommendation`) écrit l'état et l'`AuditLog`.
 * - Seuils par univers et réglages des alertes (`agents.ads.alerts`) : administrateurs, `AuditLog` avant / après.
 */

/** Retour : la page avec ses filtres (période, campagne). */
function returnPath(fd: FormData): string {
  const v = fd.get("from");
  if (typeof v === "string" && /^\/agents\/ads(\?[A-Za-z0-9_=&%.-]*)?$/.test(v)) return v;
  return ADS_PATH;
}

function go(path: string, params: Record<string, string>, hash: string): never {
  const [base, query] = path.split("?");
  const q = new URLSearchParams(query ?? "");
  q.delete("ok");
  q.delete("error");
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  backTo(base ?? ADS_PATH, Object.fromEntries(q.entries()), hash);
}

export async function markAdsRecommendationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const r = await runMarkAdsRecommendation(formData, siteActor(user));
  if (r.ok || r.code === "conflict") revalidatePath(ADS_PATH);
  go(path, r.ok ? { ok: r.message } : { error: r.error }, "#recommandations");
}

/** Seuils par univers (ADMIN). */
export async function saveAdsThresholdsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const r = await runSaveAdsThresholds(formData, siteActor(user));
  if (r.ok) revalidatePath(ADS_PATH);
  go(path, r.ok ? { ok: r.message } : { error: r.error }, "#seuils");
}

/** Réglages des alertes de l'Agent Ads (ADMIN) : `Setting` `agents.ads.alerts`. */
export async function saveAdsAlertSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const r = await runSaveAdsAlertSettings(formData, siteActor(user));
  if (r.ok) {
    revalidatePath(ADS_PATH);
    revalidatePath("/settings/alerts");
  }
  go(path, r.ok ? { ok: r.message } : { error: r.error }, "#seuils");
}
