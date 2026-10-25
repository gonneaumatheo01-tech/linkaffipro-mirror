/**
 * Phase 34, lot D — cœurs de « Ce qui marche » (`/agents/algo`, phase 21) : Appliquer / Annuler / Refuser une
 * proposition (petits réglages pour tous, persona et quotas pour les administrateurs ; le moteur revérifie les bornes),
 * « Rapport maintenant » et réglages de l'équipe Algorithme (administrateurs).
 */
import { applyRecommendation, rejectRecommendation, runAlgoReportNow, undoRecommendation } from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import {
  ACTION_WORDS,
  actionsFor,
  canActOnRecommendation,
  genericRecommendationRefusal,
  type RecommendationAction,
} from "@/lib/agents/algo/recommendations";
import { saveAlgoSettings } from "@/lib/agents/algo/save";
import { parseAlgoSettingsForm } from "@/lib/agents/algo/settings";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, str, uid, type CoreRun, type Fail } from "./kit";

function parseAction(v: unknown): RecommendationAction | null {
  return v === "apply" || v === "undo" || v === "reject" ? v : null;
}

const ACTION_PREVIEW: Record<RecommendationAction, string> = {
  apply: "Appliquer la proposition (valeur d'avant gardée pour pouvoir annuler).",
  undo: "Annuler la proposition : la valeur d'avant est remise.",
  reject: "Refuser la proposition : rien ne change.",
};

/** Appliquer / Annuler / Refuser une proposition de l'équipe Algorithme. */
export const runRecommendation: CoreRun = async (fd, actor, opts = {}) => {
  const action = parseAction(fd.get("action"));
  const id = str(fd.get("id"));
  if (!action || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("Proposition inconnue.");
  const rec = await prisma.recommendation.findUnique({
    where: { id },
    select: { id: true, status: true, size: true, target: true, field: true, source: true },
  });
  if (!rec) return fail("Proposition introuvable.", "not_found");
  const inspiration = genericRecommendationRefusal(rec);
  if (inspiration) return fail(inspiration, "conflict");
  if (!actionsFor(rec.status).includes(action)) return fail("Cette proposition a déjà changé d'état : rechargez la page.", "conflict");
  if (!canActOnRecommendation(actor.role, rec))
    return forbidden("Les réglages de persona et les quotas sont réservés aux administrateurs.");
  if (opts.dryRun) return preview(ACTION_PREVIEW[action]);
  let result: { ok: boolean; message: string };
  try {
    const deps = buildAgentsDeps();
    const who = engineActor(actor);
    result =
      action === "apply"
        ? await applyRecommendation(deps, id, who)
        : action === "undo"
          ? await undoRecommendation(deps, id, who)
          : await rejectRecommendation(deps, id, who);
    await audit({
      userId: actor.userId,
      action: `agents.algo_recommendation_${action}_requested`,
      entityType: "Recommendation",
      entityId: id,
      metadata: { target: rec.target, field: rec.field, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!result.ok) return fail(result.message || "Refusé par l'équipe Algorithme.", "conflict");
  return ok(result.message || ACTION_WORDS[action].done);
};

/** « Rapport maintenant » (ADMIN) : recalcule fiches, horaires, conversations et synthèse, puis envoie le rapport. */
export const runAlgoReport: CoreRun = async (_fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden("Le rapport immédiat est réservé aux administrateurs.");
  if (opts.dryRun) return preview("Rapport de l'équipe Algorithme recalculé maintenant, envoyé sur Telegram.");
  let message = "";
  try {
    const r = await runAlgoReportNow(buildAgentsDeps(), { send: true });
    await audit({
      userId: actor.userId,
      action: "agents.algo_report_requested",
      entityType: "InsightReport",
      metadata: { ok: r.ok, reports: r.reportIds.length, via: actor.via },
    });
    if (!r.ok) return fail(r.message || "Rapport impossible pour l'instant.", "unavailable");
    message = r.message;
  } catch (err) {
    return fail(`Rapport impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(message || "Rapport lancé : il arrive sur Telegram et dans « Rapports de la semaine ».");
};

/** Réglages de l'équipe Algorithme (ADMIN) : seuils, bornes, fréquence. */
export const runSaveAlgoSettings: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden("Les réglages de l'équipe Algorithme sont réservés aux administrateurs.");
  const parsed = parseAlgoSettingsForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  const d = parsed.data;
  if (opts.dryRun)
    return preview(
      `Algorithme : ${d.minPosts} posts ou ${d.minViews} vues par cas, ${d.minConversations} conversations, ${d.maxMixPointsPerWeek} points de mélange par semaine, ${d.maxPostsPerDay} posts par jour au plus, de ${d.allowedStart} à ${d.allowedEnd}, ${d.frequency === "weekly" ? "chaque semaine" : "toutes les deux semaines"}.`,
    );
  try {
    await saveAlgoSettings(d, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Réglages de l'équipe Algorithme enregistrés : ils comptent dès son prochain calcul.");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

const ACTION_ALIASES: Record<string, RecommendationAction> = {
  apply: "apply",
  appliquer: "apply",
  applique: "apply",
  undo: "undo",
  annuler: "undo",
  annule: "undo",
  reject: "reject",
  refuser: "reject",
  refuse: "reject",
};

export function kevinRecommendationForm(input: In): Prepared {
  const action = ACTION_ALIASES[str(input.action).trim().toLowerCase()];
  return { ok: true, fd: formOf({ action: action ?? str(input.action), id: input.id ?? input.proposition }) };
}

/** Réglages Algorithme par Kevin : valeurs actuelles gardées pour ce qu'il ne donne pas. */
export async function kevinAlgoSettingsForm(input: In): Promise<Prepared> {
  const { parseAlgoSettings } = await import("@/lib/agents/algo/settings");
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" }, select: { settings: true } });
  const cur = parseAlgoSettings(row?.settings);
  const form: In = { ...cur };
  for (const k of Object.keys(cur)) if (input[k] !== undefined && input[k] !== null) form[k] = input[k];
  return { ok: true, fd: formOf(form) };
}
