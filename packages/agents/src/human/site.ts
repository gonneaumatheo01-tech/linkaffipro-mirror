/**
 * Demandes au client depuis le site (onglet « Demandes » de `/agents/validations`) et balayage périodique
 * (CONTRAT, propriétaire : chantier B). Mêmes règles que par Telegram.
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { agentAudit, agentEvent, nowOf, readSetting } from "../admin/journal";
import { askHuman, confirmButtonsOf, formatQuestion, sendNextHumanRequest, withAskedMessageId } from "./requests";
import { sendRequestFollowUp } from "./delivery";
import { respondToRequest, resumeWaitingMissions, skipRequest, type HumanRequestRow } from "./respond";
import { ADMIN_ONLY_REQUEST_MESSAGE, adminOnlyRequest } from "./access";

export { adminOnlyRequest, ADMIN_ONLY_REQUEST_MESSAGE } from "./access";

/** Rôle de l'utilisateur du site (ADMIN : tout ; MANAGER : pas les demandes réservées, voir `adminOnlyRequest`). */
export type SiteRole = "ADMIN" | "MANAGER" | (string & {});

export type AnswerResult = { ok: boolean; message: string };

export const REMIND_AFTER_MS = 24 * 3600_000;
export const EXPIRE_AFTER_MS = 7 * 24 * 3600_000;
export const DAILY_REPORT_KEY = "agents.dailyReport";
export const DAILY_REPORT_QUESTION =
  "Veux-tu recevoir chaque matin le rapport des agents ? Réponds oui ou non (ou « plus tard »).";

async function findRequest(deps: AgentsDeps, id: string): Promise<HumanRequestRow | null> {
  return (await deps.prisma.humanRequest.findUnique({ where: { id } })) as HumanRequestRow | null;
}

/**
 * Réponse donnée depuis le site (texte, numéro d'option, oui / non, clé). `role` (facultatif, rétrocompatible) : un
 * non-ADMIN ne répond jamais à une demande réservée (`adminOnlyRequest`). Sans rôle : appel interne, permis.
 */
export async function answerHumanRequestFromSite(
  deps: AgentsDeps,
  requestId: string,
  answer: string,
  actor: ActorRef,
  role?: SiteRole,
): Promise<AnswerResult> {
  const request = await findRequest(deps, requestId);
  if (!request) return { ok: false, message: "Demande introuvable." };
  if (role !== undefined && role !== "ADMIN" && adminOnlyRequest(request))
    return { ok: false, message: ADMIN_ONLY_REQUEST_MESSAGE };
  if (request.kind === "MEDIA")
    return { ok: false, message: "Les médias s'envoient au bot sur Telegram, avec les mots-clés demandés." };
  const r = await respondToRequest(deps, request, answer, actor);
  return { ok: r.ok, message: r.message };
}

/**
 * « Plus tard » : la demande est passée, la suivante part. Une demande réservée n'est pas passée par un non-ADMIN : son
 * « plus tard » peut valoir réponse (`onAnswer.skipAnswer`, ex. plafond vidéo à 100 €).
 */
export async function skipHumanRequest(
  deps: AgentsDeps,
  requestId: string,
  actor: ActorRef,
  role?: SiteRole,
): Promise<AnswerResult> {
  const request = await findRequest(deps, requestId);
  if (!request) return { ok: false, message: "Demande introuvable." };
  if (role !== undefined && role !== "ADMIN" && adminOnlyRequest(request))
    return { ok: false, message: ADMIN_ONLY_REQUEST_MESSAGE };
  const r = await skipRequest(deps, request, actor);
  return { ok: r.ok, message: r.message };
}

