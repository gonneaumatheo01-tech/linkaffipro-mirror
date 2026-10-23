"use server";

import { revalidatePath } from "next/cache";
import {
  applyRecommendation,
  rejectRecommendation,
  runAlgoReportNow,
  undoRecommendation,
} from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { ACTION_WORDS, actionsFor, canActOnRecommendation, type RecommendationAction } from "@/lib/agents/algo/recommendations";
import { saveAlgoSettings } from "@/lib/agents/algo/save";
import { parseAlgoSettingsForm } from "@/lib/agents/algo/settings";
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

function parseAction(v: unknown): RecommendationAction | null {
  return v === "apply" || v === "undo" || v === "reject" ? v : null;
}

export async function recommendationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const hash = path.startsWith("/conversations") ? "#propositions-algorithme" : "#recommandations";
  const action = parseAction(formData.get("action"));
  const id = String(formData.get("id") ?? "");
  if (!action || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) go(path, { error: "Proposition inconnue." }, hash);
  const rec = await prisma.recommendation.findUnique({
    where: { id },
    select: { id: true, status: true, size: true, target: true, field: true },
  });
  if (!rec) go(path, { error: "Proposition introuvable." }, hash);
  if (!actionsFor(rec.status).includes(action))
    go(path, { error: "Cette proposition a déjà changé d'état : rechargez la page." }, hash);
  if (!canActOnRecommendation(user.role, rec))
    go(path, { error: "Les réglages de persona et les quotas sont réservés aux administrateurs." }, hash);
  const actor = { userId: user.id, via: "SITE" as const };
  let result: { ok: boolean; message: string };
  try {
    const deps = buildAgentsDeps();
    result =
      action === "apply"
        ? await applyRecommendation(deps, id, actor)
        : action === "undo"
          ? await undoRecommendation(deps, id, actor)
          : await rejectRecommendation(deps, id, actor);
    await audit({
      userId: user.id,
      action: `agents.algo_recommendation_${action}_requested`,
      entityType: "Recommendation",
      entityId: id,
      metadata: { target: rec.target, field: rec.field, ok: result.ok },
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    go(path, { error: `Impossible pour l'instant : ${errorText(err)}.` }, hash);
  }
  revalidatePath(ALGO);
  if (path !== ALGO) revalidatePath(path.split("?")[0] ?? ALGO);
  if (!result.ok) go(path, { error: result.message || "Refusé par l'équipe Algorithme." }, hash);
  go(path, { ok: result.message || ACTION_WORDS[action].done }, hash);
}

/** « Rapport maintenant » (ADMIN) : recalcule fiches, horaires, conversations et synthèse, puis envoie le rapport. */
export async function runAlgoReportNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  if (user.role !== "ADMIN") go(path, { error: "Le rapport immédiat est réservé aux administrateurs." }, "#rapports");
  let message = "";
  try {
    const r = await runAlgoReportNow(buildAgentsDeps(), { send: true });
    await audit({
      userId: user.id,
      action: "agents.algo_report_requested",
      entityType: "InsightReport",
      metadata: { ok: r.ok, reports: r.reportIds.length },
    });
    if (!r.ok) go(path, { error: r.message || "Rapport impossible pour l'instant." }, "#rapports");
    message = r.message;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    go(path, { error: `Rapport impossible : ${errorText(err)}.` }, "#rapports");
  }
  revalidatePath(ALGO);
  go(path, { ok: message || "Rapport lancé : il arrive sur Telegram et dans « Rapports de la semaine »." }, "#rapports");
}

/** Réglages de l'équipe Algorithme (ADMIN) : seuils, bornes, fréquence. */
export async function saveAlgoSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  if (user.role !== "ADMIN")
    go(path, { error: "Les réglages de l'équipe Algorithme sont réservés aux administrateurs." }, "#reglages-algo");
  const parsed = parseAlgoSettingsForm(formData);
  if (!parsed.ok) go(path, { error: parsed.error }, "#reglages-algo");
  try {
    await saveAlgoSettings(parsed.data, user.id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    go(path, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#reglages-algo");
  }
  revalidatePath(ALGO);
  go(path, { ok: "Réglages de l'équipe Algorithme enregistrés : ils comptent dès son prochain calcul." }, "#reglages-algo");
}
