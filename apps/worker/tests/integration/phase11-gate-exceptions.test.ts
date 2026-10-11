/**
 * Reprise de la phase 11 (packages/db/prisma/phase11-gate-exceptions.ts, `pnpm db:phase11`) sur base réelle : une
 * exception « venu du bouton « canal à rejoindre » → tout de suite, sans message » sur chaque canal obligatoire qui a
 * une règle par défaut ; une seule fois ; jamais une exception de l'équipe touchée ni doublée ; aucune autre règle
 * modifiée.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { createBot, prismaTelegramDeps, resolveRuleWithDb } from "@linkaffipro/telegram";
import {
  createGateExceptions,
  GATE_EXCEPTION_LABEL,
  GATE_EXCEPTIONS_KEY,
} from "../../../../packages/db/prisma/phase11-gate-exceptions";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processApprovals } from "../../src/processors/approvals";
import {
  createBotAndChannel,
  fakeJob,
  installFakeTelegram,
  resetDb,
  type TelegramCall,
} from "./helpers";

const db = prisma as unknown as PrismaClient;

describe("reprise phase 11 : exceptions « venu d'un canal obligatoire »", () => {
  const ids: Record<string, string> = {};
  const def = (channelId: string, gates: string[] = [], over: Record<string, unknown> = {}) =>
    prisma.approvalRule.create({
      data: {
        channelId,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 300,
        gateMode: gates.length ? "REQUIRED" : "NONE",
        gateChannelIds: gates,
        reminderAfterMinutes: [],
        maxReminders: 0,
        ...over,
      },
    });

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: GATE_EXCEPTIONS_KEY } });
    const bot = await prisma.bot.create({
      data: {
        name: "Bot",
        username: "bot_p11",
        telegramBotId: 911n,
        tokenEncrypted: encrypt(`911:TEST-TOKEN-${"x".repeat(30)}`),
        vertical: "SPORTS",
        webhookSecret: "s",
      },
    });
    let chat = -1001500000000n;
    for (const key of ["tir", "zone", "roulette", "lyon", "x", "y", "w", "src"]) {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chat--,
          title: key,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: bot.id,
          isTest: true,
        },
      });
      ids[key] = c.id;
    }
    // Tir exige Zone, Y et W ; Zone exige Roulette et Tir (exigences croisées).
    await def(ids.tir!, [ids.zone!, ids.y!, ids.w!]);
    await def(ids.zone!, [ids.roulette!, ids.tir!]);
    // Lyon : règle par défaut, jamais canal obligatoire. X : demandé seulement par une règle inactive.
    await def(ids.lyon!);
    await def(ids.x!);
    await def(ids.src!, [ids.x!], { isActive: false });
    // Y : l'équipe a déjà une exception « n'importe lequel de nos canaux ». W : une exception « pub TikTok » (ordre 10).
    await def(ids.y!);
    await prisma.approvalRule.create({
      data: {
        channelId: ids.y!,
        name: "Équipe",
        scope: "SOURCE_KIND",
        sourceKind: "ANY_CHANNEL",
        sortOrder: 10,
        mode: "DELAY",
        delaySeconds: 60,
      },
    });
    await def(ids.w!);
    await prisma.approvalRule.create({
      data: {
        channelId: ids.w!,
        name: "TikTok",
        scope: "SOURCE_KIND",
        sourceKind: "AD_TIKTOK",
        sortOrder: 10,
        mode: "DELAY",
        delaySeconds: 60,
      },
    });
  });

  it("crée une exception par canal obligatoire avec une règle par défaut, sans toucher aux autres règles", async () => {
    const before = await prisma.approvalRule.findMany({ orderBy: { id: "asc" } });
    const r = await createGateExceptions(db);
    expect(r.alreadyDone).toBe(false);
    expect(r.created.map((c) => c.title).sort()).toEqual(["tir", "w", "zone"]);
    expect(r.skippedExisting.map((c) => c.title)).toEqual(["y"]);
    expect(r.withoutDefault.map((c) => c.title)).toEqual(["roulette"]);
    expect(r.candidates).toBe(4);

    const created = await prisma.approvalRule.findMany({
      where: { id: { in: r.created.map((c) => c.ruleId) } },
    });
    for (const rule of created)
      expect(rule).toMatchObject({
        scope: "SOURCE_KIND",
        sourceKind: "GATE",
        isDefault: false,
        isActive: true,
        label: GATE_EXCEPTION_LABEL,
        mode: "IMMEDIATE",
        delaySeconds: 0,
        sendWelcome: false,
        sendAcceptedMessage: false,
        gateMode: "NONE",
        gateChannelIds: [],
        inviteLinkId: null,
        sourceChannelId: null,
      });
    // Ordre : en tête des exceptions du même niveau, sans renuméroter celles de l'équipe.
    expect(created.find((c) => c.channelId === ids.zone)!.sortOrder).toBe(10);
    expect(created.find((c) => c.channelId === ids.w)!.sortOrder).toBe(0);
    // Aucune règle existante modifiée.
    const after = await prisma.approvalRule.findMany({
      where: { id: { in: before.map((b) => b.id) } },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);

    // Effet : une personne venue du bouton d'un autre canal entre tout de suite, sans message (comme avant).
    const rule = await resolveRuleWithDb(ids.zone!, {
      id: "l",
      kind: "GATE",
      sourceChannelId: ids.tir!,
      adPlatform: null,
    });
    expect(rule).toMatchObject({
      scope: "SOURCE_KIND",
      mode: "IMMEDIATE",
      sendWelcome: false,
      sendAcceptedMessage: false,
      gateChannelIds: [],
    });
    // Venue d'ailleurs : la règle par défaut, inchangée.
    expect((await resolveRuleWithDb(ids.zone!, null)).scope).toBe("DEFAULT");
  });

  it("une seule fois : relancée, rien n'est créé ni modifié, même après des changements de l'équipe", async () => {
    const zoneEx = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.zone!, scope: "SOURCE_KIND" },
    });
    // L'équipe règle l'exception de Zone (1 jour) et supprime celle de Tir.
    await prisma.approvalRule.update({
      where: { id: zoneEx.id },
      data: { mode: "DELAY", delaySeconds: 86_400 },
    });
    await prisma.approvalRule.deleteMany({ where: { channelId: ids.tir!, scope: "SOURCE_KIND" } });
    const before = await prisma.approvalRule.findMany({ orderBy: { id: "asc" } });
    const r = await createGateExceptions(db);
    expect(r).toMatchObject({ alreadyDone: true, created: [] });
    expect(await prisma.approvalRule.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("passage interrompu (sans la marque) : une exception déjà présente n'est jamais touchée ni doublée", async () => {
    await prisma.setting.delete({ where: { key: GATE_EXCEPTIONS_KEY } });
    const r = await createGateExceptions(db);
    expect(r.skippedExisting.map((c) => c.title).sort()).toEqual(["w", "y", "zone"]);
    const zone = await prisma.approvalRule.findMany({
      where: { channelId: ids.zone!, scope: "SOURCE_KIND" },
    });
    expect(zone).toHaveLength(1);
    expect(zone[0]!.delaySeconds).toBe(86_400);
    expect(await prisma.setting.findUnique({ where: { key: GATE_EXCEPTIONS_KEY } })).not.toBeNull();
  });
});

/**
 * Passage en production : le site démarre (migration appliquée) avant la reprise. Une personne venue du bouton « canal
 * à rejoindre » pendant ce temps tombe sur la règle par défaut du canal obligatoire (1 jour, ou validation à la main).
 * La reprise replanifie ces demandes « tout de suite », sous l'exception créée, sans « Accepté » (comme avant).
 */
