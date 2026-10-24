/**
 * Approbation / refus d'une demande d'adhésion directement via l'API Telegram
 * (exception documentée à la file telegram-send : une approbation n'est pas un message).
 */
import { Api, GrammyError } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { ACTIVE_CHANNEL_BOT_WHERE, prisma, recordEvent } from "@linkaffipro/db";
import { emitLinkaffiEvent, enqueueDm } from "@linkaffipro/queue";
import {
  baseLang,
  defaultText,
  OPEN_STATUSES,
  pickText,
  reachability,
  renderHtmlText,
} from "@linkaffipro/telegram";
import { logger } from "../logger";
import { enqueueWelcomeDm } from "./welcome-dm";

const MAX_ATTEMPTS = 3;
const apiCache = new Map<string, { api: Api; tokenEncrypted: string }>();

export function apiForBot(bot: { id: string; tokenEncrypted: string }): Api {
  const hit = apiCache.get(bot.id);
  if (hit && hit.tokenEncrypted === bot.tokenEncrypted) return hit.api;
  const api = new Api(decrypt(bot.tokenEncrypted));
  apiCache.set(bot.id, { api, tokenEncrypted: bot.tokenEncrypted });
  return api;
}

/**
 * Bot qui agit pour un canal : principal s'il est administrateur, sinon premier administrateur actif. Jamais un bot
 * assistant de conversation (phase 17).
 */
export async function actingBotFor(channelId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { primaryBotId: true, title: true },
  });
  const admins = await prisma.channelBotAdmin.findMany({
    where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
    orderBy: { detectedAt: "asc" },
    include: { bot: true },
  });
  if (admins.length === 0) return null;
  const primary = channel?.primaryBotId
    ? admins.find((a) => a.botId === channel.primaryBotId)
    : undefined;
  if (!primary && channel?.primaryBotId)
    logger.warn({ channelId }, "bot principal non administrateur, bot de secours utilisé");
  return (primary ?? admins[0]!).bot;
}

export type ApproveOutcome = "approved" | "already" | "missing" | "retry" | "failed";

/**
 * Entrée directe sans règle (personne venue du bouton « canal à rejoindre » d'un autre canal, canal sans règle,
 * phase 11) : acceptée sans aucun message, comme avec les anciens liens à entrée directe.
 */
export function isSilentDirectEntry(source: unknown): boolean {
  return (
    !!source &&
    typeof source === "object" &&
    (source as { noRule?: unknown }).noRule === "IMMEDIATE"
  );
}

/**
 * Le bot peut-il encore écrire à la personne pour lui dire « Accepté » ? (phase 14, décision E2) : elle a démarré le
 * bot (ou appuyé sur un de ses boutons) et ne l'a pas bloqué, ou sa demande a moins de 5 minutes. Sinon rien n'est
 * envoyé : événement `dm.skipped_unreachable` (jamais une erreur ni « a bloqué le bot »).
 */
export async function acceptedMessageReachable(
  m: {
    id: string;
    memberId: string;
    channelId: string;
    userChatId: bigint | null;
    requestedAt: Date;
  },
  botId: string,
  now = new Date(),
): Promise<boolean> {
  const state = await prisma.memberBotState.findUnique({
    where: { memberId_botId: { memberId: m.memberId, botId } },
    select: { canDm: true, startedAt: true, blockedAt: true },
  });
  const reach = reachability(state, { userChatId: m.userChatId, requestedAt: m.requestedAt }, now);
  if (reach.reachable) return true;
  await recordEvent({
    type: "dm.skipped_unreachable",
    memberId: m.memberId,
    channelId: m.channelId,
    botId,
    payload: { membershipId: m.id, kind: "ACCEPTED", reason: reach.reason },
  });
  return false;
}

