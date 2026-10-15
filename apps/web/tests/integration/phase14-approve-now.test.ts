/**
 * Phase 14, « Accepter » depuis le site (`approveNow`) : le message « Accepté » n'est mis en file que si le bot peut
 * encore écrire à la personne (elle a démarré le bot ou appuyé sur un de ses boutons, ou sa demande a moins de 5
 * minutes). Sinon : aucun message, événement `dm.skipped_unreachable`. Base réelle, API Telegram simulée.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBotAndChannel, resetDb } from "./helpers";

vi.mock("grammy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("grammy")>();
  class FakeApi {
    constructor(_token: string) {}
    async approveChatJoinRequest() {
      return true;
    }
  }
  return { ...orig, Api: FakeApi };
});

const EMAIL = "p14-approve-now@linkaffipro.internal";
const ids = { user: "", bot: "", channel: "" };

beforeAll(async () => {
  await resetDb();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  ids.user = (
    await prisma.user.create({
      data: { email: EMAIL, name: "Équipe", passwordHash: "x", role: "ADMIN" },
    })
  ).id;
  const { bot, channel } = await createBotAndChannel({ chatId: -100_914_001n, title: "Zone" });
  ids.bot = bot.id;
  ids.channel = channel.id;
});

afterAll(async () => {
  await resetDb();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

async function request(tg: number, ageMs: number) {
  const member = await prisma.member.create({
    data: { telegramUserId: BigInt(tg), firstName: `U${tg}` },
  });
  const m = await prisma.membership.create({
    data: {
      code: `p14an${tg}`,
      memberId: member.id,
      channelId: ids.channel,
      status: "SCHEDULED",
      approveAt: new Date(),
      userChatId: BigInt(tg),
      requestedAt: new Date(Date.now() - ageMs),
    },
  });
  return { member, m };
}

describe("« Accepter » depuis le site (phase 14)", () => {
  it("demande d'une heure, bot jamais démarré : acceptée, mais aucun « Accepté » (Telegram refuserait)", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const { member, m } = await request(914_101, 3600_000);
    expect(await approveNow(m.id, ids.user)).toEqual({ ok: true });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      "APPROVED",
    );
    expect(
      await prisma.outboundMessage.count({ where: { memberId: member.id, kind: "ACCEPTED" } }),
    ).toBe(0);
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "dm.skipped_unreachable", memberId: member.id },
    });
    expect(ev.payload).toEqual({
      membershipId: m.id,
      kind: "ACCEPTED",
      reason: "never_started",
      manual: true,
    });
  });

  it("personne qui a démarré le bot : « Accepté » mis en file, même longtemps après la demande", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const { member, m } = await request(914_102, 3600_000);
    await prisma.memberBotState.create({
      data: { memberId: member.id, botId: ids.bot, canDm: true, startedAt: new Date() },
    });
    expect(await approveNow(m.id, ids.user)).toEqual({ ok: true });
    expect(
      await prisma.outboundMessage.count({ where: { memberId: member.id, kind: "ACCEPTED" } }),
    ).toBe(1);
  });

  it("personne qui a bloqué le bot : jamais « Accepté »", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const { member, m } = await request(914_103, 60_000);
    await prisma.memberBotState.create({
      data: {
        memberId: member.id,
        botId: ids.bot,
        canDm: false,
        startedAt: new Date(),
        blockedAt: new Date(),
      },
    });
    expect(await approveNow(m.id, ids.user)).toEqual({ ok: true });
    expect(
      await prisma.outboundMessage.count({ where: { memberId: member.id, kind: "ACCEPTED" } }),
    ).toBe(0);
  });
});
