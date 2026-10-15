/**
 * Acceptations et refus mis en file par le site (phase 14, « Tout accepter » de l'onglet Demandes) : tâches
 * `telegram-send` `approve` / `decline`, une par demande, traitées au rythme permis par Telegram (25 appels par seconde
 * et par bot, `RateLimiter`), 429 respecté par une nouvelle tentative de la tâche.
 *
 * Une demande qui n'est plus en cours (acceptée entre-temps par le passage des 20 secondes, refusée, expirée) n'est
 * jamais touchée : sans cette garde, Telegram répondrait « demande introuvable » et la demande acceptée serait notée
 * expirée.
 */
import { prisma } from "@linkaffipro/db";
import { getRedis } from "@linkaffipro/queue";
import { OPEN_STATUSES } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { RateLimiter } from "../sending/rate-limit";
import { approveMembership, declineMembership } from "./telegram-actions";

async function isOpen(membershipId: string): Promise<boolean> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { status: true },
  });
  return !!m && OPEN_STATUSES.includes(m.status);
}

/** Erreur levée pour que BullMQ retente la tâche plus tard (429 de Telegram, erreur passagère). */
export class RetryLater extends Error {}

export async function processApproveJob(
  membershipId: string,
  byUserId: string | null,
): Promise<{ ok: boolean; outcome: string }> {
  if (!(await isOpen(membershipId))) return { ok: true, outcome: "not_open" };
  const rl = new RateLimiter(getRedis());
  const outcome = await approveMembership(membershipId, {
    byUserId,
    beforeCall: (botId) => rl.forBot(botId),
  });
  if (outcome === "retry") {
    logger.warn({ membershipId }, "acceptation mise en file à retenter");
    throw new RetryLater("acceptation à retenter");
  }
  if (outcome === "failed") {
    // Pas de bot administrateur pour l'instant : le passage des 20 secondes reprend la demande tout de suite, sans
    // attendre l'heure de secours posée par le site (10 minutes).
    await prisma.membership.updateMany({
      where: { id: membershipId, status: "SCHEDULED" },
      data: { approveAt: new Date() },
    });
  }
  return { ok: outcome !== "failed", outcome };
}

export async function processDeclineJob(
  membershipId: string,
  byUserId: string | null,
): Promise<{ ok: boolean; outcome: string }> {
  if (!(await isOpen(membershipId))) return { ok: true, outcome: "not_open" };
  const rl = new RateLimiter(getRedis());
  const outcome = await declineMembership(membershipId, {
    byUserId,
    beforeCall: (botId) => rl.forBot(botId),
  });
  return { ok: outcome !== "failed", outcome };
}
