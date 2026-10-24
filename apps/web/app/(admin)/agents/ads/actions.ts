"use server";

import { revalidatePath } from "next/cache";
import { markAdsRecommendation } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { ADS_PATH, MARK_WORDS, canMarkRecommendation, cleanComment } from "@/lib/agents/ads/display";
import { saveAdsThresholds } from "@/lib/agents/ads/save";
import { parseAdsThresholdsForm } from "@/lib/agents/ads/thresholds";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agent Ads (`/agents/ads`, phase 24).
 * - « Fait » / « Refuser » (avec commentaire) : managers compris. Le client dit ce qu'il a fait lui-même chez Meta ou
 *   TikTok : rien n'est jamais changé sur les plateformes (le moteur n'a aucune fonction d'écriture). Le moteur
 *   (`markAdsRecommendation`) écrit l'état et l'`AuditLog`.
 * - Seuils par univers : administrateurs, `AuditLog` avant / après.
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
  const hash = "#recommandations";
  const status = formData.get("status");
  const id = String(formData.get("id") ?? "");
  if ((status !== "DONE" && status !== "REJECTED") || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
    go(path, { error: "Recommandation inconnue." }, hash);
  const rec = await prisma.recommendation.findUnique({ where: { id }, select: { teamKey: true, status: true } });
  if (!rec || rec.teamKey !== "ads") go(path, { error: "Recommandation introuvable." }, hash);
  if (!canMarkRecommendation(rec.status))
    go(path, { error: "Cette recommandation a déjà changé d'état : rechargez la page." }, hash);
  let result: { ok: boolean; message: string };
  try {
    result = await markAdsRecommendation(
      buildAgentsDeps(),
      { id, status, comment: cleanComment(formData.get("comment")) },
      { userId: user.id, via: "SITE" },
    );
  } catch (err) {
    if (isRedirectError(err)) throw err;
    go(path, { error: `Impossible pour l'instant : ${errorText(err)}.` }, hash);
  }
  revalidatePath(ADS_PATH);
  if (!result.ok) go(path, { error: result.message || "Refusé par l'Agent Ads." }, hash);
  go(path, { ok: result.message || MARK_WORDS[status].done }, hash);
}

/** Seuils par univers (ADMIN). */
export async function saveAdsThresholdsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const hash = "#seuils";
  if (user.role !== "ADMIN") go(path, { error: "Les seuils de l'Agent Ads sont réservés aux administrateurs." }, hash);
  const parsed = parseAdsThresholdsForm(formData);
  if (!parsed.ok) go(path, { error: parsed.error }, hash);
  try {
    await saveAdsThresholds(parsed.data, user.id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    go(path, { error: `Enregistrement impossible : ${errorText(err)}.` }, hash);
  }
  revalidatePath(ADS_PATH);
  go(path, { ok: "Seuils enregistrés : ils comptent dès le prochain passage de l'Agent Ads." }, hash);
}
