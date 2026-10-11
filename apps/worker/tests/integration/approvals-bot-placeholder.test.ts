import { beforeEach, describe, expect, it } from "vitest";
import { validateTelegramHtml } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb } from "./helpers";

/**
 * Repère {bot} dans les textes « Ce que dit le bot » envoyés par le worker : message « accepté » et rappels. Il vaut
 * « @username » du bot qui écrit, comme dans l'accueil (packages/telegram/src/join-flow/service.ts) ; avant la
 * correction, il partait vide (« Écris à  pour… »). Valeurs échappées : un prénom « Tom <3 » reste du HTML valide.
 */
describe("{bot} dans le message « accepté » et les rappels (base réelle)", () => {
  beforeEach(resetDb);

  it("message « accepté » personnalisé : {bot} = @username du bot qui accepte", async () => {
    const { bot, channel } = await createBotAndChannel();
    installFakeTelegram(apiForBot(bot));
    await prisma.sequence.create({
      data: {
        name: "Acceptation",
        trigger: "APPROVED",
        channelId: channel.id,
        steps: { create: [{ order: 0, texts: { fr: "Bienvenue {prenom} ! Écris à {bot} pour les bonus de {canal}." } }] },
      },
    });
    const member = await prisma.member.create({ data: { telegramUserId: 7001n, firstName: "Tom <3", languageCode: "fr" } });
    await prisma.membership.create({
      data: { code: "botvar01", memberId: member.id, channelId: channel.id, status: "SCHEDULED", approveAt: new Date(Date.now() - 1_000), userChatId: 7001n },
    });

    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({ claimed: 1, approved: 1 });
    const accepted = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "ACCEPTED" } });
    expect(accepted.text).toBe("Bienvenue Tom &lt;3 ! Écris à @bot_test pour les bonus de Canal test.");
    expect(validateTelegramHtml(accepted.text)).toMatchObject({ ok: true });
  });

  it("rappel personnalisé : {bot} = @username du bot de la demande", async () => {
    const { bot, channel } = await createBotAndChannel();
    installFakeTelegram(apiForBot(bot));
    const gate = await prisma.channel.create({
      data: { telegramChatId: -1001777000001n, title: "Canal partenaire", type: "CHANNEL", language: "fr", primaryBotId: bot.id, isTest: true },
    });
    await prisma.channelBotAdmin.create({ data: { channelId: gate.id, botId: bot.id, rights: { status: "administrator", can_invite_users: true } } });
    const rule = await prisma.approvalRule.create({
      data: { channelId: channel.id, name: "Règle par défaut", isDefault: true, mode: "DELAY", delaySeconds: 0, gateMode: "REQUIRED", gateChannelIds: [gate.id], reminderAfterMinutes: [0], maxReminders: 1 },
    });
    await prisma.sequence.create({
      data: {
        name: "Rappel",
        trigger: "GATE_REMINDER",
        channelId: channel.id,
        steps: { create: [{ order: 0, texts: { fr: "{prenom}, rejoins {liste_canaux} puis reviens voir {bot}." } }] },
      },
    });
    const member = await prisma.member.create({ data: { telegramUserId: 7002n, firstName: "Léa", languageCode: "fr" } });
    await prisma.memberBotState.create({ data: { memberId: member.id, botId: bot.id, canDm: true, startedAt: new Date() } });
    await prisma.membership.create({
      data: {
        code: "botvar02",
        memberId: member.id,
        channelId: channel.id,
        status: "PENDING_GATE",
        approvalRuleId: rule.id,
        userChatId: 7002n,
        requestedAt: new Date(Date.now() - 60_000),
        source: { botId: bot.id, startUrl: "https://t.me/bot_test?start=gbotvar02", gates: [] },
      },
    });

    expect(await processApprovals(fakeJob({ type: "reminders" as const }))).toEqual({ sent: 1 });
    const reminder = await prisma.outboundMessage.findFirstOrThrow({ where: { memberId: member.id, kind: "GATE_REMINDER" } });
    expect(reminder.text).toBe("Léa, rejoins Canal partenaire puis reviens voir @bot_test.");
  });
});
