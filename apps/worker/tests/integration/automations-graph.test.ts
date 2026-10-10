import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linearToGraph, type AutomationGraph, type AutomationLogEntry } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { buildGraphContext } from "../../src/automations/context";
import { handleEvent, resumePending, runRuleForMember } from "../../src/automations/run";
import { capturedJobs, createBotAndChannel, resetDb } from "./helpers";

const P = { x: 0, y: 0 };
const H = 3_600_000;
const CAMPAIGN_NAME = "Intégration relances à branches";

/** Départ → attendre 24 h → « a déjà déposé ? » : oui → arrêter, non → message. */
const WAIT_THEN_DEPOSIT: AutomationGraph = {
  version: 1,
  nodes: [
    { id: "trigger", type: "trigger", position: P },
    { id: "wait", type: "wait", position: { x: 0, y: 160 }, hours: 24 },
    {
      id: "check",
      type: "condition",
      position: { x: 0, y: 320 },
      condition: { kind: "deposited" },
    },
    { id: "stop", type: "stop", position: { x: -220, y: 480 } },
    {
      id: "message",
      type: "action",
      position: { x: 220, y: 480 },
      action: { type: "send_message", text: "Pensez à votre bonus, {prenom}" },
    },
  ],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "next", target: "wait" },
    { id: "e2", source: "wait", sourceHandle: "next", target: "check" },
    { id: "e3", source: "check", sourceHandle: "yes", target: "stop" },
    { id: "e4", source: "check", sourceHandle: "no", target: "message" },
  ],
};

function logOf(run: { log: unknown }): AutomationLogEntry[] {
  return run.log as AutomationLogEntry[];
}

async function outbound(memberId: string) {
  return prisma.outboundMessage.findMany({ where: { memberId }, orderBy: { queuedAt: "asc" } });
}