/** Relance en un clic d'une demande expirée ou passée (remise dans la file). */
export async function relaunchHumanRequest(deps: AgentsDeps, requestId: string, actor: ActorRef): Promise<AnswerResult> {
  const request = await findRequest(deps, requestId);
  if (!request) return { ok: false, message: "Demande introuvable." };
  if (request.status !== "EXPIRED" && request.status !== "SKIPPED")
    return { ok: false, message: "Seule une demande passée ou expirée peut être relancée." };
  const other = await deps.prisma.humanRequest.findFirst({
    where: { key: request.key, status: { in: ["QUEUED", "PENDING"] } },
  });
  if (other) return { ok: false, message: "La même demande est déjà en cours." };
  await deps.prisma.humanRequest.update({
    where: { id: request.id },
    data: {
      status: "QUEUED",
      askedAt: null,
      remindedAt: null,
      answeredAt: null,
      telegramMessageId: null,
      // La file suit `createdAt` : une demande relancée passe après celles déjà en attente.
      createdAt: nowOf(deps),
    },
  });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.request.relaunched",
    entityType: "HumanRequest",
    entityId: request.id,
    metadata: { key: request.key, via: actor.via },
  });
  await sendNextHumanRequest(deps);
  return { ok: true, message: "Demande relancée : elle partira sur Telegram à son tour." };
}

/** Balayage (file `agents-orchestrator`, tâche `human-requests`) : envoi de la suivante, rappel 24 h, expiration 7 jours. */
export async function sweepHumanRequests(deps: AgentsDeps): Promise<{ sent: number; reminded: number; expired: number }> {
  const now = nowOf(deps);
  let expired = 0;
  let reminded = 0;
  const stale = (await deps.prisma.humanRequest.findMany({
    where: { status: "PENDING", askedAt: { lt: new Date(now.getTime() - EXPIRE_AFTER_MS) } },
  })) as HumanRequestRow[];
  for (const request of stale) {
    const done = await deps.prisma.humanRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "EXPIRED", answeredAt: now },
    });
    if (done.count === 0) continue;
    expired++;
    await agentEvent(deps, "agents.request.expired", { requestId: request.id, key: request.key });
    await resumeWaitingMissions(deps, request, { answered: false, summary: null });
  }

  const late = await deps.prisma.humanRequest.findMany({
    where: { status: "PENDING", remindedAt: null, askedAt: { lt: new Date(now.getTime() - REMIND_AFTER_MS) } },
  });
  for (const request of late) {
    if (!deps.admin) break;
    let sent: { messageId: number } | null = null;
    try {
      sent = await sendRequestFollowUp(deps, request, formatQuestion(request, { reminder: true }), {
        replyToMessageId: request.telegramMessageId ?? undefined,
        buttons: confirmButtonsOf(request),
      });
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, requestId: request.id }, "[agents] rappel non envoyé");
    }
    // Un seul rappel, même si l'envoi échoue (jamais de relance en boucle).
    await deps.prisma.humanRequest.update({
      where: { id: request.id },
      data: { remindedAt: now, ...(sent ? withAskedMessageId(request, sent.messageId) : {}) },
    });
    if (sent) {
      reminded++;
      await agentEvent(deps, "agents.request.reminded", { requestId: request.id, key: request.key });
    }
  }

  const sentId = await sendNextHumanRequest(deps);
  return { sent: sentId ? 1 : 0, reminded, expired };
}

/** Crée une seule fois la demande CONFIRM « Veux-tu recevoir chaque matin le rapport des agents ? » (`Setting` `agents.dailyReport`). */
export async function ensureDailyReportQuestion(deps: AgentsDeps): Promise<void> {
  if ((await readSetting(deps, DAILY_REPORT_KEY)) !== undefined) return;
  // Une seule fois : une demande déjà posée (même passée ou expirée) n'est pas recréée ; elle se relance depuis le site.
  if (await deps.prisma.humanRequest.findFirst({ where: { key: DAILY_REPORT_KEY } })) return;
  await askHuman(deps, {
    kind: "CONFIRM",
    key: DAILY_REPORT_KEY,
    question: DAILY_REPORT_QUESTION,
    onAnswer: { action: "setting", settingKey: DAILY_REPORT_KEY },
  });
}
