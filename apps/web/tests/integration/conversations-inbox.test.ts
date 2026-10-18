/**
 * Phase 17, étape 4b : boîte de réception de l'assistant de conversation et reprise en main (base réelle, file capturée).
 * Liste triée par dernier message et filtres (non lues, étape, qui répond, source, persona), prendre la main / la rendre
 * (messages reçus pendant la reprise marqués traités : jamais repris par l'assistante), message de l'équipe (prise de
 * main avant l'envoi, envoi par la file des messages privés, texte échappé, journal sans texte), refus (/stop, mineur,
 * bot bloqué, conversation bloquée), fermer puis rouvrir (étape retrouvée), bloquer (définitif), fil en direct, chiffres
 * (réponses, liens, inscriptions et premiers dépôts rattachés par le clic, coût sans « Tester »), export CSV.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { parseInboxFilters } from "@/lib/conversations/filters";
import { exportConversations, inboxCounts, listConversations } from "@/lib/conversations/inbox";
import { loadConversationDetail, loadThreadUpdate } from "@/lib/conversations/detail";
import {
  blockConversation,
  closeConversation,
  releaseConversation,
  sendTeamMessage,
  takeOverConversation,
} from "@/lib/conversations/operations";
import { loadConversationStats } from "@/lib/conversations/stats-queries";
import { resolvePeriod } from "@/lib/periods";
import { capturedJobs, resetDb } from "./helpers";

let botId = "";
let personaId = "";
let otherPersonaId = "";
let trackingLinkId = "";
let affiliateCampaignId = "";
let team = { id: "", name: "Marie" };
let telegramId = 9_100_000n;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function newConversation(opts: {
  firstName?: string | null;
  username?: string | null;
  source?: string | null;
  persona?: string | null;
  stage?: "WELCOME" | "CHAT" | "PROPOSAL" | "LINK_SENT" | "CONVERTED" | "CLOSED";
  status?: "BOT" | "HUMAN" | "CLOSED";
  createdAt?: Date;
  extra?: Record<string, unknown>;
}) {
  const member = await prisma.member.create({
    data: {
      telegramUserId: telegramId++,
      firstName: opts.firstName === undefined ? "Jean" : opts.firstName,
      username: opts.username ?? null,
      languageCode: "fr",
    },
  });
  const conv = await prisma.conversation.create({
    data: {
      botId,
      memberId: member.id,
      personaId: opts.persona === undefined ? personaId : opts.persona,
      source: opts.source === undefined ? "tk01" : opts.source,
      stage: opts.stage ?? "CHAT",
      status: opts.status ?? "BOT",
      assistantTurns: 2,
      memberMessages: 2,
      createdAt: opts.createdAt ?? minutesAgo(60),
      ...(opts.extra ?? {}),
    },
  });
  return { member, conv };
}

async function message(
  conversationId: string,
  direction: "IN" | "OUT",
  author: "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM",
  text: string,
  at: Date,
  extra: Record<string, unknown> = {},
) {
  return prisma.conversationMessage.create({
    data: { conversationId, direction, author, text, createdAt: at, ...extra },
  });
}

beforeAll(async () => {
  await resetDb();
  await prisma.aiConversationUsage.deleteMany();
  const user = await prisma.user.upsert({
    where: { email: "inbox-team@test" },
    create: { email: "inbox-team@test", name: "Marie", role: "MANAGER", passwordHash: "x" },
    update: { name: "Marie", isActive: true },
  });
  team = { id: user.id, name: user.name };
  const persona = await prisma.persona.create({
    data: { name: "Léa", gender: "F", isActive: true, followUpAfterHours: 24, followUpsMax: 2 },
  });
  personaId = persona.id;
  otherPersonaId = (await prisma.persona.create({ data: { name: "Hugo", gender: "M" } })).id;
  const bot = await prisma.bot.create({
    data: {
      name: "Léa",
      username: "lea_inbox_bot",
      telegramBotId: 778n,
      tokenEncrypted: encrypt(`778:TEST-TOKEN-${"x".repeat(30)}`),
      vertical: "DATING",
      webhookSecret: "secret-inbox",
      mode: "ASSISTANT",
      personaId,
    },
  });
  botId = bot.id;
  const program = await prisma.affiliateProgram.create({
    data: { name: "App Rencontres", source: "LINKAFFI", externalId: "prog-inbox" },
  });
  affiliateCampaignId = (
    await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "camp-inbox",
        name: "App Rencontres FR",
        trackingUrlTemplate: "https://linkaffi.me/go/abcdefgh?sub_id={subid}",
      },
    })
  ).id;
  trackingLinkId = (
    await prisma.trackingLink.create({
      data: {
        slug: "inboxOffer1",
        kind: "OFFER",
        destinationTemplate: "https://linkaffi.me/go/abcdefgh?sub_id={subid}",
        label: "Assistant « Léa »",
        personaId,
        affiliateCampaignId,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.aiConversationUsage.deleteMany();
});

describe("boîte de réception", () => {
  it("triée par dernier message ; non lues ; filtres étape, qui répond, source, persona", async () => {
    const a = await newConversation({ firstName: "Alice", source: "tk01", stage: "CHAT" });
    await message(a.conv.id, "OUT", "ASSISTANT", "Coucou", minutesAgo(30));
    await message(a.conv.id, "IN", "MEMBER", "Salut !", minutesAgo(5));
    const b = await newConversation({
      firstName: null,
      username: "bob_x",
      source: null,
      persona: otherPersonaId,
      stage: "LINK_SENT",
      status: "HUMAN",
    });
    await message(b.conv.id, "OUT", "TEAM", "Bonjour", minutesAgo(1));
    const c = await newConversation({ firstName: null, username: null, stage: "WELCOME" });
    await message(c.conv.id, "IN", "MEMBER", "/start", minutesAgo(20), {
      meta: { command: "start" },
    });

    const all = await listConversations(parseInboxFilters({}));
    expect(all.rows.map((r) => r.id)).toEqual([b.conv.id, a.conv.id, c.conv.id]);
    expect(all.total).toBe(3);
    expect(all.rows.find((r) => r.id === a.conv.id)?.unread).toBe(true);
    expect(all.rows.find((r) => r.id === b.conv.id)).toMatchObject({
      unread: false,
      personaName: "Hugo",
      last: expect.objectContaining({ author: "TEAM", text: "Bonjour" }),
    });

    const ids = async (sp: Record<string, string>) =>
      (await listConversations(parseInboxFilters(sp))).rows.map((r) => r.id).sort();
    expect(await ids({ unread: "1" })).toEqual([a.conv.id, c.conv.id].sort());
    expect(await ids({ stage: "LINK_SENT" })).toEqual([b.conv.id]);
    expect(await ids({ status: "HUMAN" })).toEqual([b.conv.id]);
    expect(await ids({ source: "~" })).toEqual([b.conv.id]);
    expect(await ids({ source: "tk01", unread: "1" })).toEqual([a.conv.id, c.conv.id].sort());
    expect(await ids({ persona: otherPersonaId })).toEqual([b.conv.id]);
    expect(await inboxCounts()).toEqual({ all: 3, unread: 2, human: 1 });

    const page2 = await listConversations({ ...parseInboxFilters({}), page: 2 }, { pageSize: 2 });
    expect(page2.rows.map((r) => r.id)).toEqual([c.conv.id]);
    expect(page2.pages).toBe(2);
  });
});

describe("reprise en main", () => {
  it("prendre la main puis la rendre : messages reçus entre-temps marqués traités, jamais repris", async () => {
    const { conv } = await newConversation({ firstName: "Chloé", stage: "CHAT" });
    await message(conv.id, "OUT", "ASSISTANT", "Coucou", minutesAgo(10));
    const took = await takeOverConversation(conv.id, team);
    expect(took.ok).toBe(true);
    let row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row).toMatchObject({ status: "HUMAN", takenOverById: team.id, nextFollowUpAt: null });
    expect((await takeOverConversation(conv.id, team)).ok).toBe(false);

    // Pendant la reprise, la réception enregistre les messages sans tour (turnId vide).
    const m1 = await message(conv.id, "IN", "MEMBER", "Tu es là ?", minutesAgo(3));
    const m2 = await message(conv.id, "IN", "MEMBER", "Allô", minutesAgo(2));
    const released = await releaseConversation(conv.id, team);
    expect(released).toMatchObject({ ok: true });
    if (released.ok)
      expect(released.message).toContain("pas à ceux reçus pendant que vous aviez la main");
    row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    // Le dernier message est celui de la personne (sans réponse) : aucune relance programmée.
    expect(row).toMatchObject({ status: "BOT", takenOverById: null, nextFollowUpAt: null });
    const marked = await prisma.conversationMessage.findMany({
      where: { id: { in: [m1.id, m2.id] } },
      select: { turnId: true, meta: true },
    });
    for (const msg of marked) {
      expect(msg.turnId).toMatch(/^team-\d+$/);
      expect(msg.meta).toMatchObject({ turnDone: true });
    }
    // Rien à reprendre pour l'assistante : aucun message entrant sans tour.
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
      }),
    ).toBe(0);

    const events = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(["taken_over", "released"]);
    expect(events[1]!.payload).toMatchObject({ markedInbound: 2 });
    const journal = await prisma.event.findMany({
      where: {
        type: { startsWith: "conversation." },
        payload: { path: ["conversationId"], equals: conv.id },
      },
    });
    expect(journal.map((e) => e.type).sort()).toEqual([
      "conversation.released",
      "conversation.taken_over",
    ]);
    expect(JSON.stringify(journal)).not.toContain("Allô");
    const audits = await prisma.auditLog.findMany({ where: { entityId: conv.id } });
    expect(audits.map((a) => a.action).sort()).toEqual([
      "conversation.released",
      "conversation.taken_over",
    ]);
    expect(audits.every((a) => a.userId === team.id)).toBe(true);
  });

  it("rendre la main après un message de l'équipe : la relance repart de maintenant (jamais tout de suite)", async () => {
    const { conv } = await newConversation({ firstName: "Inès", stage: "CHAT" });
    await message(conv.id, "OUT", "ASSISTANT", "Coucou", minutesAgo(48 * 60));
    expect((await sendTeamMessage(conv.id, team, "On en reparle ?")).ok).toBe(true);
    const before = Date.now();
    expect((await releaseConversation(conv.id, team)).ok).toBe(true);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe("BOT");
    expect(row.nextFollowUpAt!.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 1000);
    // Le message de l'équipe compte comme dernier message parti (relances du worker).
    const team1 = await prisma.conversationMessage.findFirstOrThrow({
      where: { conversationId: conv.id, author: "TEAM" },
    });
    expect(row.lastAssistantAt?.getTime()).toBe(team1.createdAt.getTime());
  });

  it("la personne écrit pendant la reprise, l'équipe répond, puis rend la main : la relance part bien à l'échéance", async () => {
    // Décision du worker à l'échéance (même règle que le balayage des relances).
    const { followUpDecision } = await import("../../../worker/src/assistant/rules");
    const { conv } = await newConversation({
      firstName: "Nina",
      stage: "CHAT",
      extra: { lastAssistantAt: minutesAgo(10), lastInboundAt: minutesAgo(30) },
    });
    await message(conv.id, "OUT", "ASSISTANT", "Coucou", minutesAgo(10));
    expect((await takeOverConversation(conv.id, team)).ok).toBe(true);
    // Réception d'un message pendant la reprise (comme `recordInbound` : heure notée, relances remises à zéro).
    await message(conv.id, "IN", "MEMBER", "Tu fais quoi ce soir ?", minutesAgo(4));
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastInboundAt: minutesAgo(4), followUpCount: 0, nextFollowUpAt: null },
    });
    expect((await sendTeamMessage(conv.id, team, "Rien de prévu, et toi ?")).ok).toBe(true);
    expect((await releaseConversation(conv.id, team)).ok).toBe(true);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.nextFollowUpAt).not.toBeNull();
    expect(row.lastAssistantAt!.getTime()).toBeGreaterThan(row.lastInboundAt!.getTime());
    expect(
      followUpDecision({
        now: row.nextFollowUpAt!,
        status: row.status,
        stoppedAt: row.stoppedAt,
        isMinor: row.isMinor,
        stage: row.stage,
        nextFollowUpAt: row.nextFollowUpAt,
        followUpCount: row.followUpCount,
        lastAssistantAt: row.lastAssistantAt,
        lastInboundAt: row.lastInboundAt,
        followUpsMax: 2,
      }),
    ).toEqual({ action: "send" });
  });

  it("rendre la main pendant un tour de l'assistante : refusé tant que le tour n'est pas fini (rien ne change)", async () => {
    const { conv } = await newConversation({ firstName: "Paul", stage: "CHAT", status: "HUMAN" });
    const busy = async () => ({ busy: true as const });
    const r = await releaseConversation(conv.id, team, new Date(), { lock: busy });
    expect(r).toEqual({
      ok: false,
      error:
        "L'assistante finit de traiter un message de cette conversation : réessayez dans quelques secondes.",
    });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe("HUMAN");
    expect(await prisma.conversationEvent.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: conv.id } })).toBe(0);
    // Tour terminé : la main est rendue sous le verrou.
    const seen: string[] = [];
    const free = async <T>(id: string, fn: () => Promise<T>) => {
      seen.push(id);
      return { busy: false as const, value: await fn(), locked: true };
    };
    expect((await releaseConversation(conv.id, team, new Date(), { lock: free })).ok).toBe(true);
    expect(seen).toEqual([conv.id]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe(
      "BOT",
    );
  });

  it("message de l'équipe : prend la main avant l'envoi, part par la file, texte échappé, journal sans texte", async () => {
    const { conv, member } = await newConversation({ firstName: "David", stage: "PROPOSAL" });
    const jobs = capturedJobs("telegram-send").length;
    const r = await sendTeamMessage(conv.id, team, "  Salut <b>toi</b> & bienvenue  ");
    expect(r).toMatchObject({ ok: true, tookOver: true });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe("HUMAN");
    const cm = await prisma.conversationMessage.findFirstOrThrow({
      where: { conversationId: conv.id, author: "TEAM" },
      include: { outboundMessage: true },
    });
    expect(cm).toMatchObject({
      direction: "OUT",
      teamUserId: team.id,
      text: "Salut <b>toi</b> & bienvenue",
    });
    expect(cm.outboundMessage).toMatchObject({
      kind: "ASSISTANT",
      botId,
      memberId: member.id,
      status: "QUEUED",
      text: "Salut &lt;b&gt;toi&lt;/b&gt; &amp; bienvenue",
    });
    const sent = capturedJobs("telegram-send").slice(jobs);
    expect(sent).toEqual([
      expect.objectContaining({ data: { type: "dm", outboundMessageId: cm.outboundMessageId } }),
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: conv.id, action: "conversation.message_sent" },
    });
    expect(audit.metadata).toMatchObject({ tookOver: true, length: 28 });
    expect(JSON.stringify(audit.metadata)).not.toContain("bienvenue");
    expect(
      (await prisma.conversationEvent.findMany({ where: { conversationId: conv.id } })).map(
        (e) => e.type,
      ),
    ).toEqual(["taken_over"]);

    // Déjà à l'équipe : pas de nouvelle prise de main.
    expect(await sendTeamMessage(conv.id, team, "Encore moi")).toMatchObject({
      ok: true,
      tookOver: false,
    });
    expect(await sendTeamMessage(conv.id, team, "")).toMatchObject({ ok: false });
    expect(await sendTeamMessage(conv.id, team, "x".repeat(4001))).toMatchObject({ ok: false });

    const detail = await loadConversationDetail(conv.id);
    expect(detail?.messages.map((m) => [m.authorLabel, m.delivery])).toEqual([
      ["Équipe · Marie", "QUEUED"],
      ["Équipe · Marie", "QUEUED"],
    ]);
  });

  it("refus : /stop, mineur, personne qui a bloqué le bot (rien n'est écrit)", async () => {
    const stopped = await newConversation({
      stage: "CLOSED",
      status: "CLOSED",
      extra: { stoppedAt: new Date(), closedReason: "STOP" },
    });
    const minor = await newConversation({
      stage: "CLOSED",
      status: "CLOSED",
      extra: { isMinor: true, closedReason: "MINOR" },
    });
    const blocked = await newConversation({ stage: "CHAT" });
    await prisma.memberBotState.create({
      data: { memberId: blocked.member.id, botId, canDm: false, blockedAt: new Date() },
    });
    const jobs = capturedJobs("telegram-send").length;
    const s = await sendTeamMessage(stopped.conv.id, team, "Coucou");
    expect(s).toEqual({
      ok: false,
      error:
        "Cette personne a demandé l'arrêt (/stop) : plus aucun message ne peut lui être envoyé.",
    });
    expect((await sendTeamMessage(minor.conv.id, team, "Coucou")).ok).toBe(false);
    const b = await sendTeamMessage(blocked.conv.id, team, "Coucou");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain("bloqué le bot");
    expect((await takeOverConversation(stopped.conv.id, team)).ok).toBe(false);
    expect(capturedJobs("telegram-send").length).toBe(jobs);
    expect(
      await prisma.conversationMessage.count({
        where: { conversationId: { in: [stopped.conv.id, minor.conv.id, blocked.conv.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.conversation.findUniqueOrThrow({ where: { id: blocked.conv.id } }),
    ).toMatchObject({ status: "BOT" });
  });

  it("fermer puis rouvrir en prenant la main : l'étape d'avant est retrouvée", async () => {
    const { conv } = await newConversation({ stage: "LINK_SENT" });
    expect((await closeConversation(conv.id, team)).ok).toBe(true);
    let row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row).toMatchObject({ status: "CLOSED", stage: "CLOSED", closedReason: "TEAM_CLOSED" });
    expect((await closeConversation(conv.id, team)).ok).toBe(false);
    expect((await takeOverConversation(conv.id, team)).ok).toBe(true);
    row = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row).toMatchObject({
      status: "HUMAN",
      stage: "LINK_SENT",
      closedReason: null,
      closedAt: null,
    });
    const types = (
      await prisma.conversationEvent.findMany({
        where: { conversationId: conv.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    ).map((e) => `${e.type}:${e.fromStage ?? ""}>${e.toStage ?? ""}`);
    expect(types).toEqual([
      "stage_changed:LINK_SENT>CLOSED",
      "closed:>",
      "taken_over:>",
      "stage_changed:CLOSED>LINK_SENT",
    ]);
  });

  it("bloquer : définitif, plus rien ne part, plus aucune action", async () => {
    const { conv } = await newConversation({ stage: "CHAT", status: "HUMAN" });
    expect((await blockConversation(conv.id, team)).ok).toBe(true);
    expect(await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({
      status: "CLOSED",
      stage: "CLOSED",
      closedReason: "TEAM",
      takenOverById: null,
    });
    const s = await sendTeamMessage(conv.id, team, "Coucou");
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toContain("bloquée par l'équipe");
    expect((await releaseConversation(conv.id, team)).ok).toBe(false);
    expect((await takeOverConversation(conv.id, team)).ok).toBe(false);
    expect((await blockConversation(conv.id, team)).ok).toBe(false);
    const detail = await loadConversationDetail(conv.id);
    expect(detail?.actions).toMatchObject({
      takeOver: false,
      release: false,
      close: false,
      block: false,
      send: false,
    });
    expect(
      await prisma.event.count({
        where: {
          type: "conversation.blocked",
          payload: { path: ["conversationId"], equals: conv.id },
        },
      }),
    ).toBe(1);
  });

  it("conversation inconnue : refus clair", async () => {
    expect(await takeOverConversation("clinexistante000", team)).toMatchObject({ ok: false });
  });
});

describe("fil en direct", () => {
  it("nouveaux messages depuis le curseur, lien de l'offre ouvert, repère d'état qui change", async () => {
    const { conv, member } = await newConversation({ stage: "LINK_SENT" });
    await message(conv.id, "OUT", "ASSISTANT", "Ancien", minutesAgo(30));
    const offer = await prisma.assistantOfferLink.create({
      data: {
        subId: "InboxSub0001",
        conversationId: conv.id,
        personaId,
        botId,
        memberId: member.id,
        trackingLinkId,
        source: "tk01",
        firstOpenedAt: new Date(),
        opens: 1,
      },
    });
    await message(conv.id, "OUT", "ASSISTANT", "Voici l'app", minutesAgo(5), {
      meta: { offerSubId: offer.subId },
    });
    const first = await loadThreadUpdate(conv.id, null);
    expect(first?.messages.map((m) => m.text)).toEqual(["Ancien", "Voici l'app"]);
    expect(first?.offers[offer.subId]?.openedAt).not.toBeNull();

    await message(conv.id, "IN", "MEMBER", "Ok je regarde", new Date());
    const next = await loadThreadUpdate(conv.id, first!.cursor);
    expect(next?.messages.map((m) => m.text)).toEqual(["Voici l'app", "Ok je regarde"]);
    expect(next!.cursor > first!.cursor).toBe(true);
    expect(next?.stateKey).toBe(first?.stateKey);
    await takeOverConversation(conv.id, team);
    expect((await loadThreadUpdate(conv.id, next!.cursor))?.stateKey).not.toBe(first?.stateKey);
    expect(await loadThreadUpdate("clinexistante000", null)).toBeNull();
  });
});

describe("chiffres et export", () => {
  it("par persona et par source : réponses, liens, inscriptions rattachées par le clic, coût sans « Tester »", async () => {
    await resetDb();
    await prisma.aiConversationUsage.deleteMany();
    // Persona et bot recréés (resetDb vide les personas, les bots et les liens).
    personaId = (
      await prisma.persona.create({ data: { name: "Léa", gender: "F", isActive: true } })
    ).id;
    botId = (
      await prisma.bot.create({
        data: {
          name: "Léa",
          username: "lea_inbox_bot",
          telegramBotId: 778n,
          tokenEncrypted: encrypt(`778:TEST-TOKEN-${"x".repeat(30)}`),
          vertical: "DATING",
          webhookSecret: "secret-inbox",
          mode: "ASSISTANT",
          personaId,
        },
      })
    ).id;
    const program = await prisma.affiliateProgram.create({
      data: { name: "App Rencontres", source: "LINKAFFI", externalId: "prog-inbox-2" },
    });
    affiliateCampaignId = (
      await prisma.affiliateCampaign.create({
        data: {
          programId: program.id,
          externalId: "camp-inbox-2",
          name: "App Rencontres FR",
          trackingUrlTemplate: "https://linkaffi.me/go/abcdefgh?sub_id={subid}",
        },
      })
    ).id;
    trackingLinkId = (
      await prisma.trackingLink.create({
        data: {
          slug: "inboxOffer2",
          kind: "OFFER",
          destinationTemplate: "https://linkaffi.me/go/abcdefgh?sub_id={subid}",
          label: "Assistant « Léa »",
          personaId,
          affiliateCampaignId,
        },
      })
    ).id;

    // 1 : a répondu après le premier message de l'assistante, lien envoyé et ouvert, inscription + premier dépôt.
    const one = await newConversation({
      source: "tk01",
      stage: "CONVERTED",
      createdAt: minutesAgo(90),
    });
    await message(one.conv.id, "IN", "MEMBER", "/start", minutesAgo(89), {
      meta: { command: "start" },
    });
    await message(one.conv.id, "OUT", "ASSISTANT", "Moi c'est Léa", minutesAgo(88));
    await message(one.conv.id, "IN", "MEMBER", "Salut", minutesAgo(80));
    const click = await prisma.click.create({
      data: {
        trackingLinkId,
        subId: "StatsSub0001",
        memberId: one.member.id,
        botId,
        conversationId: one.conv.id,
      },
    });
    await prisma.assistantOfferLink.create({
      data: {
        subId: "StatsSub0001",
        conversationId: one.conv.id,
        personaId,
        botId,
        memberId: one.member.id,
        trackingLinkId,
        source: "tk01",
        sentAt: minutesAgo(60),
        firstOpenedAt: minutesAgo(50),
        opens: 2,
        clickId: click.id,
      },
    });
    await prisma.player.create({
      data: {
        affiliateCampaignId,
        externalPlayerId: "pl-1",
        subId: "StatsSub0001",
        clickId: click.id,
        memberId: one.member.id,
        registeredAt: minutesAgo(40),
        ftdAt: minutesAgo(30),
      },
    });
    // 2 : seulement Démarrer et la présentation (aucune réponse), sans source.
    const two = await newConversation({
      source: null,
      stage: "WELCOME",
      createdAt: minutesAgo(70),
    });
    await message(two.conv.id, "IN", "MEMBER", "/start", minutesAgo(69), {
      meta: { command: "start" },
    });
    await message(two.conv.id, "OUT", "ASSISTANT", "Moi c'est Léa", minutesAgo(68));
    // 3 : fil effacé par /reset, mais un passage d'étape vers Discussion prouve une réponse.
    const three = await newConversation({
      source: "tk01",
      stage: "CHAT",
      createdAt: minutesAgo(65),
    });
    await prisma.conversationEvent.create({
      data: {
        conversationId: three.conv.id,
        type: "stage_changed",
        fromStage: "WELCOME",
        toStage: "CHAT",
      },
    });
    // Hors période (il y a 40 jours) : jamais compté.
    await newConversation({ source: "tk01", createdAt: new Date(Date.now() - 40 * 86_400_000) });
    await prisma.aiConversationUsage.createMany({
      data: [
        {
          personaId,
          conversationId: one.conv.id,
          purpose: "REPLY",
          model: "m",
          costEur: 0.4,
          ok: true,
        },
        {
          personaId,
          conversationId: two.conv.id,
          purpose: "REPLY",
          model: "m",
          costEur: 0.1,
          ok: true,
        },
        { personaId, conversationId: null, purpose: "TEST", model: "m", costEur: 5, ok: true },
      ],
    });

    const stats = await loadConversationStats(resolvePeriod({ range: "7d" }));
    expect(stats.total).toMatchObject({
      conversations: 3,
      replies: 2,
      linksSent: 1,
      linksOpened: 1,
      registrations: 1,
      ftds: 1,
      costEur: 0.5,
      costPerRegistration: 0.5,
    });
    expect(stats.byPersona.map((r) => [r.label, r.conversations])).toEqual([["Léa", 3]]);
    expect(
      stats.bySource.map((r) => [r.label, r.conversations, r.registrations, r.costEur]),
    ).toEqual([
      ["tk01", 2, 1, 0.4],
      ["Sans source", 1, 0, 0.1],
    ]);
    expect(Object.fromEntries(stats.journey.map((s) => [s.stage, s.count]))).toMatchObject({
      WELCOME: 3,
      CHAT: 1,
      CONVERTED: 1,
    });

    const rows = await exportConversations(parseInboxFilters({ source: "tk01" }));
    const exported = rows.find((r) => r.id === one.conv.id);
    expect(exported).toMatchObject({
      linksSent: 1,
      linksOpened: 1,
      costEur: 0.4,
      botUsername: "lea_inbox_bot",
    });
    expect(exported?.registeredAt).not.toBeNull();
    expect(rows).toHaveLength(3);
  });
});
