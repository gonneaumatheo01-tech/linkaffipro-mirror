import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { getRedis } from "@linkaffipro/queue";
import { logger } from "../logger";
import { apiForBot } from "./api";
import { describeTelegramError, withTelegramRetry } from "./errors";
import { buildDmKeyboard } from "./keyboard";
import { RateLimiter } from "./rate-limit";
import { recordBroadcastOutcome } from "../broadcasts/progress";

/** Envoie un message privé en file d'attente (`OutboundMessage` QUEUED). */
export async function sendDm(outboundMessageId: string): Promise<void> {
  const om = await prisma.outboundMessage.findUnique({ where: { id: outboundMessageId }, include: { member: true } });
  if (!om || om.status !== "QUEUED") return;
  const chatId = om.chatId ?? om.member.telegramUserId;
  const rl = new RateLimiter(getRedis());
  try {
    const { api } = await apiForBot(om.botId);
    await rl.forBot(om.botId);
    await rl.forPrivateChat(chatId);
    const msg = await withTelegramRetry(() =>
      api.sendMessage(Number(chatId), om.text, { parse_mode: "HTML", reply_markup: buildDmKeyboard(om.buttons), link_preview_options: { is_disabled: true } }),
    );
    const now = new Date();
    await prisma.outboundMessage.update({ where: { id: om.id }, data: { status: "SENT", sentAt: now, telegramMessageId: msg.message_id, error: null } });
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: om.memberId, botId: om.botId } },
      create: { memberId: om.memberId, botId: om.botId, canDm: true, lastDmAt: now },
      update: { lastDmAt: now },
    });
    await recordEvent({ type: "dm.sent", memberId: om.memberId, botId: om.botId, payload: toJsonValue({ outboundMessageId: om.id, kind: om.kind }) });
    await recordBroadcastOutcome(om.broadcastId, "SENT");
  } catch (err) {
    const d = describeTelegramError(err);
    const status = d.blocked ? "BLOCKED" : "FAILED";
    await prisma.outboundMessage.update({ where: { id: om.id }, data: { status, error: d.message } });
    if (d.blocked) {
      await prisma.memberBotState.upsert({
        where: { memberId_botId: { memberId: om.memberId, botId: om.botId } },
        create: { memberId: om.memberId, botId: om.botId, canDm: false, blockedAt: new Date() },
        update: { canDm: false, blockedAt: new Date() },
      });
    }
    await recordEvent({ type: d.blocked ? "dm.blocked" : "dm.failed", memberId: om.memberId, botId: om.botId, payload: toJsonValue({ outboundMessageId: om.id, error: d.message }) });
    logger.warn({ outboundMessageId: om.id, err: d.message }, "message privé non envoyé");
    await recordBroadcastOutcome(om.broadcastId, status);
  }
}
