/**
 * Phase 11 (D6) sur base réelle : les anciens liens du bouton « canal à rejoindre » (entrée directe) sont révoqués 7 jours
 * après la mise en ligne, par le bot qui les a créés ; jamais un lien vers un canal désactivé, jamais un lien de moins
 * de 7 jours ; erreur passagère retentée, erreur définitive journalisée ; idempotent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  LEGACY_GATE_REVOKE_KEY,
  runLegacyGateRevocation,
} from "../../src/maintenance/legacy-gate-links";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { processMaintenance } from "../../src/processors/maintenance";
import { fakeJob, resetDb, type TelegramCall } from "./helpers";

const DAY = 86_400_000;

describe("révocation des anciens liens des canaux à rejoindre (entrée directe)", () => {
  const t0 = new Date("2026-10-11T12:00:00Z");
  const links: Record<string, string> = {};
  const calls: TelegramCall[] = [];
  /** Réponse de Telegram par lien (par défaut : révoqué). */
  const failures = new Map<string, { error_code: number; description: string }>();
  let botId = "";

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: LEGACY_GATE_REVOKE_KEY } });
    const bot = await prisma.bot.create({
      data: {
        name: "Bot 444",
        username: "bot_444",
        telegramBotId: 444n,
        tokenEncrypted: encrypt(`444:TEST-TOKEN-${"x".repeat(30)}`),
        vertical: "SPORTS",
        webhookSecret: "secret-444",
      },
    });
    const off = await prisma.bot.create({
      data: {
        name: "Bot 555",
        username: "bot_555",
        telegramBotId: 555n,
        tokenEncrypted: encrypt(`555:TEST-TOKEN-${"x".repeat(30)}`),
        vertical: "SPORTS",
        webhookSecret: "secret-555",
        isActive: false,
      },
    });
    botId = bot.id;
    const ch = (chat: bigint, title: string, isActive = true) =>
      prisma.channel.create({
        data: {
          telegramChatId: chat,
          title,
          type: "CHANNEL",
          language: "fr",
          primaryBotId: bot.id,
          isTest: true,
          isActive,
        },
      });
    const source = await ch(-1001400000001n, "Tir Cadré");
    const gate = await ch(-1001400000002n, "Zone Interdite");
    const paused = await ch(-1001400000003n, "Canal en pause", false);
    const mk = async (
      key: string,
      data: {
        channelId: string;
        createsJoinRequest: boolean;
        createdAt: Date;
        botId?: string;
        isActive?: boolean;
        kind?: "GATE" | "MANUAL";
      },
    ) => {
      const l = await prisma.inviteLink.create({
        data: {
          channelId: data.channelId,
          botId: data.botId ?? bot.id,
          telegramInviteLink: `https://t.me/+${key}`,
          name: `gate:${source.id}`,
          kind: data.kind ?? "GATE",
          createsJoinRequest: data.createsJoinRequest,
          sourceChannelId: source.id,
          isActive: data.isActive ?? true,
          createdAt: data.createdAt,
        },
      });
      links[key] = l.id;
    };
    await mk("ancien", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 30 * DAY),
    });
    await mk("ancienRefuse", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 20 * DAY),
    });
    await mk("ancienSature", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 10 * DAY),
    });
    await mk("ancienBotOff", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 10 * DAY),
      botId: off.id,
    });
    await mk("versPause", {
      channelId: paused.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 30 * DAY),
    });
    await mk("nouveau", {
      channelId: gate.id,
      createsJoinRequest: true,
      createdAt: new Date(t0.getTime() - 30 * DAY),
    });
    // Lien à entrée directe créé après la mise en ligne (canal réactivé depuis) : il vit au moins 7 jours.
    // Le second passage lit l'heure réelle : le lien doit rester récent par rapport à aujourd'hui aussi.
    await mk("recent", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(Math.max(t0.getTime() + 3 * DAY, Date.now() - DAY)),
    });
    await mk("dejaInactif", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 30 * DAY),
      isActive: false,
    });
    await mk("manuel", {
      channelId: gate.id,
      createsJoinRequest: false,
      createdAt: new Date(t0.getTime() - 30 * DAY),
      kind: "MANUAL",
    });
    failures.set("https://t.me/+ancienRefuse", {
      error_code: 400,
      description: "Bad Request: CHAT_ADMIN_REQUIRED",
    });
    failures.set("https://t.me/+ancienSature", {
      error_code: 429,
      description: "Too Many Requests: retry after 1",
    });

    apiForBot(bot).config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      const fail = failures.get(String(p.invite_link));
      if (method === "revokeChatInviteLink" && fail) return { ok: false, ...fail } as never;
      return {
        ok: true,
        result: {
          invite_link: p.invite_link,
          creator: { id: 444, is_bot: true, first_name: "b" },
          creates_join_request: false,
          is_primary: false,
          is_revoked: true,
        },
      } as never;
    });
  });

  const active = async (key: string) =>
    (await prisma.inviteLink.findUniqueOrThrow({ where: { id: links[key]! } })).isActive;

  it("premier passage : date mémorisée (mise en ligne + 7 jours), rien n'est révoqué", async () => {
    const r = await runLegacyGateRevocation({ now: t0 });
    expect(r).toEqual({
      revokeAfter: new Date(t0.getTime() + 7 * DAY).toISOString(),
      due: false,
      revoked: 0,
      disabledOnly: 0,
      retryLater: 0,
    });
    expect(calls).toEqual([]);
    // Un passage plus tard (redémarrage) ne repousse jamais la date.
    const later = await runLegacyGateRevocation({ now: new Date(t0.getTime() + 2 * DAY) });
    expect(later.revokeAfter).toBe(r.revokeAfter);
    expect(
      (await prisma.setting.findUniqueOrThrow({ where: { key: LEGACY_GATE_REVOKE_KEY } })).value,
    ).toBe(r.revokeAfter);
  });

  it("7 jours après : anciens liens révoqués par leur bot, erreurs journalisées, jamais un canal en pause ni un lien récent", async () => {
    const now = new Date(t0.getTime() + 7 * DAY + 60_000);
    const r = await runLegacyGateRevocation({ now });
    expect(r).toMatchObject({ due: true, revoked: 1, disabledOnly: 2, retryLater: 1 });
    const revokes = calls.filter((c) => c.method === "revokeChatInviteLink").map((c) => c.payload);
    expect(revokes).toEqual([
      { chat_id: -1001400000002, invite_link: "https://t.me/+ancien" },
      { chat_id: -1001400000002, invite_link: "https://t.me/+ancienRefuse" },
      { chat_id: -1001400000002, invite_link: "https://t.me/+ancienSature" },
    ]);
    expect(await active("ancien")).toBe(false);
    expect(await active("ancienRefuse")).toBe(false);
    expect(await active("ancienBotOff")).toBe(false);
    // Erreur passagère (429) : retentée au passage suivant.
    expect(await active("ancienSature")).toBe(true);
    // Jamais touchés : canal en pause (son lien à entrée directe sert encore), lien avec demande d'adhésion, lien récent, lien manuel.
    expect(await active("versPause")).toBe(true);
    expect(await active("nouveau")).toBe(true);
    expect(await active("recent")).toBe(true);
    expect(await active("manuel")).toBe(true);

    const events = await prisma.event.findMany({
      where: { type: "invite_link.legacy_revoked" },
      orderBy: { occurredAt: "asc" },
    });
    const byLink = new Map(
      events.map((e) => [
        (e.payload as { inviteLinkId: string }).inviteLinkId,
        e.payload as Record<string, unknown>,
      ]),
    );
    expect(byLink.get(links.ancien!)).toMatchObject({ revokedOnTelegram: true, error: null });
    expect(byLink.get(links.ancienRefuse!)).toMatchObject({
      revokedOnTelegram: false,
      error: "400 Bad Request: CHAT_ADMIN_REQUIRED",
    });
    expect(byLink.get(links.ancienBotOff!)).toMatchObject({ revokedOnTelegram: false });
    expect(events.every((e) => e.botId !== null)).toBe(true);
  });

  it("passage suivant (tâche de la file maintenance) : l'erreur passagère est reprise, rien n'est révoqué deux fois", async () => {
    failures.delete("https://t.me/+ancienSature");
    // La tâche périodique lit l'heure réelle : date de révocation passée (mémorisée il y a plus de 7 jours).
    await prisma.setting.update({
      where: { key: LEGACY_GATE_REVOKE_KEY },
      data: { value: new Date(Date.now() - 60_000).toISOString() },
    });
    const before = calls.length;
    const r = (await processMaintenance(fakeJob({ type: "legacy-gate-links" as const }))) as {
      revoked: number;
    };
    expect(r.revoked).toBe(1);
    expect(calls.slice(before).map((c) => c.payload.invite_link)).toEqual([
      "https://t.me/+ancienSature",
    ]);
    expect(await active("ancienSature")).toBe(false);
    const again = await runLegacyGateRevocation();
    expect(again).toMatchObject({ revoked: 0, disabledOnly: 0, retryLater: 0 });
    expect(await prisma.event.count({ where: { type: "invite_link.legacy_revoked", botId } })).toBe(
      3,
    );
  });
});
