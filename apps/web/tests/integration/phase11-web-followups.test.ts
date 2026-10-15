/**
 * Phase 11, côté site : (1) « Accepter » à la main une entrée directe silencieuse (personne venue du bouton « canal à
 * rejoindre » d'un canal sans règle, `source.noRule = "IMMEDIATE"`) n'envoie pas le message « Accepté », comme le
 * worker ; (2) la règle propre d'un lien d'entrée créée en copiant une règle est une exception de portée INVITE_LINK.
 * Base de test réelle, API Telegram simulée (aucun appel réseau).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBotAndChannel, resetDb } from "./helpers";

const telegram = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  n: 0,
}));

vi.mock("grammy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("grammy")>();
  class FakeApi {
    constructor(_token: string) {}
    async approveChatJoinRequest(...args: unknown[]) {
      telegram.calls.push({ method: "approveChatJoinRequest", args });
      return true;
    }
    async createChatInviteLink(...args: unknown[]) {
      telegram.calls.push({ method: "createChatInviteLink", args });
      return { invite_link: `https://t.me/+p11followup${++telegram.n}` };
    }
  }
  return { ...orig, Api: FakeApi };
});

const EMAIL = "phase11-followups@linkaffipro.internal";
const ids = { user: "", bot: "", channel: "", member: "" };

beforeAll(async () => {
  await resetDb();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  ids.user = (
    await prisma.user.create({
      data: { email: EMAIL, name: "Équipe", passwordHash: "x", role: "ADMIN" },
    })
  ).id;
  const { bot, channel } = await createBotAndChannel({ chatId: -100_911_001n, title: "Tir Cadré" });
  ids.bot = bot.id;
  ids.channel = channel.id;
  ids.member = (
    await prisma.member.create({ data: { telegramUserId: 911_001n, firstName: "Léa" } })
  ).id;
});

afterAll(async () => {
  await resetDb();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

async function membership(source: Record<string, unknown>) {
  return prisma.membership.create({
    data: {
      code: `p11-${Object.keys(source).join("-") || "plain"}-${Date.now()}`,
      memberId: ids.member,
      channelId: ids.channel,
      status: "SCHEDULED",
      approveAt: new Date(),
      // Demande de moins de 5 minutes avec `user_chat_id` : le bot peut encore écrire « Accepté » (phase 14).
      userChatId: 911_001n,
      source: source as never,
    },
  });
}

describe("« Accepter » depuis le site", () => {
  it("une entrée directe silencieuse est acceptée sans message « Accepté »", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const m = await membership({ noRule: "IMMEDIATE", provenance: { type: "GATE" } });
    expect(await approveNow(m.id, ids.user)).toEqual({ ok: true });
    expect((await prisma.membership.findUnique({ where: { id: m.id } }))?.status).toBe("APPROVED");
    expect(
      await prisma.outboundMessage.count({ where: { memberId: ids.member, kind: "ACCEPTED" } }),
    ).toBe(0);
  });

  it("une demande ordinaire sans règle reçoit toujours le message « Accepté »", async () => {
    const { approveNow } = await import("@/lib/approval/telegram");
    const m = await membership({});
    expect(await approveNow(m.id, ids.user)).toEqual({ ok: true });
    expect(
      await prisma.outboundMessage.count({ where: { memberId: ids.member, kind: "ACCEPTED" } }),
    ).toBe(1);
  });
});

describe("règle propre d'un lien d'entrée", () => {
  it("copie la règle choisie en exception de portée INVITE_LINK, avec son libellé et son message à l'arrivée", async () => {
    const { createEntryLink } = await import("@/lib/links/create");
    const base = await prisma.approvalRule.create({
      data: {
        channelId: ids.channel,
        name: "Règle par défaut",
        isDefault: true,
        mode: "DELAY",
        delaySeconds: 300,
        sendWelcome: false,
      },
    });
    const { inviteLink } = await createEntryLink({
      channelId: ids.channel,
      name: "Pub TikTok octobre",
      platform: "TIKTOK",
      language: "fr",
      approvalRuleId: base.id,
      userId: ids.user,
    });
    const own = await prisma.approvalRule.findUnique({ where: { inviteLinkId: inviteLink.id } });
    expect(own).toMatchObject({
      scope: "INVITE_LINK",
      isDefault: false,
      label: "Venu du lien « Pub TikTok octobre »",
      sendWelcome: false,
      delaySeconds: 300,
    });
  });
});
