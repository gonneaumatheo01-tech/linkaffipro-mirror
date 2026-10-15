import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import {
  getOrCreateBot,
  listGateLinksMissing,
  prismaTelegramDeps,
  resendGateWelcomeWithDb,
} from "@linkaffipro/telegram";
import { POST } from "@/app/api/telegram/[botId]/route";
import {
  createTestBot,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

/**
 * Liens des canaux à rejoindre (bug du 11 octobre) sur base réelle : le canal « Rencontres » est géré par le bot
 * rencontres, les canaux à rejoindre chacun par un AUTRE de nos bots (casino, paris sportifs). Telegram est simulé
 * bot par bot : un bot ne crée un lien et ne lit les membres que dans les canaux dont il est administrateur.
 */

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
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

const { resendGateWelcomeAction } = await import("@/lib/approval/resend-welcome-action");
const { saveRuleAction, checkGateLinksAction } =
  await import("@/app/(admin)/channels/[id]/actions");
const { loadGateLinkView } = await import("@/lib/channels/gate-links-server");
const { entryRuleFromRow } = await import("@/lib/channels/entry-rule");
const { loadTodoInput } = await import("@/lib/home/queries");
const { buildTodo } = await import("@/lib/home/todo");

/** Telegram simulé : administrateurs (identifiants de nos bots) et membres de chaque canal. */
class GateWorld {
  readonly admins = new Map<number, Set<number>>();
  readonly members = new Map<number, Set<number>>();

  chat(id: bigint, admins: number[]) {
    this.admins.set(Number(id), new Set(admins));
    this.members.set(Number(id), new Set());
  }

  install(api: Api, selfId: number): TelegramCall[] {
    const calls: TelegramCall[] = [];
    let nextId = 7000;
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      const chat = Number(p.chat_id);
      const isAdmin = this.admins.get(chat)?.has(selfId) ?? false;
      if (method === "createChatInviteLink") {
        if (!isAdmin)
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: not enough rights to manage chat invite links",
          } as never;
        return {
          ok: true,
          result: {
            invite_link: `https://t.me/+g${selfId}x${String(chat).slice(-4)}`,
            creator: { id: selfId, is_bot: true, first_name: "bot" },
            creates_join_request: false,
            is_primary: false,
            is_revoked: false,
          },
        } as never;
      }
      if (method === "getChatMember") {
        if (!isAdmin)
          return {
            ok: false,
            error_code: 403,
            description: "Forbidden: bot is not a member of the channel chat",
          } as never;
        const user = Number(p.user_id);
        return {
          ok: true,
          result: {
            status: this.members.get(chat)?.has(user) ? "member" : "left",
            user: { id: user, is_bot: false, first_name: "x" },
          },
        } as never;
      }
      if (/^send(Message|Photo|Video|Animation|Document)$/.test(method))
        return {
          ok: true,
          result: {
            message_id: nextId++,
            date: Math.floor(Date.now() / 1000),
            chat: { id: chat, type: "private" },
            text: p.text ?? "",
          },
        } as never;
      return { ok: true, result: true } as never;
    });
    return calls;
  }
}

const ZONE = -1001100000001n;
const ROULETTE = -1001100000002n;
const TIR = -1001100000003n;
const LYON = -1001100000004n;
const PRIVE = -1001100000005n;

/** Titres réels : le bot met à jour le nom du canal d'après chaque update reçue. */
const TITLES = new Map<bigint, string>([
  [-1001100000001n, "Zone Interdite 🔞"],
  [-1001100000004n, "Rencontres Lyon"],
]);

function joinRequest(chatId: bigint, userId: number, updateId: number) {
  return {
    update_id: updateId,
    chat_join_request: {
      chat: { id: Number(chatId), type: "channel", title: TITLES.get(chatId) ?? "Canal" },
      from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
      user_chat_id: userId,
      date: Math.floor(Date.now() / 1000) - 5,
    },
  };
}
function startCommand(userId: number, payload: string, updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private", first_name: `Membre${userId}` },
      from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
      text: `/start ${payload}`,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
}

