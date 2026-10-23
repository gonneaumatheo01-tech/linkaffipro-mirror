import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import type { Job } from "bullmq";
import type { Api } from "grammy";

/** Vide les tables touchées par les tests (ordre : dépendances d'abord). Base de test uniquement. */
export async function resetDb(): Promise<void> {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("resetDb refuse de tourner hors de la base de test");
  await prisma.$transaction([
    // Équipe Algorithme (phase 21) : tests A/B, recommandations, rapports (les fiches suivent les posts).
    prisma.experiment.deleteMany(),
    prisma.recommendation.deleteMany(),
    prisma.insightReport.deleteMany(),
    // Agents IA (phase 19) : passages, validations, demandes, médiathèque, missions, plans, réglages d'équipe.
    prisma.agentRun.deleteMany(),
    prisma.agentValidation.deleteMany(),
    prisma.humanRequest.deleteMany(),
    prisma.mediaUsage.deleteMany(),
    prisma.agentUsage.deleteMany(),
    prisma.agentMission.deleteMany(),
    prisma.channelAgentPlan.deleteMany(),
    prisma.agentTeamConfig.deleteMany(),
    // Assistant de conversation (phase 17) : conversations, liens d'offre, coûts IA, personas.
    prisma.conversationEvent.deleteMany(),
    prisma.conversationMessage.deleteMany(),
    prisma.assistantOfferLink.deleteMany(),
    prisma.aiConversationUsage.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.postbackLog.deleteMany(),
    prisma.playerEvent.deleteMany(),
    prisma.player.deleteMany(),
    prisma.postbackEndpoint.deleteMany(),
    prisma.click.deleteMany(),
    prisma.outboundMessage.deleteMany(),
    prisma.postStats.deleteMany(),
    prisma.trackingLink.deleteMany(),
    prisma.post.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.approvalRule.deleteMany(),
    prisma.inviteLink.deleteMany(),
    prisma.sequenceStep.deleteMany(),
    prisma.sequence.deleteMany(),
    prisma.channelBotAdmin.deleteMany(),
    prisma.affiliateCampaign.deleteMany(),
    prisma.affiliateProgram.deleteMany(),
    prisma.event.deleteMany(),
    prisma.memberBotState.deleteMany(),
    prisma.member.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.bot.deleteMany(),
    prisma.persona.deleteMany(),
    prisma.syncState.deleteMany(),
  ]);
  // Vidé en place : le mock de la file garde une référence sur ce tableau (voir setup.ts).
  (globalThis.__jobs ??= []).length = 0;
}

/** Tâches BullMQ capturées par le mock de `@linkaffipro/queue` (voir setup.ts). */
export function capturedJobs(queue?: string) {
  const all = globalThis.__jobs ?? [];
  return queue ? all.filter((j) => j.queue === queue) : all;
}

export type TelegramCall = { method: string; payload: Record<string, unknown> };

/**
 * Intercepte une instance `Api` grammY : aucun appel réseau, chaque méthode reçoit une réponse plausible
 * et l'appel est consigné dans la liste retournée.
 */
export function installFakeTelegram(api: Api): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextMessageId = 1000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    let result: unknown = true;
    if (/^send(Message|Photo|Video|Animation|Document)$/.test(method)) {
      result = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chat_id), type: Number(p.chat_id) < 0 ? "channel" : "private" }, text: p.text ?? p.caption ?? "" };
    } else if (method === "sendMediaGroup") {
      result = ((p.media as unknown[]) ?? []).map(() => ({ message_id: nextMessageId++, date: 0, chat: { id: Number(p.chat_id), type: "channel" } }));
    } else if (method === "getChatMember") {
      result = { status: "member", user: { id: Number(p.user_id), is_bot: false, first_name: "x" } };
    } else if (method === "createChatInviteLink") {
      result = { invite_link: `https://t.me/+gate${String(p.chat_id).replace(/\D/g, "").slice(-6)}`, creator: { id: 1, is_bot: true, first_name: "bot" }, creates_join_request: false, is_primary: false, is_revoked: false, name: p.name };
    }
    return { ok: true, result } as never;
  });
  return calls;
}

export const TEST_BOT_TOKEN = "111:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/** Bot + canal administré par ce bot (le cas nominal de tous les parcours). */
export async function createBotAndChannel(opts: { chatId?: bigint; title?: string } = {}) {
  const bot = await prisma.bot.create({
    data: { name: "Bot test", username: "bot_test", telegramBotId: 111n, tokenEncrypted: encrypt(TEST_BOT_TOKEN), vertical: "CASINO", webhookSecret: "secret-integration" },
  });
  const channel = await prisma.channel.create({
    data: { telegramChatId: opts.chatId ?? -1001234567890n, title: opts.title ?? "Canal test", type: "CHANNEL", language: "fr", primaryBotId: bot.id, isTest: true },
  });
  await prisma.channelBotAdmin.create({ data: { channelId: channel.id, botId: bot.id, rights: { status: "administrator", can_invite_users: true } } });
  return { bot, channel };
}

/** Objet `Job` BullMQ minimal pour appeler un processeur directement. */
export function fakeJob<T>(data: T, id = "test-job") {
  return { id, data } as unknown as Job<T>;
}