describe("reprise phase 11 : demandes arrivées entre la mise en ligne et la reprise", () => {
  const ZONE = -1001500000101n;
  const TIR = -1001500000102n;
  const LYON = -1001500000103n;
  const ids = { zone: "", tir: "", lyon: "" };
  let bot: Bot;
  let workerCalls: TelegramCall[] = [];
  const latest = (tgId: number, channelId: string) =>
    prisma.membership.findFirstOrThrow({
      where: { member: { telegramUserId: BigInt(tgId) }, channelId },
    });
  const titles = new Map<bigint, string>([
    [ZONE, "Zone Interdite"],
    [TIR, "Tir Cadré"],
    [LYON, "Lyon"],
  ]);
  function joinVia(chat: bigint, userId: number, url: string): Update {
    return {
      update_id: userId,
      chat_join_request: {
        chat: { id: Number(chat), type: "channel", title: titles.get(chat)! },
        from: { id: userId, is_bot: false, first_name: `U${userId}`, language_code: "fr" },
        user_chat_id: userId,
        date: Math.floor(Date.now() / 1000) - 5,
        invite_link: {
          invite_link: url,
          creator: { id: 111, is_bot: true, first_name: "bot" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      },
    } as Update;
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: GATE_EXCEPTIONS_KEY } });
    const created = await createBotAndChannel({ chatId: ZONE, title: "Zone Interdite" });
    ids.zone = created.channel.id;
    for (const [key, chatId, title] of [
      ["tir", TIR, "Tir Cadré"],
      ["lyon", LYON, "Lyon"],
    ] as const) {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: created.bot.id,
          isTest: true,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: created.bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      ids[key] = c.id;
    }
    const def = (channelId: string, over: Record<string, unknown>) =>
      prisma.approvalRule.create({
        data: {
          channelId,
          name: "Règle par défaut",
          isDefault: true,
          scope: "DEFAULT",
          reminderAfterMinutes: [],
          maxReminders: 0,
          ...over,
        },
      });
    // Zone exige Tir Cadré et Lyon ; Tir Cadré exige Zone, puis 1 jour ; Lyon : validation à la main.
    await def(ids.zone, {
      mode: "DELAY",
      delaySeconds: 300,
      gateMode: "REQUIRED",
      gateChannelIds: [ids.tir, ids.lyon],
    });
    await def(ids.tir, {
      mode: "DELAY",
      delaySeconds: 86_400,
      gateMode: "REQUIRED",
      gateChannelIds: [ids.zone],
      expireAfterHours: 24,
      expireAction: "DECLINE",
    });
    await def(ids.lyon, { mode: "MANUAL", gateMode: "NONE", gateChannelIds: [] });
    // Boutons « canal à rejoindre » de Zone, créés par le nouveau code (avec demande d'adhésion).
    for (const [channelId, url] of [
      [ids.tir, "https://t.me/+FenetreZoneVersTir"],
      [ids.lyon, "https://t.me/+FenetreZoneVersLyon"],
    ] as const)
      await prisma.inviteLink.create({
        data: {
          channelId,
          botId: created.bot.id,
          telegramInviteLink: url,
          name: `gate:${ids.zone}`,
          kind: "GATE",
          createsJoinRequest: true,
          sourceChannelId: ids.zone,
        },
      });
    bot = createBot(created.bot, prismaTelegramDeps);
    installFakeTelegram(bot.api);
    workerCalls = installFakeTelegram(apiForBot(created.bot));
  });

  it("venues du bouton avant la reprise : replanifiées tout de suite sous l'exception, acceptées sans « Accepté » ; les autres demandes ne bougent pas", async () => {
    // Avant la reprise : règle par défaut (1 jour ; validation à la main), aucun canal imposé.
    await bot.handleUpdate(joinVia(TIR, 7301, "https://t.me/+FenetreZoneVersTir"));
    await bot.handleUpdate(joinVia(LYON, 7302, "https://t.me/+FenetreZoneVersLyon"));
    // Venue d'ailleurs sur Tir Cadré (règle par défaut, doit rejoindre Zone) : jamais touchée.
    await bot.handleUpdate(joinVia(TIR, 7303, "https://t.me/+LienInconnuTir"));
    const tir = await latest(7301, ids.tir);
    expect(tir).toMatchObject({ status: "SCHEDULED" });
    expect(tir.approveAt!.getTime() - tir.requestedAt.getTime()).toBe(86_400_000);
    expect(tir.source).toMatchObject({ appliedRule: { scope: "DEFAULT", noGates: true } });
    expect((await latest(7302, ids.lyon)).status).toBe("REQUESTED");
    const other = await latest(7303, ids.tir);
    expect(other.status).toBe("PENDING_GATE");

    const r = await createGateExceptions(db);
    expect(r.created.map((c) => c.title).sort()).toEqual(["Lyon", "Tir Cadré", "Zone Interdite"]);
    const exTir = r.created.find((c) => c.channelId === ids.tir)!.ruleId;
    const exLyon = r.created.find((c) => c.channelId === ids.lyon)!.ruleId;
    expect(
      r.rescheduled
        .map((x) => [x.title, x.previousStatus])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([
      ["Lyon", "REQUESTED"],
      ["Tir Cadré", "SCHEDULED"],
    ]);

    const now = Date.now();
    for (const [tg, channelId, ruleId] of [
      [7301, ids.tir, exTir],
      [7302, ids.lyon, exLyon],
    ] as const) {
      const m = await latest(tg, channelId);
      expect(m).toMatchObject({ status: "SCHEDULED", approvalRuleId: ruleId, expiresAt: null });
      expect(m.approveAt!.getTime()).toBeLessThanOrEqual(now);
      expect(m.source).toMatchObject({
        provenance: { type: "GATE", sourceChannelId: ids.zone },
        appliedRule: { id: ruleId, scope: "SOURCE_KIND", label: GATE_EXCEPTION_LABEL },
      });
      expect((m.source as { appliedRule: Record<string, unknown> }).appliedRule).not.toHaveProperty(
        "noGates",
      );
    }
    const events = await prisma.event.findMany({ where: { type: "membership.rescheduled" } });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.channelId === ids.tir)!.payload).toMatchObject({
      reason: "phase11_gate_exception",
      ruleId: exTir,
      previousStatus: "SCHEDULED",
      previousRuleId: expect.any(String),
    });
    // Venue d'ailleurs : inchangée.
    expect(await latest(7303, ids.tir)).toEqual(other);

    // Worker : les deux acceptées tout de suite, sans message « Accepté » (comme les anciens liens à entrée directe).
    expect(await processApprovals(fakeJob({ type: "tick" as const }))).toEqual({
      claimed: 2,
      approved: 2,
    });
    expect(
      workerCalls
        .filter((c) => c.method === "approveChatJoinRequest")
        .map((c) => c.payload.user_id)
        .sort(),
    ).toEqual([7301, 7302]);
    expect(await prisma.outboundMessage.count({ where: { kind: "ACCEPTED" } })).toBe(0);

    // Relancée : déjà faite, rien n'est replanifié.
    const again = await createGateExceptions(db);
    expect(again).toMatchObject({ alreadyDone: true, rescheduled: [] });
  });
});
