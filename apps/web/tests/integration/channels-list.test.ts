import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { entryShort } from "@/lib/channels/entry-rule";
import { loadChannelCounts, loadChannelList, loadGateChannelChoices } from "@/lib/channels/queries";
import { createTestBot, resetDb } from "./helpers";

/**
 * Écrans Canaux (phase 9) : lectures sur base réelle.
 * - liste : bots administrateurs non retirés, règle par défaut relue, membres présents (APPROVED) et demandes en
 *   cours (REQUESTED, PENDING_GATE, SCHEDULED, FAILED) par canal, sans mélanger les canaux ;
 * - fiche : mêmes chiffres pour un canal.
 */
describe("liste et fiche des canaux (base réelle)", () => {
  let A = "";
  let B = "";
  let C = "";

  beforeAll(async () => {
    await resetDb();
    const bot1 = await createTestBot(611, "CASINO");
    const bot2 = await createTestBot(612, "SPORTS");
    const mk = (n: number, title: string, extra: Record<string, unknown> = {}) =>
      prisma.channel.create({
        data: { telegramChatId: BigInt(-100_600_000 - n), title, ...extra },
      });
    A = (await mk(1, "Casino VIP", { vertical: "CASINO", primaryBotId: bot1.id })).id;
    B = (await mk(2, "Bonus du jour", { vertical: "CASINO" })).id;
    C = (await mk(3, "Sans bot", { isActive: false })).id;
    await prisma.channelBotAdmin.createMany({
      data: [
        { channelId: A, botId: bot1.id },
        { channelId: A, botId: bot2.id, revokedAt: new Date() },
        { channelId: B, botId: bot2.id },
      ],
    });
    await prisma.approvalRule.create({
      data: {
        channelId: A,
        name: "Règle par défaut",
        isDefault: true,
        mode: "DELAY",
        delaySeconds: 600,
        gateMode: "REQUIRED",
        gateChannelIds: [B],
      },
    });
    // Règle propre à un lien (pas la règle par défaut) : ignorée par la liste.
    await prisma.approvalRule.create({
      data: { channelId: B, name: "Règle de lien", isDefault: false, mode: "IMMEDIATE" },
    });
    const members = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        prisma.member.create({ data: { telegramUserId: BigInt(6_100 + i), firstName: `M${i}` } }),
      ),
    );
    const t = new Date("2026-10-01T10:00:00Z");
    const ms = (memberId: string, channelId: string, status: string, n: number) => ({
      code: `cl-${n}`,
      memberId,
      channelId,
      status: status as never,
      requestedAt: new Date(t.getTime() + n * 1000),
    });
    await prisma.membership.createMany({
      data: [
        ms(members[0]!.id, A, "APPROVED", 1),
        ms(members[1]!.id, A, "APPROVED", 2),
        ms(members[2]!.id, A, "LEFT", 3),
        ms(members[3]!.id, A, "REQUESTED", 4),
        ms(members[4]!.id, A, "PENDING_GATE", 5),
        ms(members[5]!.id, A, "DECLINED", 6),
        ms(members[0]!.id, B, "SCHEDULED", 7),
        ms(members[1]!.id, B, "FAILED", 8),
        ms(members[2]!.id, B, "APPROVED", 9),
      ],
    });
  });

  it("liste : bots, règle, membres et demandes par canal", async () => {
    const list = await loadChannelList();
    const byId = new Map(list.map((c) => [c.id, c]));
    expect(list.map((c) => c.title)).toEqual(["Sans bot", "Bonus du jour", "Casino VIP"]);

    const a = byId.get(A)!;
    expect(a.botAdmins).toEqual(["bot_611"]);
    expect(a.members).toBe(2);
    expect(a.pending).toBe(2);
    expect(a.rule).toMatchObject({
      mode: "DELAY",
      delaySeconds: 600,
      gateMode: "REQUIRED",
      gateChannelIds: [B],
      reminderAfterMinutes: [60, 1440],
      isActive: true,
    });
    expect(entryShort(a.rule)).toBe("Acceptés 10 minutes après avoir rejoint 1 canal");

    const b = byId.get(B)!;
    expect(b.botAdmins).toEqual(["bot_612"]);
    expect(b.rule).toBeNull();
    expect(b.members).toBe(1);
    expect(b.pending).toBe(2);

    const c = byId.get(C)!;
    expect(c).toMatchObject({ botAdmins: [], members: 0, pending: 0, isActive: false, rule: null });
    expect(typeof c.telegramChatId).toBe("string");
  });

  it("fiche : membres présents et demandes en cours d'un canal", async () => {
    expect(await loadChannelCounts(A)).toEqual({ members: 2, pending: 2 });
    expect(await loadChannelCounts(B)).toEqual({ members: 1, pending: 2 });
    expect(await loadChannelCounts(C)).toEqual({ members: 0, pending: 0 });
  });

  it("canaux à rejoindre : actifs, puis ceux de la règle inactifs ou supprimés, visibles et décochables", async () => {
    // La règle de A demande B (actif), C (inactif) et un canal supprimé.
    const choices = await loadGateChannelChoices(A, [B, C, "canal-supprime"]);
    expect(choices.map((c) => [c.title, c.unavailable ?? null])).toEqual([
      ["Sans bot", "inactive"],
      ["Canal supprimé", "deleted"],
      ["Bonus du jour", null],
    ]);
    // Le canal lui-même n'est jamais proposé.
    expect(choices.some((c) => c.id === A)).toBe(false);
    // Sans canal manquant : seulement les autres canaux actifs.
    expect((await loadGateChannelChoices(B, [])).map((c) => c.title)).toEqual(["Casino VIP"]);
  });
});