/** Termine les exécutions encore en attente d'un test, pour que `resumePending` du test suivant ne les reprenne pas. */
async function closePending() {
  await prisma.automationRun.updateMany({
    where: { status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

describe("relances automatiques à branches (base réelle)", () => {
  let channelId = "";
  let otherChannelId = "";
  let alice = "";
  let bruno = "";
  let campaignId = "";

  beforeAll(async () => {
    await prisma.automationRun.deleteMany();
    await prisma.automationRule.deleteMany();
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: CAMPAIGN_NAME } });
    const { bot, channel } = await createBotAndChannel();
    channelId = channel.id;
    otherChannelId = (
      await prisma.channel.create({
        data: {
          telegramChatId: -1009876543210n,
          title: "Autre canal",
          type: "CHANNEL",
          language: "fr",
          primaryBotId: bot.id,
          isTest: true,
        },
      })
    ).id;
    campaignId = (await prisma.campaign.create({ data: { name: CAMPAIGN_NAME, status: "ACTIVE" } }))
      .id;
    const link = await prisma.inviteLink.create({
      data: {
        channelId,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+relances-branches",
        name: "pub test",
        campaignId,
      },
    });
    const a = await prisma.member.create({
      data: { telegramUserId: 900_001n, firstName: "Alice", languageCode: "fr" },
    });
    const b = await prisma.member.create({
      data: { telegramUserId: 900_002n, firstName: "Bruno", languageCode: "en-GB" },
    });
    alice = a.id;
    bruno = b.id;
    for (const m of [a, b])
      await prisma.memberBotState.create({
        data: { memberId: m.id, botId: bot.id, canDm: true, startedAt: new Date() },
      });
    await prisma.membership.create({
      data: {
        code: "MSALICE1",
        memberId: alice,
        channelId,
        status: "APPROVED",
        requestedAt: new Date(Date.now() - 48 * H),
        joinedAt: new Date(Date.now() - 47 * H),
      },
    });
    await prisma.membership.create({
      data: {
        code: "MSBRUNO1",
        memberId: bruno,
        channelId,
        status: "APPROVED",
        inviteLinkId: link.id,
        requestedAt: new Date(Date.now() - 72 * H),
        joinedAt: new Date(Date.now() - 71 * H),
      },
    });
    // Bruno a quitté l'autre canal : sa dernière adhésion y est un départ.
    await prisma.membership.create({
      data: {
        code: "MSBRUNO0",
        memberId: bruno,
        channelId: otherChannelId,
        status: "APPROVED",
        requestedAt: new Date(Date.now() - 96 * H),
      },
    });
    await prisma.membership.create({
      data: {
        code: "MSBRUNO2",
        memberId: bruno,
        channelId: otherChannelId,
        status: "LEFT",
        requestedAt: new Date(Date.now() - 90 * H),
        leftAt: new Date(Date.now() - 80 * H),
      },
    });
    // Bruno est inscrit et a déposé une fois.
    const program = await prisma.affiliateProgram.create({ data: { name: "Programme test" } });
    const offer = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "off-1",
        name: "Offre test",
        trackingUrlTemplate: "https://example.org/?sub_id={subid}",
      },
    });
    await prisma.player.create({
      data: {
        affiliateCampaignId: offer.id,
        externalPlayerId: "p-bruno",
        memberId: bruno,
        registeredAt: new Date(Date.now() - 60 * H),
        ftdAt: new Date(Date.now() - 50 * H),
        depositCount: 1,
        depositTotal: 50,
      },
    });
  });

  // Aucune règle de test ne reste dans la base de test (les autres suites ne nettoient pas les relances).
  afterAll(async () => {
    await prisma.automationRun.deleteMany();
    await prisma.automationRule.deleteMany();
  });

  it("graphe : départ → attente → « a déposé ? » non → message, repris au bon bloc après l'attente", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Relance graphe",
        trigger: "JOINED",
        isActive: true,
        graph: WAIT_THEN_DEPOSIT,
        templateKey: "signup_no_deposit",
      },
    });
    const t0 = new Date();
    expect(
      await handleEvent(
        { type: "event", trigger: "JOINED", memberId: alice, context: { channelId } },
        t0,
      ),
    ).toEqual({ started: 1 });

    const pending = await prisma.automationRun.findFirstOrThrow({
      where: { ruleId: rule.id, memberId: alice },
    });
    expect(pending).toMatchObject({ status: "PENDING", nodeId: "check", step: 1, error: null });
    expect(pending.resumeAt?.getTime()).toBe(t0.getTime() + 24 * H);
    expect(logOf(pending)).toEqual([
      { step: 0, nodeId: "wait", type: "wait", at: t0.toISOString(), ok: true, detail: "1 jour" },
    ]);
    expect(await outbound(alice)).toHaveLength(0);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).runs).toBe(
      1,
    );

    // Pas encore l'heure.
    expect(await resumePending(new Date(t0.getTime() + 23 * H))).toBe(0);
    expect(
      (await prisma.automationRun.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe("PENDING");

    // L'heure est venue : la condition est évaluée maintenant (Alice n'a pas déposé) → sortie « non » → message.
    const t1 = new Date(t0.getTime() + 24 * H + 60_000);
    expect(await resumePending(t1)).toBe(1);
    const done = await prisma.automationRun.findUniqueOrThrow({ where: { id: pending.id } });
    expect(done).toMatchObject({ status: "DONE", nodeId: "message", step: 3, error: null });
    expect(logOf(done).map((l) => [l.step, l.nodeId, l.type, l.ok, l.branch ?? null])).toEqual([
      [0, "wait", "wait", true, null],
      [1, "check", "condition", true, "no"],
      [2, "message", "send_message", true, null],
    ]);
    expect(logOf(done)[1]?.detail).toBe("non : A déjà déposé ?");
    const msgs = await outbound(alice);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      kind: "AUTOMATION",
      text: "Pensez à votre bonus, Alice",
      status: "QUEUED",
    });
    expect(
      capturedJobs("telegram-send").some((j) => j.data.outboundMessageId === msgs[0]!.id),
    ).toBe(true);
    const events = await prisma.event.findMany({
      where: { type: "automation.run", memberId: alice },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => (e.payload as { nodeId?: string }).nodeId)).toEqual([
      "check",
      "message",
    ]);
    // Une seule exécution par membre : un nouvel événement ne relance rien.
    expect(
      await handleEvent(
        { type: "event", trigger: "JOINED", memberId: alice, context: { channelId } },
        t1,
      ),
    ).toEqual({ started: 0 });
  });

  it("graphe : un membre qui a déposé prend la sortie « oui » → arrêt, sans message", async () => {
    const rule = await prisma.automationRule.findFirstOrThrow({
      where: { name: "Relance graphe" },
    });
    const t0 = new Date();
    expect(
      await handleEvent(
        { type: "event", trigger: "JOINED", memberId: bruno, context: { channelId } },
        t0,
      ),
    ).toEqual({ started: 1 });
    expect(await resumePending(new Date(t0.getTime() + 25 * H))).toBe(1);
    const run = await prisma.automationRun.findFirstOrThrow({
      where: { ruleId: rule.id, memberId: bruno },
    });
    expect(run).toMatchObject({ status: "DONE", nodeId: "stop", step: 3 });
    expect(logOf(run).map((l) => [l.nodeId, l.branch ?? null])).toEqual([
      ["wait", null],
      ["check", "yes"],
      ["stop", null],
    ]);
    expect(await outbound(bruno)).toHaveLength(0);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
  });

  it("graphe : une étiquette posée par la relance compte pour la condition suivante", async () => {
    const graph: AutomationGraph = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: P },
        {
          id: "c1",
          type: "condition",
          position: P,
          condition: { kind: "has_tag", tag: "relance" },
        },
        { id: "tag", type: "action", position: P, action: { type: "tag", tag: "relance" } },
        {
          id: "c2",
          type: "condition",
          position: P,
          condition: { kind: "has_tag", tag: "relance" },
        },
        {
          id: "m",
          type: "action",
          position: P,
          action: { type: "send_message", text: "Étiquette vue" },
        },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "next", target: "c1" },
        { id: "e2", source: "c1", sourceHandle: "no", target: "tag" },
        { id: "e3", source: "tag", sourceHandle: "next", target: "c2" },
        { id: "e4", source: "c2", sourceHandle: "yes", target: "m" },
      ],
    };
    const rule = await prisma.automationRule.create({
      data: { name: "Étiquette puis condition", trigger: "LEFT", isActive: true, graph },
    });
    expect(
      await handleEvent({
        type: "event",
        trigger: "LEFT",
        memberId: alice,
        context: { channelId },
      }),
    ).toEqual({ started: 1 });
    const run = await prisma.automationRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run).toMatchObject({ status: "DONE", nodeId: "m" });
    expect(logOf(run).map((l) => [l.nodeId, l.branch ?? null])).toEqual([
      ["c1", "no"],
      ["tag", null],
      ["c2", "yes"],
      ["m", null],
    ]);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: alice } })).tags).toEqual([
      "relance",
    ]);
    expect((await outbound(alice)).map((m) => m.text)).toContain("Étiquette vue");
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
  });

  it("contexte des conditions lu en base : inscription, dépôts, canaux, campagnes, clics d'offre depuis le début", async () => {
    const since = new Date(Date.now() - 10 * H);
    const tl = await prisma.trackingLink.create({
      data: {
        slug: "relbranch",
        kind: "OFFER",
        destinationTemplate: "https://example.org/?s={subid}",
        label: "Offre",
      },
    });
    await prisma.click.create({
      data: {
        trackingLinkId: tl.id,
        memberId: bruno,
        subId: "sub-avant",
        createdAt: new Date(since.getTime() - H),
      },
    });
    const trigger = await prisma.click.create({
      data: {
        trackingLinkId: tl.id,
        memberId: bruno,
        subId: "sub-declencheur",
        createdAt: new Date(since.getTime() + H),
      },
    });
    await prisma.click.create({
      data: {
        trackingLinkId: tl.id,
        memberId: bruno,
        subId: "sub-robot",
        isBot: true,
        createdAt: new Date(since.getTime() + H),
      },
    });
    await prisma.click.create({
      data: {
        trackingLinkId: tl.id,
        memberId: bruno,
        subId: null,
        createdAt: new Date(since.getTime() + H),
      },
    });
    await prisma.member.update({
      where: { id: bruno },
      data: { tags: ["vip"], lastSeenAt: new Date(Date.now() - 9 * 24 * H) },
    });

    const ctx = await buildGraphContext(bruno, { since });
    expect(ctx).toMatchObject({
      registered: true,
      deposited: true,
      depositCount: 1,
      languageCode: "en-GB",
      tags: ["vip"],
      channelIds: [channelId],
      campaignIds: [campaignId],
      offerClicksSinceStart: 1,
    });
    // Le dernier clic (il y a ~9 h) compte comme activité du membre.
    expect(ctx?.inactiveDays).toBe(0);
    // Le clic qui a déclenché la relance n'est pas un nouveau clic.
    expect(
      (await buildGraphContext(bruno, { since, excludeClickId: trigger.id }))
        ?.offerClicksSinceStart,
    ).toBe(0);

    const none = await buildGraphContext(alice, { since });
    expect(none).toMatchObject({
      registered: false,
      deposited: false,
      depositCount: 0,
      spendLevel: "AUCUN",
      campaignIds: [],
      channelIds: [channelId],
      offerClicksSinceStart: 0,
    });
    await prisma.member.update({ where: { id: alice }, data: { anonymizedAt: new Date() } });
    expect(await buildGraphContext(alice, { since })).toBeNull();
    await prisma.member.update({ where: { id: alice }, data: { anonymizedAt: null } });
  });

  it("« Tester sur moi » sur un graphe : attentes passées, messages en mode test, aucune étiquette", async () => {
    const graph = linearToGraph([
      { type: "tag", tag: "teste" },
      { type: "wait", hours: 48 },
      { type: "send_message", text: "Test {prenom}" },
    ]);
    const rule = await prisma.automationRule.create({
      data: { name: "Test graphe", trigger: "JOINED", isActive: false, graph },
    });
    const r = await runRuleForMember(rule.id, bruno);
    expect(r).toMatchObject({ status: "DONE", error: null });
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run).toMatchObject({ nodeId: "n3", resumeAt: null, step: 3 });
    expect(logOf(run).map((l) => l.detail)).toEqual([
      "ignoré (test)",
      "2 jours (passée : test)",
      "message via @bot_test",
    ]);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: bruno } })).tags).toEqual(["vip"]);
    const msgs = await outbound(bruno);
    expect(msgs.at(-1)).toMatchObject({ kind: "TEST", text: "Test Bruno" });
  });

  it("graphe invalide en base : l'exécution échoue proprement avec le message", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Graphe cassé",
        trigger: "OFFER_CLICKED",
        isActive: true,
        graph: { version: 1, nodes: [{ id: "t", type: "trigger", position: P }], edges: [] },
      },
    });
    expect(
      await handleEvent({ type: "event", trigger: "OFFER_CLICKED", memberId: bruno, context: {} }),
    ).toEqual({ started: 1 });
    const run = await prisma.automationRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/^Relance à corriger : Reliez le départ/);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
  });

  it("règle linéaire existante (sans graphe) : fonctionne exactement comme avant", async () => {
    await closePending();
    const rule = await prisma.automationRule.create({
      data: {
        name: "Merci dépôt",
        trigger: "DEPOSITED",
        isActive: true,
        actions: [
          { type: "send_message", text: "Merci {prenom} !" },
          { type: "wait", hours: 1 },
          { type: "tag", tag: "deposant" },
        ],
      },
    });
    expect(rule.graph).toBeNull();
    const t0 = new Date();
    expect(
      await handleEvent({ type: "event", trigger: "DEPOSITED", memberId: alice, context: {} }, t0),
    ).toEqual({ started: 1 });
    const pending = await prisma.automationRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(pending).toMatchObject({ status: "PENDING", step: 2, nodeId: null });
    expect(pending.resumeAt?.getTime()).toBe(t0.getTime() + H);
    expect(logOf(pending)).toEqual([
      {
        step: 0,
        type: "send_message",
        at: t0.toISOString(),
        ok: true,
        detail: "message via @bot_test",
      },
      { step: 1, type: "wait", at: t0.toISOString(), ok: true, detail: "1 h" },
    ]);
    expect((await outbound(alice)).at(-1)).toMatchObject({
      kind: "AUTOMATION",
      text: "Merci Alice !",
    });

    expect(await resumePending(new Date(t0.getTime() + 2 * H))).toBe(1);
    const done = await prisma.automationRun.findUniqueOrThrow({ where: { id: pending.id } });
    expect(done).toMatchObject({ status: "DONE", step: 3, nodeId: null, error: null });
    expect(logOf(done).map((l) => [l.step, l.type, "nodeId" in l])).toEqual([
      [0, "send_message", false],
      [1, "wait", false],
      [2, "tag", false],
    ]);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: alice } })).tags).toEqual([
      "relance",
      "deposant",
    ]);
    expect(
      await handleEvent({ type: "event", trigger: "DEPOSITED", memberId: alice, context: {} }),
    ).toEqual({ started: 0 });
  });

  it("une exécution en attente s'arrête si la règle change de forme (liste → graphe) ou est désactivée", async () => {
    await closePending();
    const actions = [
      { type: "wait", hours: 1 },
      { type: "send_message", text: "Après l'attente" },
    ];
    const rule = await prisma.automationRule.create({
      data: { name: "Change de forme", trigger: "REGISTERED", isActive: true, actions },
    });
    const t0 = new Date();
    await handleEvent({ type: "event", trigger: "REGISTERED", memberId: bruno, context: {} }, t0);
    await prisma.automationRule.update({
      where: { id: rule.id },
      data: { graph: linearToGraph(actions as never) },
    });
    const before = (await outbound(bruno)).length;
    expect(await resumePending(new Date(t0.getTime() + 2 * H))).toBe(0);
    const run = await prisma.automationRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run).toMatchObject({
      status: "CANCELLED",
      error: "Relance modifiée pendant l'attente : exécution arrêtée.",
    });
    expect((await outbound(bruno)).length).toBe(before);

    // Graphe en attente puis règle désactivée : arrêt, comme pour une règle linéaire.
    await prisma.automationRule.update({ where: { id: rule.id }, data: { oncePerMember: false } });
    await handleEvent({ type: "event", trigger: "REGISTERED", memberId: bruno, context: {} }, t0);
    const graphRun = await prisma.automationRun.findFirstOrThrow({
      where: { ruleId: rule.id, status: "PENDING" },
    });
    expect(graphRun.nodeId).toBe("n2");
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
    expect(await resumePending(new Date(t0.getTime() + 2 * H))).toBe(0);
    expect(
      await prisma.automationRun.findUniqueOrThrow({ where: { id: graphRun.id } }),
    ).toMatchObject({ status: "CANCELLED", error: "Règle désactivée" });
  });
});
