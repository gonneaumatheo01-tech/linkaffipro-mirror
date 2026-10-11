/**
 * Phase 11, fiche canal → « Liens de partage » et suivi par provenance, sur base réelle (Telegram simulé, aucun appel
 * réseau) : un responsable crée un lien nommé « à poster dans » Tir Cadré (créé AVEC demande d'adhésion par le bot qui
 * agit pour le canal, ou un autre de nos bots administrateurs), le journal de l'équipe, une demande par ce lien via la
 * vraie route du webhook (provenance, règle « venu de Tir Cadré → 1 jour », compteurs), la ligne affichée dans les
 * demandes, les statistiques par provenance (demandes, acceptées, départs dans les 7 jours), puis la désactivation
 * (révocation par le bot créateur), les refus expliqués en français et les droits.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import {
  createTestBot,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER";
    telegramUserId: bigint | null;
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  },
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const { createShareLinkAction, disableShareLinkAction } =
  await import("@/app/(admin)/channels/[id]/share-links-actions");
const { loadShareLinks } = await import("@/lib/channels/share-links");
const { loadProvenanceStats } = await import("@/lib/channels/provenance-stats");
const { provenanceLine } = await import("@/lib/channels/provenance-display");
const { POST } = await import("@/app/api/telegram/[botId]/route");

const ZONE = -1001810000001n;
const TIR = -1001810000002n;

/** Telegram simulé par bot : liens uniques, refus à la demande, révocations consignées. */
class FakeTelegram {
  refuse = new Set<number>();
  down = new Set<number>();
  private n = 0;
  install(api: Api, selfId: number): TelegramCall[] {
    const calls: TelegramCall[] = [];
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (this.down.has(selfId))
        return { ok: false, error_code: 502, description: "Bad Gateway" } as never;
      if (method === "createChatInviteLink" || method === "revokeChatInviteLink") {
        if (this.refuse.has(selfId))
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: not enough rights to manage chat invite links",
          } as never;
        if (method === "revokeChatInviteLink")
          return {
            ok: true,
            result: { invite_link: p.invite_link, is_revoked: true, creates_join_request: true },
          } as never;
        return {
          ok: true,
          result: {
            invite_link: `https://t.me/+partage${selfId}x${++this.n}`,
            creator: { id: selfId, is_bot: true, first_name: "bot" },
            creates_join_request: p.creates_join_request === true,
            is_primary: false,
            is_revoked: false,
            name: p.name,
          },
        } as never;
      }
      if (/^send(Message|Photo|Video|Animation|Document)$/.test(method))
        return {
          ok: true,
          result: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(p.chat_id), type: "private" },
            text: p.text ?? "",
          },
        } as never;
      return { ok: true, result: true } as never;
    });
    return calls;
  }
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

let updateId = 9100;
function joinRequest(chatId: bigint, userId: number, link: string) {
  return {
    update_id: updateId++,
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: "Zone Interdite 🔞" },
      from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
      invite_link: {
        invite_link: link,
        creator: { id: 811, is_bot: true, first_name: "b" },
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
    },
  };
}

