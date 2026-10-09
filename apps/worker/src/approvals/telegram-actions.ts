/**
 * Approbation / refus d'une demande d'adhésion directement via l'API Telegram
 * (exception documentée à la file telegram-send : une approbation n'est pas un message).
 */
import { Api, GrammyError } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma, recordEvent } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import { baseLang, defaultText, pickText, renderText } from "@linkaffipro/telegram";
import { logger } from "../logger";

const MAX_ATTEMPTS = 3;
const apiCache = new Map<string, { api: Api; tokenEncrypted: string }>();

export function apiForBot(bot: { id: string; tokenEncrypted: string }): Api {
  const hit = apiCache.get(bot.id);
  if (hit && hit.tokenEncrypted === bot.tokenEncrypted) return hit.api;
  const api = new Api(decrypt(bot.tokenEncrypted));
  apiCache.set(bot.id, { api, tokenEncrypted: bot.tokenEncrypted });
  return api;
}

/** Bot qui agit pour un canal : principal s'il est administrateur, sinon premier administrateur actif. */
export async function actingBotFor(channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { primaryBotId: true, title: true } });
  const admins = await prisma.channelBotAdmin.findMany({ where: { channelId, revokedAt: null, bot: { isActive: true } }, orderBy: { detectedAt: "asc" }, include: { bot: true } });
  if (admins.length === 0) return null;
  const primary = channel?.primaryBotId ? admins.find((a) => a.botId === channel.primaryBotId) : undefined;
  if (!primary && channel?.primaryBotId) logger.warn({ channelId }, "bot principal non administrateur, bot de secours utilisé");
  return (primary ?? admins[0]!).bot;
}

export type ApproveOutcome = "approved" | "already" | "missing" | "retry" | "failed";

async function sendAcceptedMessage(m: { id: string; memberId: string; channelId: string; userChatId: bigint | null; approvalRuleId: string | null }, bot: { id: string }) {
  const rule = m.approvalRuleId ? await prisma.approvalRule.findUnique({ where: { id: m.approvalRuleId } }) : null;
  if (rule && !rule.sendAcceptedMessage) return;
  const [member, channel] = await Promise.all([
    prisma.member.findUnique({ where: { id: m.memberId }, select: { firstName: true, languageCode: true } }),
    prisma.channel.findUnique({ where: { id: m.channelId }, select: { title: true, language: true } }),
  ]);
  if (!member || !channel) return;
  const seq = await prisma.sequence.findFirst({ where: { trigger: "APPROVED", isActive: true, OR: [{ channelId: m.channelId }, { channelId: null }] }, orderBy: { channelId: "desc" }, include: { steps: { orderBy: { order: "asc" }, take: 1 } } });
  const texts = seq?.steps[0]?.texts && typeof seq.steps[0].texts === "object" ? (seq.steps[0].texts as Record<string, string>) : null;
  const lang = baseLang(member.languageCode ?? channel.language);
  const template = pickText(texts, member.languageCode, channel.language) ?? defaultText("approved", lang);
  const text = renderText(template, { prenom: member.firstName ?? "", canal: channel.title });
  await enqueueDm({ botId: bot.id, memberId: m.memberId, chatId: m.userChatId, kind: "ACCEPTED", text, buttons: [] });
}

/** Approuve une demande. Met à jour le Membership et journalise. */
export async function approveMembership(membershipId: string, opts: { byUserId?: string | null } = {}): Promise<ApproveOutcome> {
  const m = await prisma.membership.findUnique({ where: { id: membershipId }, include: { member: { select: { telegramUserId: true } }, channel: { select: { telegramChatId: true, title: true } } } });
  if (!m) return "missing";
  const bot = await actingBotFor(m.channelId);
  if (!bot) {
    await prisma.membership.update({ where: { id: m.id }, data: { lastError: "aucun bot administrateur", attempts: { increment: 1 } } });
    return "failed";
  }
  const api = apiForBot(bot);
  const markApproved = async () => {
    await prisma.membership.update({ where: { id: m.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByBotId: bot.id, lastError: null } });
    if (m.inviteLinkId) await prisma.inviteLink.update({ where: { id: m.inviteLinkId }, data: { approved: { increment: 1 } } }).catch(() => undefined);
    await recordEvent({ type: "membership.approved", memberId: m.memberId, channelId: m.channelId, botId: bot.id, payload: { membershipId: m.id, byUserId: opts.byUserId ?? null } });
    await sendAcceptedMessage(m, bot).catch((err: Error) => logger.warn({ err: err.message }, "message accepté non enfilé"));
  };
  try {
    await api.approveChatJoinRequest(Number(m.channel.telegramChatId), Number(m.member.telegramUserId));
    await markApproved();
    return "approved";
  } catch (err) {
    if (err instanceof GrammyError) {
      if (/USER_ALREADY_PARTICIPANT/i.test(err.description)) {
        await markApproved();
        return "already";
      }
      if (/HIDE_REQUESTER_MISSING/i.test(err.description)) {
        await prisma.membership.update({ where: { id: m.id }, data: { status: "EXPIRED", lastError: "demande retirée par le membre" } });
        await recordEvent({ type: "membership.expired", memberId: m.memberId, channelId: m.channelId, botId: bot.id, payload: { membershipId: m.id, reason: "HIDE_REQUESTER_MISSING" } });
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
    await prisma.membership.update({ where: { id: m.id }, data: { attempts, lastError: message, ...(attempts >= MAX_ATTEMPTS ? { status: "FAILED" } : {}) } });
    if (attempts >= MAX_ATTEMPTS) await recordEvent({ type: "membership.failed", memberId: m.memberId, channelId: m.channelId, botId: bot.id, payload: { membershipId: m.id, error: message } });
    logger.error({ membershipId: m.id, attempts, err: message }, "approbation échouée");
    return attempts >= MAX_ATTEMPTS ? "failed" : "retry";
  }
}

/** Refuse une demande (manuel ou expiration DECLINE). */
export async function declineMembership(membershipId: string, opts: { byUserId?: string | null; reason?: string } = {}): Promise<"declined" | "missing" | "failed"> {
  const m = await prisma.membership.findUnique({ where: { id: membershipId }, include: { member: { select: { telegramUserId: true } }, channel: { select: { telegramChatId: true } } } });
  if (!m) return "missing";
  const bot = await actingBotFor(m.channelId);
  if (!bot) return "failed";
  try {
    await apiForBot(bot).declineChatJoinRequest(Number(m.channel.telegramChatId), Number(m.member.telegramUserId));
  } catch (err) {
    if (!(err instanceof GrammyError && /HIDE_REQUESTER_MISSING|USER_ALREADY_PARTICIPANT/i.test(err.description))) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.membership.update({ where: { id: m.id }, data: { lastError: message, attempts: { increment: 1 } } });
      return "failed";
    }
  }
  await prisma.membership.update({ where: { id: m.id }, data: { status: "DECLINED", declinedAt: new Date(), lastError: null } });
  await recordEvent({ type: "membership.declined", memberId: m.memberId, channelId: m.channelId, botId: bot.id, payload: { membershipId: m.id, byUserId: opts.byUserId ?? null, reason: opts.reason ?? null } });
  return "declined";
}
