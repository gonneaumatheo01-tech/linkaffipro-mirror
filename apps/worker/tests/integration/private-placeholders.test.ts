/**
 * Messages privés (base réelle) : les repères {prenom}, {canal}, {bot} sont remplacés à l'envoi — accueil du bot
 * (demande d'adhésion, texte de « Ce que dit le bot »), message « accepté » envoyé par le worker, et message à un groupe
 * jusqu'à l'appel Telegram (prénom de chaque destinataire, échappé).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { apiForBot as approvalsApiForBot } from "../../src/approvals/telegram-actions";
import { expandBroadcast } from "../../src/broadcasts/expand";
import { processApprovals } from "../../src/processors/approvals";
import { apiForBot } from "../../src/sending/api";
import { sendDm } from "../../src/sending/send-dm";
import {
  createBotAndChannel,
  fakeJob,
  installFakeTelegram,
  resetDb,
  type TelegramCall,
} from "./helpers";

const CHAT = -1002223334445n;
const LINK = "https://t.me/+Prenom0001";

function joinRequest(userId: number, firstName: string): Update {
  return {
    update_id: userId,
    chat_join_request: {
      chat: { id: Number(CHAT), type: "channel", title: "Casino VIP" },
      from: { id: userId, is_bot: false, first_name: firstName, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
      invite_link: {
        invite_link: LINK,
        creator: { id: 111, is_bot: true, first_name: "Bot test" },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
    },
  } as Update;
}

/** Les envois groupés ne sont pas vidés par `resetDb` (et bloqueraient la suppression du bot) : retirés ici. */
async function cleanBroadcasts() {
  await prisma.outboundMessage.deleteMany({ where: { broadcastId: { not: null } } });
  await prisma.broadcast.deleteMany();
}

describe("messages privés : repères remplacés à l'envoi (base réelle)", () => {
  let botId = "";
  let channelId = "";
  let bot: Bot;

  beforeAll(async () => {
    await cleanBroadcasts();
    await resetDb();
    const created = await createBotAndChannel({ chatId: CHAT, title: "Casino VIP" });
    botId = created.bot.id;
    channelId = created.channel.id;
    await prisma.approvalRule.create({
      data: {
        channelId,
        name: "Immédiat",
        isDefault: true,
        mode: "IMMEDIATE",
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    await prisma.inviteLink.create({
      data: { channelId, botId, telegramInviteLink: LINK, name: "Pub", kind: "AD_ENTRY" },
    });
    // Textes personnalisés dans « Ce que dit le bot » (comme le client les écrit).
    const welcome = await prisma.sequence.create({
      data: { name: "Accueil", channelId, trigger: "JOIN_REQUEST" },
    });
    await prisma.sequenceStep.create({
      data: {
        sequenceId: welcome.id,
        texts: { fr: "Salut {prenom} ! Bienvenue dans <b>{canal}</b>, écris à {bot}." },
      },
    });
    const approved = await prisma.sequence.create({
      data: { name: "Accepté", channelId, trigger: "APPROVED" },
    });
    await prisma.sequenceStep.create({
      data: {
        sequenceId: approved.id,
        texts: { fr: "C'est fait {prenom}, tu es dans <b>{canal}</b> !" },
      },
    });

    bot = createBot(created.bot, prismaTelegramDeps);
    installFakeTelegram(bot.api);
    installFakeTelegram(approvalsApiForBot(created.bot));
  });

  afterAll(cleanBroadcasts);

  it("accueil du bot : prénom, canal et bot remplacés dans le message en file", async () => {
    await bot.handleUpdate(joinRequest(7001, "Léa"));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 7001n } });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    expect(welcome.text).toBe("Salut Léa ! Bienvenue dans <b>Casino VIP</b>, écris à @bot_test.");
  });

  it("message « accepté » envoyé par le worker : prénom et canal remplacés", async () => {
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({
      claimed: 1,
      approved: 1,
    });
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 7001n } });
    const accepted = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "ACCEPTED" },
    });
    expect(accepted.text).toBe("C'est fait Léa, tu es dans <b>Casino VIP</b> !");
  });

  it("message à un groupe : chaque destinataire reçoit son prénom (échappé), jusqu'à l'appel Telegram", async () => {
    const people = [
      { telegramUserId: 7101n, firstName: "Hugo" },
      { telegramUserId: 7102n, firstName: "Tom <3" },
    ];
    for (const p of people) {
      const m = await prisma.member.create({
        data: { ...p, languageCode: "fr", tags: ["test-prenom"] },
      });
      await prisma.memberBotState.create({
        data: { memberId: m.id, botId, canDm: true, startedAt: new Date() },
      });
    }
    const b = await prisma.broadcast.create({
      data: {
        name: "Test prénom",
        botId,
        segment: { tags: ["test-prenom"] },
        text: "Bonjour <b>{prenom}</b> ! Ici {bot}.",
        status: "SENDING",
        startedAt: new Date(),
      },
    });
    await expandBroadcast(b.id);
    const out = await prisma.outboundMessage.findMany({
      where: { broadcastId: b.id },
      include: { member: { select: { firstName: true } } },
    });
    const expected = (name: string | null) =>
      `Bonjour <b>${(name ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b> ! Ici Bot test.`;
    expect(out).toHaveLength(2);
    for (const o of out) expect(o.text, o.memberId).toBe(expected(o.member.firstName));
    const tom = out.find((o) => o.member.firstName === "Tom <3")!;
    expect(tom.text).toBe("Bonjour <b>Tom &lt;3</b> ! Ici Bot test.");

    // Envoi réel (Telegram simulé) : le texte transmis est celui du destinataire.
    const calls: TelegramCall[] = installFakeTelegram((await apiForBot(botId)).api);
    await sendDm(tom.id);
    const sent = calls.find((c) => c.method === "sendMessage");
    expect(sent?.payload).toMatchObject({
      chat_id: 7102,
      text: "Bonjour <b>Tom &lt;3</b> ! Ici Bot test.",
      parse_mode: "HTML",
    });
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: tom.id } })).status).toBe(
      "SENT",
    );
  });
});