describe("liens de partage et suivi par provenance (base réelle)", () => {
  const tg = new FakeTelegram();
  const calls: Record<string, TelegramCall[]> = {};
  const ids = { zone: "", tir: "", main: "", backup: "", manager: "", admin: "", link: "" };
  let linkUrl = "";

  beforeAll(async () => {
    await resetDb();
    const main = await createTestBot(811, "DATING");
    const backup = await createTestBot(812, "DATING");
    const sports = await createTestBot(813, "SPORTS");
    ids.main = main.id;
    ids.backup = backup.id;
    calls.main = tg.install(getOrCreateBot(main, prismaTelegramDeps).api, 811);
    calls.backup = tg.install(getOrCreateBot(backup, prismaTelegramDeps).api, 812);
    calls.sports = tg.install(getOrCreateBot(sports, prismaTelegramDeps).api, 813);
    const channel = async (chatId: bigint, title: string, primary: string, admins: string[]) => {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title,
          language: "fr",
          primaryBotId: primary,
          isTest: true,
        },
      });
      for (const botId of admins)
        await prisma.channelBotAdmin.create({
          data: {
            channelId: c.id,
            botId,
            rights: { status: "administrator", can_invite_users: true },
          },
        });
      return c.id;
    };
    ids.zone = await channel(ZONE, "Zone Interdite 🔞", main.id, [main.id, backup.id]);
    ids.tir = await channel(TIR, "Tir Cadré", sports.id, [sports.id]);
    // Zone Interdite : 5 minutes par défaut ; venue de Tir Cadré → 1 jour (exemple du client).
    await prisma.approvalRule.create({
      data: {
        channelId: ids.zone,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 300,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    await prisma.approvalRule.create({
      data: {
        channelId: ids.zone,
        name: "Venu de « Tir Cadré »",
        label: "Venu de « Tir Cadré »",
        scope: "SOURCE_CHANNEL",
        sourceChannelId: ids.tir,
        sortOrder: 10,
        mode: "DELAY",
        delaySeconds: 86_400,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    const stamp = Date.now();
    const manager = await prisma.user.create({
      data: {
        email: `share-m-${stamp}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: `share-a-${stamp}@test.local`,
        passwordHash: "x",
        name: "Admin",
        role: "ADMIN",
      },
    });
    ids.manager = manager.id;
    ids.admin = admin.id;
  });

  beforeEach(() => {
    tg.refuse.clear();
    tg.down.clear();
    session.user = {
      id: ids.manager,
      email: "m@test.local",
      name: "Resp",
      role: "MANAGER",
      telegramUserId: null,
    };
  });

  it("un responsable crée « Post Tir Cadré » à poster dans Tir Cadré : avec demande d'adhésion, par le bot du canal", async () => {
    const r = await createShareLinkAction(
      null,
      fd({ channelId: ids.zone, name: "Post Tir Cadré", sourceChannelId: ids.tir }),
    );
    expect(r?.error).toBeUndefined();
    expect(r?.created?.name).toBe("Post Tir Cadré");
    linkUrl = r!.created!.url;
    ids.link = r!.created!.id;
    const create = calls.main!.filter((c) => c.method === "createChatInviteLink");
    expect(create).toHaveLength(1);
    expect(create[0]!.payload).toMatchObject({
      chat_id: Number(ZONE),
      name: "Post Tir Cadré",
      creates_join_request: true,
    });
    const row = await prisma.inviteLink.findUniqueOrThrow({ where: { id: ids.link } });
    expect(row).toMatchObject({
      channelId: ids.zone,
      botId: ids.main,
      kind: "SHARE",
      createsJoinRequest: true,
      sourceChannelId: ids.tir,
      isActive: true,
      createdById: ids.manager,
      telegramInviteLink: linkUrl,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "invite_link.share_created", entityId: ids.link },
    });
    expect(audit).toMatchObject({ userId: ids.manager, entityType: "InviteLink" });
    expect(audit.metadata).toMatchObject({
      channelId: ids.zone,
      sourceChannelId: ids.tir,
      botId: ids.main,
    });

    const view = await loadShareLinks(ids.zone);
    expect(view.bot).toBe("bot_811");
    expect(view.channels.map((c) => c.title)).toEqual(["Tir Cadré"]);
    expect(view.links).toEqual([
      expect.objectContaining({
        id: ids.link,
        name: "Post Tir Cadré",
        url: linkUrl,
        isActive: true,
        postedIn: "Tir Cadré",
        requests: 0,
        accepted: 0,
        rule: "Règle : 1 jour (Venu de « Tir Cadré »)",
        ownException: false,
      }),
    ]);
  });

  it("une demande par ce lien (vraie route du webhook) : provenance, règle 1 jour, compteurs, ligne des demandes", async () => {
    const res = await POST(
      webhookRequest(joinRequest(ZONE, 77001, linkUrl), "secret-811"),
      ctx({ botId: ids.main }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    const m = await prisma.membership.findFirstOrThrow({
      where: { channelId: ids.zone, member: { telegramUserId: 77001n } },
      include: { inviteLink: true, approvalRule: true },
    });
    expect(m.inviteLinkId).toBe(ids.link);
    expect(m.status).toBe("SCHEDULED");
    expect((m.source as { provenance?: unknown }).provenance).toMatchObject({
      type: "SHARE",
      inviteLinkId: ids.link,
      sourceChannelId: ids.tir,
    });
    expect((m.source as { appliedRule?: unknown }).appliedRule).toMatchObject({
      scope: "SOURCE_CHANNEL",
    });
    expect(m.approveAt!.getTime() - m.requestedAt.getTime()).toBe(86_400_000);
    expect(provenanceLine(m, { [ids.tir]: "Tir Cadré" }, m.requestedAt)).toMatch(
      /^Venu du lien de partage « Post Tir Cadré » · règle : 1 jour · acceptation prévue le \d+ \S+ à \d+ h \d{2}$/,
    );
    let view = await loadShareLinks(ids.zone);
    expect(view.links[0]).toMatchObject({ requests: 1, accepted: 0 });
    await prisma.membership.update({
      where: { id: m.id },
      data: { status: "APPROVED", approvedAt: new Date(), joinedAt: new Date() },
    });
    view = await loadShareLinks(ids.zone);
    expect(view.links[0]).toMatchObject({ requests: 1, accepted: 1 });
  });

  it("statistiques par provenance sur 30 jours : demandes, acceptées, départs dans les 7 jours", async () => {
    const now = new Date();
    const day = 86_400_000;
    const tirGate = await prisma.inviteLink.create({
      data: {
        channelId: ids.zone,
        botId: ids.main,
        telegramInviteLink: "https://t.me/+boutonTir",
        name: "Bouton Tir Cadré",
        kind: "GATE",
        sourceChannelId: ids.tir,
      },
    });
    const tiktok = await prisma.inviteLink.create({
      data: {
        channelId: ids.zone,
        botId: ids.main,
        telegramInviteLink: "https://t.me/+pubTikTok",
        name: "Pub TikTok 1",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
      },
    });
    let nextUser = 78000;
    const add = async (
      inviteLinkId: string | null,
      at: Date,
      data: Partial<{
        status: "SCHEDULED" | "APPROVED" | "LEFT" | "KICKED";
        joinedAt: Date;
        leftAt: Date;
      }> = {},
    ) => {
      const member = await prisma.member.create({
        data: { telegramUserId: BigInt(++nextUser), firstName: "M" },
      });
      await prisma.membership.create({
        data: {
          code: `stat${nextUser}`,
          memberId: member.id,
          channelId: ids.zone,
          inviteLinkId,
          requestedAt: at,
          status: data.status ?? "SCHEDULED",
          joinedAt: data.joinedAt ?? null,
          approvedAt: data.joinedAt ?? null,
          leftAt: data.leftAt ?? null,
        },
      });
    };
    const ago = (d: number) => new Date(now.getTime() - d * day);
    // Bouton « canal à rejoindre » de Tir Cadré : 3 demandes, 2 acceptées, 1 départ au bout de 2 jours.
    await add(tirGate.id, ago(20), { status: "LEFT", joinedAt: ago(20), leftAt: ago(18) });
    await add(tirGate.id, ago(10), { status: "APPROVED", joinedAt: ago(10) });
    await add(tirGate.id, ago(1));
    // Pub TikTok : 2 demandes acceptées ; un départ après 8 jours (non compté), une exclusion (non comptée).
    await add(tiktok.id, ago(25), { status: "LEFT", joinedAt: ago(25), leftAt: ago(17) });
    await add(tiktok.id, ago(5), { status: "KICKED", joinedAt: ago(5), leftAt: ago(4) });
    // Sans lien suivi : 1 demande ; une demande d'il y a 40 jours n'est pas comptée.
    await add(null, ago(3));
    await add(null, ago(40), { status: "APPROVED", joinedAt: ago(40) });

    const stats = await loadProvenanceStats(ids.zone, now);
    expect(stats.rows.map((r) => [r.label, r.requests, r.accepted, r.left7])).toEqual([
      ["Bouton « canal à rejoindre » de « Tir Cadré »", 3, 2, 1],
      ["Pubs TikTok", 2, 2, 0],
      ["Lien de partage « Post Tir Cadré »", 1, 1, 0],
      ["Autres liens", 1, 0, 0],
    ]);
    expect(stats.totals).toEqual({ requests: 7, accepted: 5, left7: 1 });
  });

  it("le bot du canal n'a pas le droit : un autre de nos bots administrateurs crée le lien", async () => {
    tg.refuse.add(811);
    const r = await createShareLinkAction(
      null,
      fd({ channelId: ids.zone, name: "Story Instagram" }),
    );
    expect(r?.error).toBeUndefined();
    const row = await prisma.inviteLink.findUniqueOrThrow({ where: { id: r!.created!.id } });
    expect(row).toMatchObject({ botId: ids.backup, sourceChannelId: null, kind: "SHARE" });
    const view = await loadShareLinks(ids.zone);
    expect(view.links.map((l) => l.name)).toEqual(["Story Instagram", "Post Tir Cadré"]);
    expect(view.links[0]).toMatchObject({ postedIn: null, rule: "Règle par défaut : 5 minutes" });
    // Montré à zéro dans les statistiques (lien actif sans demande).
    const stats = await loadProvenanceStats(ids.zone);
    expect(stats.rows.find((x) => x.label === "Lien de partage « Story Instagram »")).toMatchObject(
      {
        requests: 0,
      },
    );
  });

  it("refus : expliqué en français, rien n'est créé ; nom déjà pris ; Telegram injoignable", async () => {
    tg.refuse.add(811);
    tg.refuse.add(812);
    const before = await prisma.inviteLink.count({ where: { kind: "SHARE" } });
    const r = await createShareLinkAction(null, fd({ channelId: ids.zone, name: "Post TikTok" }));
    expect(r?.error).toBe(
      "Telegram refuse que @bot_811 crée un lien dans « Zone Interdite 🔞 ». Ajoutez @bot_811 comme administrateur de « Zone Interdite 🔞 » avec le droit « Inviter via un lien », puis réessayez.",
    );
    tg.refuse.clear();
    expect(
      (await createShareLinkAction(null, fd({ channelId: ids.zone, name: "post tir cadré" })))
        ?.error,
    ).toBe(
      "Un lien de partage actif s'appelle déjà « post tir cadré » dans ce canal : choisissez un autre nom.",
    );
    tg.down.add(811);
    expect(
      (await createShareLinkAction(null, fd({ channelId: ids.zone, name: "Post TikTok" })))?.error,
    ).toBe("Telegram ne répond pas pour l'instant : réessayez dans une minute.");
    expect(await prisma.inviteLink.count({ where: { kind: "SHARE" } })).toBe(before);
  });

  it("un responsable désactive « Post Tir Cadré » : révoqué par le bot qui l'a créé, inactif, journal ; chiffres gardés", async () => {
    const r = await disableShareLinkAction(fd({ channelId: ids.zone, linkId: ids.link }));
    expect(r).toEqual({
      ok: "Lien « Post Tir Cadré » désactivé : il ne fonctionne plus dans Telegram. Les demandes déjà reçues restent.",
    });
    const revoke = calls.main!.filter((c) => c.method === "revokeChatInviteLink");
    expect(revoke.map((c) => c.payload)).toEqual([{ chat_id: Number(ZONE), invite_link: linkUrl }]);
    expect(calls.backup!.some((c) => c.method === "revokeChatInviteLink")).toBe(false);
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: ids.link } })).isActive).toBe(
      false,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "invite_link.share_disabled", entityId: ids.link },
    });
    expect(audit).toMatchObject({ userId: ids.manager, entityType: "InviteLink" });
    expect(audit.metadata).toMatchObject({ revokedOnTelegram: true, error: null });
    const view = await loadShareLinks(ids.zone);
    expect(view.links.map((l) => [l.name, l.isActive, l.requests, l.accepted])).toEqual([
      ["Story Instagram", true, 0, 0],
      ["Post Tir Cadré", false, 1, 1],
    ]);
    // Le nom est de nouveau libre pour un nouveau lien actif.
    expect(
      (await createShareLinkAction(null, fd({ channelId: ids.zone, name: "Post Tir Cadré" })))
        ?.created,
    ).toBeTruthy();
  });

  it("Telegram refuse la révocation (bot retiré) : désactivé ici, et l'écran le dit ; sans session : connexion", async () => {
    const story = (await loadShareLinks(ids.zone)).links.find((l) => l.name === "Story Instagram")!;
    tg.refuse.add(812);
    const r = await disableShareLinkAction(fd({ channelId: ids.zone, linkId: story.id }));
    expect(r.error).toMatch(
      /^Lien « Story Instagram » désactivé ici, mais Telegram n'a pas pu le retirer \(@bot_812/,
    );
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: story.id } })).isActive).toBe(
      false,
    );
    session.user = null;
    await expect(
      disableShareLinkAction(fd({ channelId: ids.zone, linkId: story.id })),
    ).rejects.toThrow("NEXT_REDIRECT");
    await expect(
      createShareLinkAction(null, fd({ channelId: ids.zone, name: "X" })),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