/** Message « accepté » (texte de « Ce que dit le bot » ou intégré) en HTML Telegram, valeurs échappées. */
async function sendAcceptedMessage(
  m: {
    id: string;
    memberId: string;
    channelId: string;
    userChatId: bigint | null;
    requestedAt: Date;
    approvalRuleId: string | null;
    source: unknown;
  },
  bot: { id: string; username: string },
) {
  if (isSilentDirectEntry(m.source)) return;
  const rule = m.approvalRuleId
    ? await prisma.approvalRule.findUnique({ where: { id: m.approvalRuleId } })
    : null;
  if (rule && !rule.sendAcceptedMessage) return;
  // Personne injoignable (jamais démarré le bot, fenêtre de 5 minutes passée) : rien n'est mis en file.
  if (!(await acceptedMessageReachable(m, bot.id))) return;
  const [member, channel] = await Promise.all([
    prisma.member.findUnique({
      where: { id: m.memberId },
      select: { firstName: true, languageCode: true },
    }),
    prisma.channel.findUnique({
      where: { id: m.channelId },
      select: { title: true, language: true },
    }),
  ]);
  if (!member || !channel) return;
  const seq = await prisma.sequence.findFirst({
    where: {
      trigger: "APPROVED",
      isActive: true,
      OR: [{ channelId: m.channelId }, { channelId: null }],
    },
    orderBy: { channelId: "desc" },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  const texts =
    seq?.steps[0]?.texts && typeof seq.steps[0].texts === "object"
      ? (seq.steps[0].texts as Record<string, string>)
      : null;
  const lang = baseLang(member.languageCode ?? channel.language);
  const template =
    pickText(texts, member.languageCode, channel.language) ?? defaultText("approved", lang);
  const text = renderHtmlText(template, {
    prenom: member.firstName ?? "",
    canal: channel.title,
    bot: `@${bot.username}`,
  });
  await enqueueDm({
    botId: bot.id,
    memberId: m.memberId,
    chatId: m.userChatId,
    kind: "ACCEPTED",
    text,
    buttons: [],
    mediaAssetId: seq?.steps[0]?.mediaAssetId ?? null,
  });
}

/**
 * Approuve une demande. Met à jour le Membership et journalise. `beforeCall` : attente avant l'appel à Telegram
 * (limite de débit du bot, « Tout accepter » par la file telegram-send).
 */
export async function approveMembership(
  membershipId: string,
  opts: { byUserId?: string | null; beforeCall?: (botId: string) => Promise<void> } = {},
): Promise<ApproveOutcome> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: {
      member: { select: { telegramUserId: true } },
      channel: { select: { telegramChatId: true, title: true } },
    },
  });
  if (!m) return "missing";
  const bot = await actingBotFor(m.channelId);
  if (!bot) {
    await prisma.membership.update({
      where: { id: m.id },
      data: { lastError: "aucun bot administrateur", attempts: { increment: 1 } },
    });
    return "failed";
  }
  const api = apiForBot(bot);
  const markApproved = async () => {
    // Une seule date pour la demande et pour Link Affi : l'entrée (`chat_member`, datée à la seconde par Telegram) est
    // datée après elle par le flux d'adhésion, jamais avant.
    const approvedAt = new Date();
    // Mise à jour conditionnelle : si une autre voie (tâche « Tout accepter », passage des 20 secondes) l'a déjà
    // acceptée, rien n'est compté ni envoyé une seconde fois.
    const { count } = await prisma.membership.updateMany({
      where: { id: m.id, status: { in: OPEN_STATUSES } },
      data: {
        status: "APPROVED",
        approvedAt,
        approvedByBotId: bot.id,
        lastError: null,
      },
    });
    if (count === 0) return;
    if (m.inviteLinkId)
      await prisma.inviteLink
        .update({ where: { id: m.inviteLinkId }, data: { approved: { increment: 1 } } })
        .catch(() => undefined);
    await recordEvent({
      type: "membership.approved",
      memberId: m.memberId,
      channelId: m.channelId,
      botId: bot.id,
      payload: { membershipId: m.id, byUserId: opts.byUserId ?? null },
    });
    // Membre d'un affilié Link Affi : « accepté » envoyé à Link Affi (filtré et jamais bloquant, phase 13).
    await emitLinkaffiEvent({
      type: "join_approved",
      sourceId: m.id,
      memberId: m.memberId,
      channelId: m.channelId,
      occurredAt: approvedAt,
    });
    await sendAcceptedMessage(m, bot).catch((err: Error) =>
      logger.warn({ err: err.message }, "message accepté non enfilé"),
    );
    // DM de bienvenue par le compte reel : mis en file, envoye par apps/userbot (jamais bloquant).
    await enqueueWelcomeDm({ membershipId: m.id, channelId: m.channelId, memberId: m.memberId }).catch(
      (err: Error) => logger.warn({ err: err.message }, "DM de bienvenue non enfile"),
    );
  };
  try {
    await opts.beforeCall?.(bot.id);
    await api.approveChatJoinRequest(
      Number(m.channel.telegramChatId),
      Number(m.member.telegramUserId),
    );
    await markApproved();
    return "approved";
  } catch (err) {
    if (err instanceof GrammyError) {
      if (/USER_ALREADY_PARTICIPANT/i.test(err.description)) {
        await markApproved();
        return "already";
      }
      if (/HIDE_REQUESTER_MISSING/i.test(err.description)) {
        // Demande déjà acceptée par une autre voie pendant l'appel : Telegram ne la trouve plus, mais elle n'a pas
        // expiré. Seule une demande encore en cours passe « expirée ».
        const { count } = await prisma.membership.updateMany({
          where: { id: m.id, status: { in: OPEN_STATUSES } },
          data: { status: "EXPIRED", lastError: "demande retirée par le membre" },
        });
        if (count === 0) return "already";
        await recordEvent({
          type: "membership.expired",
          memberId: m.memberId,
          channelId: m.channelId,
          botId: bot.id,
          payload: { membershipId: m.id, reason: "HIDE_REQUESTER_MISSING" },
        });
        // Demande retirée par la personne : pour Link Affi, demande expirée (phase 13).
        await emitLinkaffiEvent({
          type: "join_expired",
          sourceId: m.id,
          memberId: m.memberId,
          channelId: m.channelId,
        });
        return "missing";
      }
      if (err.error_code === 429) {
        const wait = (err.parameters?.retry_after ?? 5) * 1000;
        logger.warn({ wait }, "429 Telegram, attente");
        await new Promise((r) => setTimeout(r, wait));
        return "retry";
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    const attempts = m.attempts + 1;
    await prisma.membership.update({
      where: { id: m.id },
      data: {
        attempts,
        lastError: message,
        ...(attempts >= MAX_ATTEMPTS ? { status: "FAILED" } : {}),
      },
    });
    if (attempts >= MAX_ATTEMPTS) {
      await recordEvent({
        type: "membership.failed",
        memberId: m.memberId,
        channelId: m.channelId,
        botId: bot.id,
        payload: { membershipId: m.id, error: message },
      });
      // Acceptation impossible pour de bon : la personne n'entrera pas par cette demande. Pour Link Affi, demande
      // expirée (même lecture que `GET /members` : FAILED = « expired »), sinon elle resterait « en attente » chez lui.
      await emitLinkaffiEvent({
        type: "join_expired",
        sourceId: m.id,
        memberId: m.memberId,
        channelId: m.channelId,
      });
    }
    logger.error({ membershipId: m.id, attempts, err: message }, "approbation échouée");
    return attempts >= MAX_ATTEMPTS ? "failed" : "retry";
  }
}

/** Refuse une demande (manuel ou expiration DECLINE). `beforeCall` : attente avant l'appel (limite de débit). */
export async function declineMembership(
  membershipId: string,
  opts: {
    byUserId?: string | null;
    reason?: string;
    beforeCall?: (botId: string) => Promise<void>;
  } = {},
): Promise<"declined" | "missing" | "failed"> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: {
      member: { select: { telegramUserId: true } },
      channel: { select: { telegramChatId: true } },
    },
  });
  if (!m) return "missing";
  const bot = await actingBotFor(m.channelId);
  if (!bot) return "failed";
  try {
    await opts.beforeCall?.(bot.id);
    await apiForBot(bot).declineChatJoinRequest(
      Number(m.channel.telegramChatId),
      Number(m.member.telegramUserId),
    );
  } catch (err) {
    if (!(
      err instanceof GrammyError &&
      /HIDE_REQUESTER_MISSING|USER_ALREADY_PARTICIPANT/i.test(err.description)
    )) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.membership.update({
        where: { id: m.id },
        data: { lastError: message, attempts: { increment: 1 } },
      });
      return "failed";
    }
  }
  await prisma.membership.update({
    where: { id: m.id },
    data: { status: "DECLINED", declinedAt: new Date(), lastError: null },
  });
  await recordEvent({
    type: "membership.declined",
    memberId: m.memberId,
    channelId: m.channelId,
    botId: bot.id,
    payload: { membershipId: m.id, byUserId: opts.byUserId ?? null, reason: opts.reason ?? null },
  });
  // Refus (à la main ou à l'expiration avec refus) d'un membre d'affilié Link Affi (phase 13).
  await emitLinkaffiEvent({
    type: "join_declined",
    sourceId: m.id,
    memberId: m.memberId,
    channelId: m.channelId,
  });
  return "declined";
}
