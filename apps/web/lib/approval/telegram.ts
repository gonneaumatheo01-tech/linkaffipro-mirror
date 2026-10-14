import { Api, GrammyError } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma, recordEvent } from "@linkaffipro/db";
import { emitLinkaffiEvent, enqueueDm } from "@linkaffipro/queue";

/** Bot qui agit pour un canal (principal s'il est administrateur, sinon premier administrateur). */
export async function actingBotFor(channelId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { primaryBotId: true },
  });
  const admins = await prisma.channelBotAdmin.findMany({
    where: { channelId, revokedAt: null, bot: { isActive: true } },
    orderBy: { detectedAt: "asc" },
    include: { bot: true },
  });
  if (admins.length === 0) return null;
  const primary = channel?.primaryBotId
    ? admins.find((a) => a.botId === channel.primaryBotId)
    : undefined;
  return (primary ?? admins[0]!).bot;
}

/** Accepte une demande maintenant (depuis l'interface). Même règles d'erreur que le worker. */
export async function approveNow(
  membershipId: string,
  byUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { member: true, channel: true },
  });
  if (!m) return { ok: false, error: "Demande introuvable." };
  const bot = await actingBotFor(m.channelId);
  if (!bot) return { ok: false, error: "Aucun bot administrateur sur ce canal." };
  const api = new Api(decrypt(bot.tokenEncrypted));
  try {
    await api.approveChatJoinRequest(
      Number(m.channel.telegramChatId),
      Number(m.member.telegramUserId),
    );
  } catch (err) {
    if (err instanceof GrammyError && /HIDE_REQUESTER_MISSING/i.test(err.description)) {
      await prisma.membership.update({
        where: { id: m.id },
        data: { status: "EXPIRED", lastError: "demande retirée par le membre" },
      });
      // Membre d'un affilié Link Affi : demande expirée pour Link Affi (phase 13, filtré, jamais bloquant).
      await emitLinkaffiEvent({
        type: "join_expired",
        sourceId: m.id,
        memberId: m.memberId,
        channelId: m.channelId,
      });
      return { ok: false, error: "Le membre a retiré sa demande." };
    }
    if (!(err instanceof GrammyError && /USER_ALREADY_PARTICIPANT/i.test(err.description))) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.membership.update({
        where: { id: m.id },
        data: { lastError: message, attempts: { increment: 1 } },
      });
      return { ok: false, error: `Telegram a refusé : ${message}` };
    }
  }
  // Une seule date pour la demande et pour Link Affi : l'entrée (`chat_member`, datée à la seconde par Telegram) est
  // datée après elle par le flux d'adhésion, jamais avant.
  const approvedAt = new Date();
  await prisma.membership.update({
    where: { id: m.id },
    data: { status: "APPROVED", approvedAt, approvedByBotId: bot.id, lastError: null },
  });
  if (m.inviteLinkId)
    await prisma.inviteLink
      .update({ where: { id: m.inviteLinkId }, data: { approved: { increment: 1 } } })
      .catch(() => undefined);
  await recordEvent({
    type: "membership.approved",
    memberId: m.memberId,
    channelId: m.channelId,
    botId: bot.id,
    payload: { membershipId: m.id, byUserId, manual: true },
  });
  // Membre d'un affilié Link Affi : « accepté » envoyé à Link Affi (phase 13, filtré, jamais bloquant).
  await emitLinkaffiEvent({
    type: "join_approved",
    sourceId: m.id,
    memberId: m.memberId,
    channelId: m.channelId,
    occurredAt: approvedAt,
  });
  const rule = m.approvalRuleId
    ? await prisma.approvalRule.findUnique({ where: { id: m.approvalRuleId } })
    : null;
  // Entrée directe silencieuse (personne venue du bouton « canal à rejoindre » d'un canal sans règle, phase 11) :
  // aucun message, comme le worker (isSilentDirectEntry).
  const silent = (m.source as { noRule?: unknown } | null)?.noRule === "IMMEDIATE";
  if (!silent && (!rule || rule.sendAcceptedMessage)) {
    const text = `Bienvenue dans <b>${escapeHtml(m.channel.title)}</b>${m.member.firstName ? `, ${escapeHtml(m.member.firstName)}` : ""} ! Tu es accepté.`;
    await enqueueDm({
      botId: bot.id,
      memberId: m.memberId,
      chatId: m.userChatId,
      kind: "ACCEPTED",
      text,
    }).catch(() => undefined);
  }
  return { ok: true };
}

/** Refuse une demande (depuis l'interface). */
export async function declineNow(
  membershipId: string,
  byUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { member: true, channel: true },
  });
  if (!m) return { ok: false, error: "Demande introuvable." };
  const bot = await actingBotFor(m.channelId);
  if (!bot) return { ok: false, error: "Aucun bot administrateur sur ce canal." };
  const api = new Api(decrypt(bot.tokenEncrypted));
  try {
    await api.declineChatJoinRequest(
      Number(m.channel.telegramChatId),
      Number(m.member.telegramUserId),
    );
  } catch (err) {
    if (!(
      err instanceof GrammyError &&
      /HIDE_REQUESTER_MISSING|USER_ALREADY_PARTICIPANT/i.test(err.description)
    )) {
      return {
        ok: false,
        error: `Telegram a refusé : ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  await prisma.membership.update({
    where: { id: m.id },
    data: { status: "DECLINED", declinedAt: new Date() },
  });
  await recordEvent({
    type: "membership.declined",
    memberId: m.memberId,
    channelId: m.channelId,
    botId: bot.id,
    payload: { membershipId: m.id, byUserId, manual: true },
  });
  // Membre d'un affilié Link Affi : « refusé » envoyé à Link Affi (phase 13, filtré, jamais bloquant).
  await emitLinkaffiEvent({
    type: "join_declined",
    sourceId: m.id,
    memberId: m.memberId,
    channelId: m.channelId,
  });
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
