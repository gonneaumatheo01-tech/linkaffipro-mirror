import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  capturedJobs,
  createBotAndChannel,
  ctx,
  flushAfter,
  installFakeTelegram,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const INVITE_URL = "https://t.me/+PubTikTok001";
const USER_ID = 5151;

/** Update `chat_join_request` telle que Telegram l'envoie pour un lien avec demande d'adhésion. */
function joinRequestUpdate(chatId: bigint, date: number) {
  return {
    update_id: 10,
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: "Canal test" },
      from: { id: USER_ID, is_bot: false, first_name: "Nora", language_code: "fr" },
      user_chat_id: USER_ID,
      date,
      invite_link: {
        invite_link: INVITE_URL,
        creator: { id: 111, is_bot: true, first_name: "Bot test" },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
        name: "Pub TikTok 1",
      },
    },
  };
}

describe("adhésion par lien d'invitation (webhook, base réelle)", () => {
  let botId = "";
  let channelId = "";
  let inviteLinkId = "";
  let ruleId = "";
  let calls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    const { bot, channel } = await createBotAndChannel();
    botId = bot.id;
    channelId = channel.id;
    const link = await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: INVITE_URL,
        name: "Pub TikTok 1",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
        adCampaignName: "Campagne été",
        adName: "Vidéo 1",
      },
    });
    inviteLinkId = link.id;
    const rule = await prisma.approvalRule.create({
      data: {
        channelId: channel.id,
        name: "Règle par défaut",
        isDefault: true,
        mode: "DELAY",
        delaySeconds: 120,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    ruleId = rule.id;
    calls = installFakeTelegram(getOrCreateBot(bot, prismaTelegramDeps).api);
  });

  it("crée le membre, la demande planifiée et met le message d'accueil en file", async () => {
    const requestedAt = Math.floor(Date.now() / 1000) - 5;
    const res = await POST(
      webhookRequest(joinRequestUpdate(-1001234567890n, requestedAt)),
      ctx({ botId }),
    );
    expect(res.status).toBe(200);
    await flushAfter();

    const member = await prisma.member.findUnique({ where: { telegramUserId: BigInt(USER_ID) } });
    expect(member?.firstName).toBe("Nora");

    const membership = await prisma.membership.findFirst({
      where: { memberId: member!.id, channelId },
    });
    expect(membership).not.toBeNull();
    expect(membership?.status).toBe("SCHEDULED");
    expect(membership?.inviteLinkId).toBe(inviteLinkId);
    expect(membership?.approvalRuleId).toBe(ruleId);
    expect(membership?.userChatId).toBe(BigInt(USER_ID));
    expect(membership?.requestedAt.getTime()).toBe(requestedAt * 1000);
    // Délai de 120 s à partir de la demande.
    expect(membership?.approveAt?.getTime()).toBe((requestedAt + 120) * 1000);
    const source = membership?.source as {
      inviteLink?: { name?: string; adPlatform?: string };
      rule?: { mode?: string };
      botId?: string;
    };
    expect(source.inviteLink?.name).toBe("Pub TikTok 1");
    expect(source.inviteLink?.adPlatform).toBe("TIKTOK");
    expect(source.botId).toBe(botId);
    // Phase 11 : provenance résolue et règle appliquée, en clair pour les listes et la fiche membre.
    expect(membership?.source).toMatchObject({
      provenance: {
        type: "AD",
        inviteLinkId,
        sourceChannelId: null,
        adPlatform: "TIKTOK",
        label: "Venu d'une pub TikTok (« Pub TikTok 1 »)",
      },
      appliedRule: { id: ruleId, scope: "DEFAULT", label: null },
    });

    const link = await prisma.inviteLink.findUnique({ where: { id: inviteLinkId } });
    expect(link?.requests).toBe(1);

    // Message privé d'accueil : enregistré en base (QUEUED) et poussé dans la file telegram-send.
    const dm = await prisma.outboundMessage.findFirst({ where: { memberId: member!.id, botId } });
    expect(dm?.kind).toBe("WELCOME");
    expect(dm?.status).toBe("QUEUED");
    expect(dm?.chatId).toBe(BigInt(USER_ID));
    expect(dm?.text).toContain("Nora");
    expect(dm?.text).toContain("Canal test");
    const jobs = capturedJobs("telegram-send");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ type: "dm", outboundMessageId: dm!.id });

    // Rien n'est envoyé directement depuis le webhook : tout message privé passe par la file.
    expect(calls.find((c) => c.method === "sendMessage")).toBeUndefined();

    const events = await prisma.event.findMany({
      where: { memberId: member!.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["telegram.chat_join_request", "membership.requested"]),
    );
    const requested = events.find((e) => e.type === "membership.requested");
    expect((requested?.payload as { membershipId?: string }).membershipId).toBe(membership!.id);
    expect(requested?.payload).toMatchObject({
      provenance: { type: "AD", adPlatform: "TIKTOK" },
      appliedRule: { id: ruleId, scope: "DEFAULT" },
    });
  });

  it("ignore une demande sur un canal où aucun bot n'est administrateur", async () => {
    const before = await prisma.membership.count();
    const res = await POST(
      webhookRequest(joinRequestUpdate(-1009999999999n, Math.floor(Date.now() / 1000))),
      ctx({ botId }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    expect(await prisma.membership.count()).toBe(before);
  });
});