type Buttons = Array<Array<{ text: string; url?: string; callbackData?: string }>>;

describe("liens des canaux à rejoindre gérés par d'autres bots (base réelle)", () => {
  const world = new GateWorld();
  const calls = new Map<string, TelegramCall[]>();
  let dating: Awaited<ReturnType<typeof createTestBot>>;
  let casino: Awaited<ReturnType<typeof createTestBot>>;
  let sports: Awaited<ReturnType<typeof createTestBot>>;
  const ids = { zone: "", roulette: "", tir: "", lyon: "", prive: "" };
  let userId = "";

  async function channel(
    chatId: bigint,
    title: string,
    vertical: "CASINO" | "SPORTS" | "DATING",
    botId: string,
    admins: string[],
  ) {
    const c = await prisma.channel.create({
      data: {
        telegramChatId: chatId,
        title,
        vertical,
        language: "fr",
        primaryBotId: botId,
        isTest: true,
      },
    });
    for (const b of admins)
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: b,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
    return c.id;
  }

  async function post(update: unknown) {
    const res = await POST(webhookRequest(update, "secret-333"), ctx({ botId: dating.id }));
    expect(res.status).toBe(200);
    await flushAfter();
  }

  beforeAll(async () => {
    await resetDb();
    dating = await createTestBot(333, "DATING");
    casino = await createTestBot(111, "CASINO");
    sports = await createTestBot(222, "SPORTS");
    for (const b of [dating, casino, sports])
      calls.set(
        b.id,
        world.install(getOrCreateBot(b, prismaTelegramDeps).api, Number(b.telegramBotId)),
      );
    world.chat(ZONE, [333]);
    world.chat(ROULETTE, [111]);
    world.chat(TIR, [222]);
    world.chat(LYON, [333]);
    world.chat(PRIVE, []);
    ids.zone = await channel(ZONE, "Zone Interdite 🔞", "DATING", dating.id, [dating.id]);
    ids.roulette = await channel(ROULETTE, "LA ZONE ROULETTE 🎰", "CASINO", casino.id, [casino.id]);
    ids.tir = await channel(TIR, "🎯 TIR CADRÉ ⚡", "SPORTS", sports.id, [sports.id]);
    ids.lyon = await channel(LYON, "Rencontres Lyon", "DATING", dating.id, [dating.id]);
    ids.prive = await channel(PRIVE, "Canal privé sans bot", "CASINO", casino.id, []);
    const rule = (gate: string[]) => ({
      name: "Règle par défaut",
      isDefault: true,
      mode: "DELAY" as const,
      delaySeconds: 600,
      gateMode: "REQUIRED" as const,
      gateChannelIds: gate,
      reminderAfterMinutes: [],
      maxReminders: 0,
    });
    await prisma.approvalRule.create({
      data: { channelId: ids.zone, ...rule([ids.roulette, ids.tir]) },
    });
    await prisma.approvalRule.create({ data: { channelId: ids.lyon, ...rule([ids.prive]) } });
    // Compte propre à ce passage (la base de test garde les comptes et le journal d'audit d'un passage à l'autre).
    const user = await prisma.user.create({
      data: {
        email: `liens-${Date.now()}@gate.test.local`,
        passwordHash: "x",
        name: "Équipe",
        role: "MANAGER",
      },
    });
    userId = user.id;
    session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: "MANAGER",
      telegramUserId: null,
    };
  });

  it("cas du client : liens créés par le bot de chaque canal, accueil avec les boutons, « J'ai rejoint » accepté", async () => {
    await post(joinRequest(ZONE, 9001, 1));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 9001n } });
    let m = await prisma.membership.findFirstOrThrow({
      where: { memberId: member.id, channelId: ids.zone },
    });
    expect(m.status).toBe("PENDING_GATE");

    // Le bot de chaque canal à rejoindre crée le lien directement (c'est lui qui recevra la demande : Telegram
    // masquerait la fin d'un lien créé par un autre bot) ; le bot rencontres n'essaie même pas.
    const datingCreates = calls.get(dating.id)!.filter((c) => c.method === "createChatInviteLink");
    expect(datingCreates.map((c) => c.payload.chat_id)).toEqual([]);
    const gates = await prisma.inviteLink.findMany({
      where: { kind: "GATE", sourceChannelId: ids.zone },
      orderBy: { createdAt: "asc" },
    });
    expect(gates.map((g) => [g.channelId, g.botId])).toEqual([
      [ids.roulette, casino.id],
      [ids.tir, sports.id],
    ]);

    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    const buttons = welcome.buttons as Buttons;
    expect(buttons.map((r) => r[0]!.text)).toEqual([
      "Rejoindre LA ZONE ROULETTE 🎰",
      "Rejoindre 🎯 TIR CADRÉ ⚡",
      "✅ J'ai rejoint",
    ]);
    expect(buttons[0]![0]!.url).toBe(gates[0]!.telegramInviteLink);
    // Phase 14 : « ✅ J'ai rejoint » est un bouton à rappel (l'ancien lien /start g… reste valable).
    expect(buttons[2]![0]!.callbackData).toBe(`g:${m.code}`);
    expect((m.source as { gateLinksMissing?: unknown[] }).gateLinksMissing).toEqual([]);
    expect(await listGateLinksMissing({ channelId: ids.zone })).toEqual([]);

    // Le membre rejoint les deux canaux puis appuie sur « J'ai rejoint » : vérifié par les bots casino et sports.
    world.members.get(Number(ROULETTE))!.add(9001);
    world.members.get(Number(TIR))!.add(9001);
    await post(startCommand(9001, `g${m.code}`, 2));
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt!.getTime() - m.gateSatisfiedAt!.getTime()).toBe(600_000);
    expect(calls.get(casino.id)!.some((c) => c.method === "getChatMember")).toBe(true);
    expect(calls.get(sports.id)!.some((c) => c.method === "getChatMember")).toBe(true);

    // Demande suivante : les liens existants sont réutilisés, aucun nouvel appel de création.
    const before = [...calls.values()]
      .flat()
      .filter((c) => c.method === "createChatInviteLink").length;
    await post(joinRequest(ZONE, 9002, 3));
    const after = [...calls.values()]
      .flat()
      .filter((c) => c.method === "createChatInviteLink").length;
    expect(after).toBe(before);
  });

  it("aucun bot administrateur : accueil avec « J'ai rejoint », événement, point « À faire » ; jamais d'accueil muet", async () => {
    await post(joinRequest(LYON, 9101, 10));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 9101n } });
    const m = await prisma.membership.findFirstOrThrow({
      where: { memberId: member.id, channelId: ids.lyon },
    });
    expect(m.status).toBe("PENDING_GATE");
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    expect(welcome.buttons).toEqual([[{ text: "✅ J'ai rejoint", callbackData: `g:${m.code}` }]]);
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "membership.gate_links_missing", memberId: member.id },
    });
    const missing = (ev.payload as { missing: Array<{ title: string; error: string }> }).missing;
    expect(missing.map((p) => p.title)).toEqual(["Canal privé sans bot"]);
    expect(missing[0]!.error).toBe(
      "@bot_333 : 400 Bad Request: not enough rights to manage chat invite links",
    );

    const rows = await listGateLinksMissing();
    expect(rows.map((r) => [r.membershipId, r.channelTitle])).toEqual([[m.id, "Rencontres Lyon"]]);
    const todo = await loadTodoInput({ role: "MANAGER", telegramUserId: null });
    expect(todo.gateLinksMissing).toEqual([
      {
        channelId: ids.lyon,
        channelTitle: "Rencontres Lyon",
        count: 1,
        missingTitles: ["Canal privé sans bot"],
        uncheckedTitles: [],
      },
    ]);
    expect(buildTodo(todo)[0]).toMatchObject({
      key: `gate-links:${ids.lyon}`,
      action: { kind: "resend-gate-welcome", channelId: ids.lyon },
    });
  });

  async function resend(channelId: string): Promise<URLSearchParams> {
    const f = new FormData();
    f.append("channelId", channelId);
    f.append("returnTo", "/");
    try {
      await resendGateWelcomeAction(f);
    } catch (err) {
      const url = (err as { url?: string }).url ?? "";
      return new URLSearchParams(url.split("?")[1] ?? "");
    }
    throw new Error("redirection attendue");
  }

  it("« Renvoyer l'accueil avec les liens » : droits, liens toujours impossibles, puis renvoi après correction, audit", async () => {
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 9101n } });
    const welcomes = () =>
      prisma.outboundMessage.count({ where: { memberId: member.id, kind: "WELCOME" } });
    expect(await welcomes()).toBe(1);

    // Personne non connectée : rien.
    const saved = session.user;
    session.user = null;
    const f = new FormData();
    f.append("channelId", ids.lyon);
    await expect(resendGateWelcomeAction(f)).rejects.toMatchObject({ url: "/login" });
    session.user = saved;
    expect(await welcomes()).toBe(1);

    // Toujours aucun bot administrateur : rien n'est envoyé, l'équipe voit le canal et la solution.
    const q1 = await resend(ids.lyon);
    expect(q1.get("error")).toBe(
      "Liens toujours impossibles à créer pour « Canal privé sans bot » : ajoutez @bot_333 comme administrateur de ce canal avec le droit « Inviter via un lien », puis réessayez. Rien n'a été envoyé à ces personnes.",
    );
    expect(await welcomes()).toBe(1);

    // Le client ajoute le bot casino au canal ; le membre a ouvert la conversation avec le bot.
    world.admins.get(Number(PRIVE))!.add(111);
    await prisma.channelBotAdmin.create({
      data: {
        channelId: ids.prive,
        botId: casino.id,
        rights: { status: "administrator", can_invite_users: true },
      },
    });
    await prisma.memberBotState.create({
      data: { memberId: member.id, botId: dating.id, canDm: true, startedAt: new Date() },
    });
    const q2 = await resend(ids.lyon);
    expect(q2.get("ok")).toBe("Accueil renvoyé avec les liens à 1 personne.");
    expect(q2.get("error")).toBeNull();
    const last = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
      orderBy: { queuedAt: "desc" },
    });
    expect((last.buttons as Buttons).map((r) => r[0]!.text)).toEqual([
      "Rejoindre Canal privé sans bot",
      "✅ J'ai rejoint",
    ]);
    expect(await welcomes()).toBe(2);
    expect(await listGateLinksMissing({ channelId: ids.lyon })).toEqual([]);
    const types = (await prisma.event.findMany({ where: { memberId: member.id } })).map(
      (e) => e.type,
    );
    expect(types).toContain("membership.welcome_resent");
    const audits = await prisma.auditLog.findMany({
      where: { userId, action: "membership.gate_welcome_resent", entityId: ids.lyon },
    });
    expect(audits).toHaveLength(2);

    // Demande qui n'est plus en attente : jamais d'envoi.
    const m = await prisma.membership.findFirstOrThrow({
      where: { memberId: member.id, channelId: ids.lyon },
    });
    await prisma.membership.update({
      where: { id: m.id },
      data: {
        status: "APPROVED",
        source: {
          ...(m.source as object),
          gateLinksMissing: [{ channelId: ids.prive, title: "x" }],
        },
      },
    });
    expect(await resendGateWelcomeWithDb(m.id)).toEqual({ status: "not_pending" });
    const q3 = await resend(ids.lyon);
    expect(q3.get("ok")).toBe("Aucune demande n'attend de liens dans ce canal.");
    expect(await welcomes()).toBe(2);
  });

  it("demandes laissées bloquées par l'ancienne version (accueil sans bouton, aucune trace) : « À faire » puis renvoi", async () => {
    // Format d'avant la correction du 11 octobre : PENDING_GATE, `gates` incomplet, aucune trace `gateLinksMissing`.
    const rule = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.zone, isDefault: true },
    });
    const gateLink = (channelId: string) =>
      prisma.inviteLink.findFirstOrThrow({
        where: { kind: "GATE", sourceChannelId: ids.zone, channelId },
      });
    const roulette = await gateLink(ids.roulette);
    const tir = await gateLink(ids.tir);
    type GateButton = { channelId: string; title: string; url: string };
    const button = (channelId: string, title: string, url: string): GateButton => ({
      channelId,
      title,
      url,
    });
    const legacy = async (tgId: number, code: string, gates: GateButton[], hoursAgo: number) => {
      const member = await prisma.member.create({
        data: { telegramUserId: BigInt(tgId), firstName: `Ancien${tgId}`, languageCode: "fr" },
      });
      // Le membre a ouvert la conversation avec le bot : le renvoi peut lui écrire.
      await prisma.memberBotState.create({
        data: { memberId: member.id, botId: dating.id, canDm: true, startedAt: new Date() },
      });
      return prisma.membership.create({
        data: {
          code,
          memberId: member.id,
          channelId: ids.zone,
          status: "PENDING_GATE",
          approvalRuleId: rule.id,
          requestedAt: new Date(Date.now() - hoursAgo * 3_600_000),
          userChatId: BigInt(tgId),
          source: {
            gates,
            startUrl: `https://t.me/bot_333?start=g${code}`,
            botId: dating.id,
            rule: { id: rule.id, gateMode: "REQUIRED" },
          },
        },
      });
    };
    const empty = await legacy(9201, "ancien01", [], 3);
    const partial = await legacy(
      9202,
      "ancien02",
      [button(ids.roulette, "LA ZONE ROULETTE 🎰", roulette.telegramInviteLink)],
      2,
    );
    // Ancien format avec tous les liens : la personne a ses boutons, rien à faire.
    await legacy(
      9203,
      "ancien03",
      [
        button(ids.roulette, "LA ZONE ROULETTE 🎰", roulette.telegramInviteLink),
        button(ids.tir, "🎯 TIR CADRÉ ⚡", tir.telegramInviteLink),
      ],
      1,
    );

    const rows = await listGateLinksMissing({ channelId: ids.zone });
    expect(rows.map((r) => [r.membershipId, r.missing.map((p) => p.title)])).toEqual([
      [empty.id, ["LA ZONE ROULETTE 🎰", "🎯 TIR CADRÉ ⚡"]],
      [partial.id, ["🎯 TIR CADRÉ ⚡"]],
    ]);
    expect(rows[0]!.missing[0]).toMatchObject({
      channelId: ids.roulette,
      suggestedBot: "bot_333",
      reason: "no_link",
    });
    const todo = await loadTodoInput({ role: "MANAGER", telegramUserId: null });
    expect(todo.gateLinksMissing).toEqual([
      {
        channelId: ids.zone,
        channelTitle: "Zone Interdite 🔞",
        count: 2,
        missingTitles: ["LA ZONE ROULETTE 🎰", "🎯 TIR CADRÉ ⚡"],
        uncheckedTitles: [],
      },
    ]);

    // « Renvoyer l'accueil avec les liens » : les bots casino et sports créent les liens, accueil complet renvoyé.
    const q = await resend(ids.zone);
    expect(q.get("ok")).toBe("Accueil renvoyé avec les liens à 2 personnes.");
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: empty.memberId, kind: "WELCOME" },
    });
    expect((welcome.buttons as Buttons).map((r) => r[0]!)).toEqual([
      { text: "Rejoindre LA ZONE ROULETTE 🎰", url: roulette.telegramInviteLink },
      { text: "Rejoindre 🎯 TIR CADRÉ ⚡", url: tir.telegramInviteLink },
      { text: "✅ J'ai rejoint", callbackData: "g:ancien01" },
    ]);
    expect(await listGateLinksMissing({ channelId: ids.zone })).toEqual([]);
  });

  it("canal public obligatoire qu'aucun de nos bots ne peut vérifier : demande marquée, « À faire », puis acceptée", async () => {
    const PARIS = -1001100000008n;
    const PUB = -1001100000009n;
    TITLES.set(PARIS, "Paris public");
    world.chat(PARIS, [333]);
    world.chat(PUB, []);
    const paris = await channel(PARIS, "Paris public", "DATING", dating.id, [dating.id]);
    const pub = await channel(PUB, "Canal public", "CASINO", casino.id, []);
    await prisma.channel.update({ where: { id: pub }, data: { username: "canal_public" } });
    await prisma.approvalRule.create({
      data: {
        channelId: paris,
        name: "Règle par défaut",
        isDefault: true,
        mode: "DELAY",
        delaySeconds: 600,
        gateMode: "REQUIRED",
        gateChannelIds: [pub],
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });

    await post(joinRequest(PARIS, 9301, 30));
    const member = await prisma.member.findUniqueOrThrow({ where: { telegramUserId: 9301n } });
    let m = await prisma.membership.findFirstOrThrow({
      where: { memberId: member.id, channelId: paris },
    });
    const welcome = await prisma.outboundMessage.findFirstOrThrow({
      where: { memberId: member.id, kind: "WELCOME" },
    });
    // Le lien public part dans l'accueil : aucun lien ne manque…
    expect((welcome.buttons as Buttons)[0]![0]!.url).toBe("https://t.me/canal_public");
    expect(await listGateLinksMissing({ channelId: paris })).toEqual([]);

    // … mais la personne a rejoint et aucun de nos bots ne peut le vérifier : avant, elle restait bloquée en silence.
    world.members.get(Number(PUB))!.add(9301);
    await post(startCommand(9301, `g${m.code}`, 31));
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("PENDING_GATE");
    const rows = await listGateLinksMissing({ channelId: paris });
    expect(rows.map((r) => r.membershipId)).toEqual([m.id]);
    expect(rows[0]!.missing).toEqual([
      expect.objectContaining({
        channelId: pub,
        title: "Canal public",
        suggestedBot: "bot_333",
        reason: "cannot_verify",
      }),
    ]);
    const lines = buildTodo(await loadTodoInput({ role: "MANAGER", telegramUserId: null }));
    expect(lines.find((l) => l.key === `gate-links:${paris}`)?.text).toBe(
      "1 demande dans « Paris public » est bloquée : le bot ne peut pas vérifier « Canal public »",
    );

    // Renvoi : toujours aucun bot pour vérifier, rien n'est envoyé.
    const q = await resend(paris);
    expect(q.get("error")).toBe(
      "Le bot ne peut toujours pas vérifier « Canal public » : ajoutez @bot_333 comme administrateur de ce canal, puis réessayez. Rien n'a été envoyé à ces personnes.",
    );
    expect(
      await prisma.outboundMessage.count({ where: { memberId: member.id, kind: "WELCOME" } }),
    ).toBe(1);

    // Le client ajoute le bot casino au canal ; « J'ai rejoint » : vérifié, accepté, marque effacée.
    world.admins.get(Number(PUB))!.add(111);
    await prisma.channelBotAdmin.create({
      data: {
        channelId: pub,
        botId: casino.id,
        rights: { status: "administrator", can_invite_users: true },
      },
    });
    await post(startCommand(9301, `g${m.code}`, 32));
    m = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("SCHEDULED");
    expect(await listGateLinksMissing({ channelId: paris })).toEqual([]);
  });

  it("enregistrement de la règle : exigence alignée, liens créés et vérifiés tout de suite, état dans l'éditeur", async () => {
    // Nouveau canal à rejoindre géré par le bot sports, et un canal sans aucun bot.
    const foot = await channel(-1001100000006n, "Foot du soir", "SPORTS", sports.id, [sports.id]);
    world.chat(-1001100000006n, [222]);
    const sansBot = await channel(-1001100000007n, "Sans bot", "SPORTS", sports.id, []);
    world.chat(-1001100000007n, []);

    const form = (gateIds: string[], gateMode: string) => {
      const f = new FormData();
      f.append("channelId", ids.zone);
      f.append("mode", "DELAY");
      f.append("delayPreset", "10m");
      f.append("gateMode", gateMode);
      for (const g of gateIds) f.append("gateChannelIds", g);
      f.append("reminderAfterMinutes", "60");
      f.append("maxReminders", "1");
      f.append("expireAction", "KEEP");
      return f;
    };
    const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => {
      try {
        await fn(f);
      } catch (err) {
        return new URLSearchParams(((err as { url?: string }).url ?? "").split("?")[1] ?? "");
      }
      throw new Error("redirection attendue");
    };

    // Canaux envoyés sans exigence : enregistrés comme obligatoires ; liens créés tout de suite.
    const q1 = await run(saveRuleAction, form([foot, sansBot], "NONE"));
    const rule = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.zone, isDefault: true },
    });
    expect(rule.gateMode).toBe("REQUIRED");
    expect(rule.gateChannelIds).toEqual([foot, sansBot]);
    expect(
      await prisma.inviteLink.count({
        where: { kind: "GATE", sourceChannelId: ids.zone, channelId: foot, botId: sports.id },
      }),
    ).toBe(1);
    expect(q1.get("ok")).toMatch(/^Règle d'adhésion enregistrée/);
    expect(q1.get("error")).toBe(
      "Le bot ne peut pas créer le lien de « Sans bot » : ajoutez @bot_333 comme administrateur de « Sans bot » avec le droit « Inviter via un lien », puis cliquez « Vérifier les liens ».",
    );

    const view = await loadGateLinkView(ids.zone, entryRuleFromRow(rule));
    expect(view!.rows.map((r) => [r.title, r.state])).toEqual([
      ["Foot du soir", "ok"],
      ["Sans bot", "problem"],
    ]);
    expect(view!.rows[1]!.solution).toContain(
      "Ajoutez @bot_333 comme administrateur de « Sans bot »",
    );
    expect(view!.summary.ok).toBe(false);

    // Le client ajoute le bot sports au canal, puis « Vérifier les liens » : tout est prêt.
    world.admins.get(-1001100000007)!.add(222);
    await prisma.channelBotAdmin.create({
      data: {
        channelId: sansBot,
        botId: sports.id,
        rights: { status: "administrator", can_invite_users: true },
      },
    });
    const f = new FormData();
    f.append("channelId", ids.zone);
    const q2 = await run(checkGateLinksAction, f);
    expect(q2.get("ok")).toBe("Liens des canaux à rejoindre vérifiés : tout est prêt.");
    const view2 = await loadGateLinkView(ids.zone, entryRuleFromRow(rule));
    expect(view2!.summary).toEqual({
      ok: true,
      text: "Tout est prêt : le bot envoie un bouton par canal et « ✅ J'ai rejoint ».",
    });
    expect(
      await prisma.auditLog.count({ where: { userId, action: "channel.gate_links_checked" } }),
    ).toBe(1);

    // Aucun canal : exigence « aucune ».
    await run(saveRuleAction, form([], "REQUIRED"));
    const none = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.zone, isDefault: true },
    });
    expect(none.gateMode).toBe("NONE");
    expect(none.gateChannelIds).toEqual([]);
  });
});
