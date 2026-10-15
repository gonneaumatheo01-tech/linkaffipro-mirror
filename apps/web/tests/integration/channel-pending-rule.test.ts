import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { capturedJobs, createTestBot, resetDb } from "./helpers";

/**
 * Phase 14, sur base réelle : « Leur appliquer la nouvelle règle » (fiche canal → « Qui peut entrer et quand ») et
 * « Tout accepter » (onglet Demandes).
 * Cas du client (15 octobre) : Zone Interdite exigeait « Zone Roulette » et « Tir Cadré » ; le client passe ses canaux
 * en « Proposés ». Les demandes déjà « Attend les canaux » suivent l'ancienne règle tant que l'équipe ne clique pas :
 * le nombre est montré, puis le recalcul les programme (date d'origine pour le délai), sans aucun message. Repasser en
 * « Obligatoires » remet en attente des canaux, sauf la personne qui les a déjà rejoints (nos données) : acceptation
 * programmée et `membership.gate_satisfied` { auto: true }. Aucun appel à Telegram, aucune tâche d'envoi.
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
/** Vérification des liens des canaux à rejoindre à l'enregistrement (appels Telegram) : hors sujet ici. */
vi.mock("@/lib/channels/rule-gate-links", () => ({
  verifyChannelGateLinks: async () => ({ results: [], solutionBot: null }),
  loadExceptionGateViews: async () => ({}),
}));

const actions = await import("@/app/(admin)/channels/[id]/actions");
const { loadOpenRequests } = await import("@/app/(admin)/channels/[id]/tabs/requests");
const { pendingRuleSummaries } = await import("@/lib/channels/pending-rule");
const { isQueuedForApproval } = await import("@/lib/channels/requests");
const { chooseEntry, entryFormFields, entryRuleFromRow, initialEntryState } =
  await import("@/lib/channels/entry-rule");
const { loadGateLinkView } = await import("@/lib/channels/gate-links-server");

async function redirected(fn: () => Promise<unknown>): Promise<URLSearchParams> {
  try {
    await fn();
  } catch (err) {
    return new URLSearchParams(((err as { url?: string }).url ?? "").split("?")[1] ?? "");
  }
  throw new Error("redirection attendue");
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const MIN = 60_000;

describe("demandes en attente et nouvelle règle (base réelle)", () => {
  const c = { zone: "", roulette: "", tir: "" };
  let botId = "";
  let ruleId = "";
  let userId = "";
  const members: Record<string, string> = {};

  /** Demande en cours sur Zone Interdite, avec la règle et la provenance enregistrées par le bot à son arrivée. */
  async function request(
    who: string,
    over: { status: "PENDING_GATE" | "SCHEDULED" | "REQUESTED"; minutesAgo: number } & Record<
      string,
      unknown
    >,
  ) {
    const { minutesAgo, ...rest } = over;
    return prisma.membership.create({
      data: {
        code: `${who}-${Math.random().toString(36).slice(2, 8)}`,
        memberId: members[who]!,
        channelId: c.zone,
        approvalRuleId: ruleId,
        requestedAt: new Date(Date.now() - minutesAgo * MIN),
        source: {
          botId,
          provenance: {
            type: "AD",
            inviteLinkId: null,
            sourceChannelId: null,
            adPlatform: "TIKTOK",
            label: "Pub 1",
          },
          appliedRule: { id: ruleId, scope: "DEFAULT", label: null },
          rule: { id: ruleId, mode: "DELAY", delaySeconds: 300, gateMode: "REQUIRED" },
          gateLinksMissing: [{ channelId: "x", title: "Tir Cadré", error: "", tried: [] }],
        },
        ...rest,
      },
    });
  }

  /** Enregistre la règle par défaut comme le formulaire « Qui peut entrer et quand ». */
  async function saveDefault(gateMode: "REQUIRED" | "SOFT" | "NONE") {
    const base = initialEntryState(null);
    const state =
      gateMode === "NONE"
        ? { ...base, delayPreset: "5m" as const }
        : {
            ...chooseEntry(base, "gate"),
            gateIds: [c.roulette, c.tir],
            gateMode,
            gateDelayPreset: "5m" as const,
          };
    const f = new FormData();
    f.append("channelId", c.zone);
    for (const [k, v] of entryFormFields(state)) f.append(k, v);
    return redirected(() => actions.saveRuleAction(f));
  }

  beforeEach(async () => {
    await resetDb();
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "approval_rule." } } });
    await prisma.auditLog.deleteMany({ where: { action: "membership.approve_all" } });
    const bot = await createTestBot(714, "DATING");
    botId = bot.id;
    const mk = async (n: number, title: string) => {
      const ch = await prisma.channel.create({
        data: {
          telegramChatId: BigInt(-1_001_714_000_000 - n),
          title,
          primaryBotId: bot.id,
          isTest: true,
        },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: ch.id,
          botId: bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      return ch.id;
    };
    c.zone = await mk(1, "Zone Interdite 🔞");
    c.roulette = await mk(2, "LA ZONE ROULETTE 🎰");
    c.tir = await mk(3, "🎯 TIR CADRÉ ⚡");
    ruleId = (
      await prisma.approvalRule.create({
        data: {
          channelId: c.zone,
          name: "Règle par défaut",
          isDefault: true,
          mode: "DELAY",
          delaySeconds: 300,
          gateMode: "REQUIRED",
          gateChannelIds: [c.roulette, c.tir],
          reminderAfterMinutes: [60],
          maxReminders: 1,
        },
      })
    ).id;
    for (const [i, who] of ["aaron", "momilo", "recent", "manuel"].entries())
      members[who] = (
        await prisma.member.create({
          data: { telegramUserId: BigInt(9_140_000 + i), firstName: who },
        })
      ).id;
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `p14-${stamp}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    });
    userId = user.id;
    session.user = { ...user, role: "MANAGER", telegramUserId: null };
  });

  it("canaux passés en « Proposés » : nombre affiché, puis recalcul avec la date d'origine, sans message", async () => {
    const aaron = await request("aaron", { status: "PENDING_GATE", minutesAgo: 120 });
    const momilo = await request("momilo", { status: "PENDING_GATE", minutesAgo: 90 });
    const recent = await request("recent", { status: "PENDING_GATE", minutesAgo: 1 });
    // Même règle qu'à leur arrivée : rien à recalculer, aucun bouton.
    expect(await pendingRuleSummaries(c.zone)).toEqual({});

    // Le client passe les canaux en « Proposés » : la confirmation signale les 3 demandes.
    const saved = await saveDefault("SOFT");
    expect(saved.get("ok")).toContain(
      "3 demandes déjà en attente suivent encore l'ancienne règle : « Leur appliquer la nouvelle règle » est sous le bouton « Enregistrer la règle ».",
    );
    const summaries = await pendingRuleSummaries(c.zone);
    expect(summaries[ruleId]).toEqual({
      ruleId,
      count: 3,
      byStatus: { REQUESTED: 0, PENDING_GATE: 0, SCHEDULED: 3 },
      acceptNow: 2,
      kept: 0,
    });
    // Rien n'a bougé tant que l'équipe n'a pas cliqué.
    expect(
      (await prisma.membership.findMany({ where: { channelId: c.zone } })).map((m) => m.status),
    ).toEqual(["PENDING_GATE", "PENDING_GATE", "PENDING_GATE"]);

    const before = Date.now();
    const q = await redirected(() =>
      actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId })),
    );
    expect(q.get("ok")).toBe(
      "Nouvelle règle appliquée à 3 demandes en attente : 3 acceptations programmées (2 tout de suite). Aucun message n'a été envoyé.",
    );
    const byId = Object.fromEntries(
      (await prisma.membership.findMany({ where: { channelId: c.zone } })).map((m) => [m.id, m]),
    );
    for (const id of [aaron.id, momilo.id]) {
      expect(byId[id]!.status).toBe("SCHEDULED");
      // Délai de 5 minutes déjà écoulé depuis la demande : acceptée au prochain passage.
      expect(byId[id]!.approveAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(byId[id]!.approveAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(byId[id]!.expiresAt).toBeNull();
    }
    // Demande d'il y a 1 minute : acceptée 5 minutes après sa demande.
    expect(byId[recent.id]!.status).toBe("SCHEDULED");
    expect(
      Math.abs(byId[recent.id]!.approveAt!.getTime() - (recent.requestedAt.getTime() + 5 * MIN)),
    ).toBeLessThan(1000);
    // Carte de la demande : la règle qui s'applique désormais ; le point « À faire » des liens manquants disparaît.
    const src = byId[aaron.id]!.source as Record<string, unknown>;
    expect(src.rule).toMatchObject({ id: ruleId, gateMode: "SOFT", delaySeconds: 300 });
    expect(typeof src.ruleAppliedAt).toBe("string");
    expect(src.gateLinksMissing).toEqual([]);
    expect(src.provenance).toMatchObject({ type: "AD", label: "Pub 1" });

    // Journal : un événement par demande, l'action de l'équipe avec le nombre et les états.
    const events = await prisma.event.findMany({ where: { type: "membership.rule_applied" } });
    expect(events).toHaveLength(3);
    expect(events[0]!.payload).toMatchObject({
      ruleId,
      previousStatus: "PENDING_GATE",
      status: "SCHEDULED",
      byUserId: userId,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: "approval_rule.applied_to_pending" },
    });
    expect(audit).toMatchObject({ userId, entityType: "ApprovalRule", entityId: ruleId });
    expect(audit!.metadata).toMatchObject({
      channelId: c.zone,
      ruleId,
      count: 3,
      byStatus: { SCHEDULED: 3, PENDING_GATE: 0, REQUESTED: 0 },
    });
    // Aucun message (ni accueil, ni « Canaux rejoints »), aucune tâche d'envoi.
    expect(await prisma.outboundMessage.count()).toBe(0);
    expect(capturedJobs("telegram-send")).toEqual([]);
    // Le bouton disparaît : plus rien à recalculer.
    expect(await pendingRuleSummaries(c.zone)).toEqual({});
  });

  it("validation à la main → canaux obligatoires : rejoints d'après nos données → programmée, jamais d'attente sans boutons ni de demande acceptée par l'équipe reprise", async () => {
    // Avant : l'équipe validait chaque demande à la main ; l'accueil montrait déjà les canaux à rejoindre.
    await prisma.approvalRule.update({ where: { id: ruleId }, data: { mode: "MANUAL" } });
    // Acceptée par l'équipe (« Tout accepter », seule demande à valider à ce moment-là) : jamais remise en attente.
    const recent = await request("recent", { status: "REQUESTED", minutesAgo: 10 });
    await redirected(() =>
      actions.approveAllRequestsAction(
        fd({ channelId: c.zone, filter: "manual", asOf: new Date().toISOString(), expected: "1" }),
      ),
    );
    const queued = await prisma.membership.findUniqueOrThrow({ where: { id: recent.id } });
    expect(isQueuedForApproval(queued)).toBe(true);
    const later = queued.approveAt!;
    const gates = [{ channelId: c.roulette, title: "LA ZONE ROULETTE 🎰", url: "https://t.me/+r" }];
    const aaron = await request("aaron", { status: "REQUESTED", minutesAgo: 30 });
    await prisma.membership.update({
      where: { id: aaron.id },
      data: { source: { ...(aaron.source as object), gates } },
    });
    const momilo = await request("momilo", { status: "REQUESTED", minutesAgo: 30 });
    await prisma.membership.update({
      where: { id: momilo.id },
      data: { source: { ...(momilo.source as object), gates } },
    });
    // Accueil sans boutons de canaux : la mettre « en attente des canaux » la bloquerait.
    const manuel = await request("manuel", { status: "REQUESTED", minutesAgo: 30 });
    // Aaron est déjà membre de Zone Roulette et a une demande en cours dans Tir Cadré (nos données) ; Momilo est
    // parti de Tir Cadré.
    const joined = (who: string, channelId: string, status: "APPROVED" | "PENDING_GATE" | "LEFT") =>
      prisma.membership.create({
        data: {
          code: `${who}-${channelId}`,
          memberId: members[who]!,
          channelId,
          status,
          requestedAt: new Date(Date.now() - 60 * MIN),
        },
      });
    await joined("aaron", c.roulette, "APPROVED");
    await joined("aaron", c.tir, "PENDING_GATE");
    await joined("momilo", c.roulette, "APPROVED");
    await joined("momilo", c.tir, "LEFT");

    await saveDefault("REQUIRED");
    expect((await pendingRuleSummaries(c.zone))[ruleId]).toEqual({
      ruleId,
      count: 2,
      byStatus: { SCHEDULED: 1, PENDING_GATE: 1, REQUESTED: 0 },
      acceptNow: 0,
      // Manuel : accueil sans les canaux, il garde son état (dit dans la fenêtre de confirmation).
      kept: 1,
    });
    const before = Date.now();
    const q = await redirected(() =>
      actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId })),
    );
    expect(q.get("ok")).toBe(
      "Nouvelle règle appliquée à 2 demandes en attente : 1 acceptation programmée et 1 attend encore les canaux obligatoires. Aucun message n'a été envoyé. 1 autre demande garde son état : l'accueil du bot ne lui a pas montré les canaux à rejoindre.",
    );
    const a = await prisma.membership.findUniqueOrThrow({ where: { id: aaron.id } });
    expect(a.status).toBe("SCHEDULED");
    expect(a.gateSatisfiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // « Puis accepter » 5 minutes après les canaux rejoints (maintenant).
    expect(
      Math.abs(a.approveAt!.getTime() - (a.gateSatisfiedAt!.getTime() + 5 * MIN)),
    ).toBeLessThan(1000);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: momilo.id } })).status).toBe(
      "PENDING_GATE",
    );
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: manuel.id } })).status).toBe(
      "REQUESTED",
    );
    const r = await prisma.membership.findUniqueOrThrow({ where: { id: recent.id } });
    expect(r.status).toBe("SCHEDULED");
    expect(r.approveAt!.getTime()).toBe(later.getTime());
    const gate = await prisma.event.findMany({ where: { type: "membership.gate_satisfied" } });
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ memberId: members.aaron, channelId: c.zone, botId });
    expect(gate[0]!.payload).toMatchObject({
      membershipId: aaron.id,
      auto: true,
      trigger: "rule_applied",
    });
    expect(await prisma.outboundMessage.count()).toBe(0);
    expect(await pendingRuleSummaries(c.zone)).toEqual({});
  });

  it("« 2 jours » → « à la main » : les demandes programmées repassent à valider à la main, sauf celles en train d'être acceptées", async () => {
    await prisma.approvalRule.update({
      where: { id: ruleId },
      data: { delaySeconds: 2 * 86400, gateMode: "NONE", gateChannelIds: [] },
    });
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * MIN + 2 * 86400_000);
    const s1 = await request("aaron", { status: "SCHEDULED", minutesAgo: 60, approveAt: at(60) });
    const s2 = await request("momilo", {
      status: "SCHEDULED",
      minutesAgo: 180,
      approveAt: at(180),
    });
    // Heure passée : le service d'arrière-plan l'accepte en ce moment.
    const due = await request("manuel", {
      status: "SCHEDULED",
      minutesAgo: 3000,
      approveAt: new Date(Date.now() - MIN),
    });
    // Acceptée par l'équipe juste avant (« Tout accepter ») : elle entre quand même.
    const accepted = await request("recent", { status: "REQUESTED", minutesAgo: 5 });
    await redirected(() =>
      actions.approveAllRequestsAction(
        fd({ channelId: c.zone, filter: "manual", asOf: new Date().toISOString(), expected: "1" }),
      ),
    );
    // Même règle : rien à recalculer (les heures prévues suivent déjà « 2 jours »).
    expect(await pendingRuleSummaries(c.zone)).toEqual({});

    // Le client passe en validation à la main.
    await prisma.approvalRule.update({ where: { id: ruleId }, data: { mode: "MANUAL" } });
    expect((await pendingRuleSummaries(c.zone))[ruleId]).toEqual({
      ruleId,
      count: 2,
      byStatus: { SCHEDULED: 0, PENDING_GATE: 0, REQUESTED: 2 },
      acceptNow: 0,
      kept: 0,
    });
    const q = await redirected(() =>
      actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId })),
    );
    expect(q.get("ok")).toBe(
      "Nouvelle règle appliquée à 2 demandes en attente : 2 à valider à la main. Aucun message n'a été envoyé.",
    );
    for (const id of [s1.id, s2.id]) {
      const m = await prisma.membership.findUniqueOrThrow({ where: { id } });
      expect([m.status, m.approveAt]).toEqual(["REQUESTED", null]);
    }
    const d = await prisma.membership.findUniqueOrThrow({ where: { id: due.id } });
    expect(d.status).toBe("SCHEDULED");
    const a = await prisma.membership.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(a.status).toBe("SCHEDULED");
    expect(isQueuedForApproval(a)).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "approval_rule.applied_to_pending" },
    });
    expect(audit!.metadata).toMatchObject({ count: 2, byStatus: { REQUESTED: 2 }, kept: 0 });
    expect(await pendingRuleSummaries(c.zone)).toEqual({});

    // Puis délai allongé à « 3 jours » avec acceptation automatique : repoussées à leur date de demande + 3 jours.
    await prisma.approvalRule.update({
      where: { id: ruleId },
      data: { mode: "DELAY", delaySeconds: 3 * 86400 },
    });
    expect((await pendingRuleSummaries(c.zone))[ruleId]).toMatchObject({
      count: 2,
      byStatus: { SCHEDULED: 2 },
    });
    await redirected(() => actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId })));
    const r1 = await prisma.membership.findUniqueOrThrow({ where: { id: s1.id } });
    expect(r1.status).toBe("SCHEDULED");
    expect(
      Math.abs(r1.approveAt!.getTime() - (s1.requestedAt.getTime() + 3 * 86400_000)),
    ).toBeLessThan(1000);
  });

  it("une expiration ajoutée à la règle ne fait pas expirer les demandes déjà là", async () => {
    await request("aaron", { status: "PENDING_GATE", minutesAgo: 600 });
    await prisma.approvalRule.update({
      where: { id: ruleId },
      data: { expireAfterHours: 1, expireAction: "DECLINE" },
    });
    expect(await pendingRuleSummaries(c.zone)).toEqual({});
  });

  it("une exception : seules ses demandes ; exception désactivée : jamais réappliquée", async () => {
    const exception = await prisma.approvalRule.create({
      data: {
        channelId: c.zone,
        name: "Venu d'une pub TikTok",
        label: "Venu d'une pub TikTok",
        isDefault: false,
        scope: "SOURCE_KIND",
        sourceKind: "AD_TIKTOK",
        mode: "DELAY",
        delaySeconds: 3600,
        gateMode: "NONE",
        gateChannelIds: [],
        reminderAfterMinutes: [],
        maxReminders: 0,
        sortOrder: 10,
      },
    });
    const own = await prisma.membership.create({
      data: {
        code: "exc-1",
        memberId: members.manuel!,
        channelId: c.zone,
        status: "REQUESTED",
        approvalRuleId: exception.id,
        requestedAt: new Date(Date.now() - 10 * MIN),
        source: {
          appliedRule: { id: exception.id, scope: "SOURCE_KIND", label: "Venu d'une pub TikTok" },
        },
      },
    });
    const other = await request("aaron", { status: "PENDING_GATE", minutesAgo: 30 });
    const summaries = await pendingRuleSummaries(c.zone);
    expect(Object.keys(summaries)).toEqual([exception.id]);

    await prisma.approvalRule.update({ where: { id: exception.id }, data: { isActive: false } });
    expect(await pendingRuleSummaries(c.zone)).toEqual({});
    const refused = await redirected(() =>
      actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId: exception.id })),
    );
    expect(refused.get("error")).toMatch(/^Cette exception est désactivée/);

    await prisma.approvalRule.update({ where: { id: exception.id }, data: { isActive: true } });
    await redirected(() =>
      actions.applyRuleToPendingAction(fd({ channelId: c.zone, ruleId: exception.id })),
    );
    const o = await prisma.membership.findUniqueOrThrow({ where: { id: own.id } });
    expect(o.status).toBe("SCHEDULED");
    // 1 heure après sa demande (il y a 10 minutes) : dans 50 minutes.
    expect(Math.abs(o.approveAt!.getTime() - (own.requestedAt.getTime() + 60 * MIN))).toBeLessThan(
      1000,
    );
    // La demande de la règle par défaut n'est pas touchée.
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "PENDING_GATE",
    );
  });

  it("« Tout accepter » : une tâche d'acceptation par demande affichée (file telegram-send), journal avec le nombre", async () => {
    const g1 = await request("aaron", { status: "PENDING_GATE", minutesAgo: 120 });
    const g2 = await request("momilo", { status: "PENDING_GATE", minutesAgo: 60 });
    const manual = await request("manuel", { status: "REQUESTED", minutesAgo: 30 });
    // Déjà programmée pour bientôt : le passage des 20 secondes ne doit plus la prendre en même temps que la tâche.
    const soon = await request("recent", {
      status: "SCHEDULED",
      minutesAgo: 3,
      approveAt: new Date(Date.now() + 60_000),
    });
    // Liste affichée il y a 10 secondes avec 2 demandes « Attend les canaux ».
    const asOf = new Date(Date.now() - 10_000).toISOString();
    // Arrivée après l'affichage (pendant que la fenêtre de confirmation était ouverte) : pas acceptée.
    const late = await prisma.membership.create({
      data: {
        code: `late-${Math.random().toString(36).slice(2, 8)}`,
        memberId: members.recent!,
        channelId: c.zone,
        approvalRuleId: ruleId,
        status: "PENDING_GATE",
        requestedAt: new Date(),
      },
    });
    const before = Date.now();
    const q = await redirected(() =>
      actions.approveAllRequestsAction(
        fd({ channelId: c.zone, filter: "gate", asOf, expected: "2" }),
      ),
    );
    expect(q.get("tab")).toBe("requests");
    expect(q.get("status")).toBe("gate");
    expect(q.get("ok")).toBe(
      "2 demandes seront acceptées dans les prochaines minutes, au rythme permis par Telegram.",
    );
    const firstIds = [g1.id, g2.id].map((id) => `approve:${id}:${new Date(asOf).getTime()}`);
    expect(capturedJobs("telegram-send").map((j) => [j.data, j.opts.jobId])).toEqual(
      [g1.id, g2.id].map((id, i) => [
        { type: "approve", membershipId: id, byUserId: userId },
        firstIds[i],
      ]),
    );
    for (const id of [g1.id, g2.id]) {
      const m = await prisma.membership.findUniqueOrThrow({ where: { id } });
      // En file d'acceptation : heure de secours dans 10 minutes (écrite en UTC comme Prisma), sans expiration, marque
      // « Tout accepter » ajoutée à la source (provenance gardée) ; la carte dit « Acceptation en cours ».
      expect([m.status, m.expiresAt]).toEqual(["SCHEDULED", null]);
      expect(m.approveAt!.getTime()).toBeGreaterThanOrEqual(before + 10 * MIN - 1000);
      expect(m.approveAt!.getTime()).toBeLessThanOrEqual(Date.now() + 10 * MIN + 1000);
      const src = m.source as Record<string, unknown>;
      expect(src.approveAll).toMatchObject({
        byUserId: userId,
        fallbackAt: m.approveAt!.toISOString(),
      });
      expect(src.provenance).toMatchObject({ type: "AD", label: "Pub 1" });
      expect(isQueuedForApproval(m)).toBe(true);
      expect(m.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
    // La tâche n'aboutit pas (aucun bot administrateur à ce moment-là, trois refus de Telegram, ancien service pendant
    // un déploiement) : le passage des 20 secondes du service d'arrière-plan (même requête) les prend à l'heure de
    // secours, jamais avant.
    const tick = (minutesLater: number) =>
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT m.id FROM "Membership" m
        JOIN "Channel" c ON c.id = m."channelId" AND c."isActive"
        WHERE m.status = 'SCHEDULED' AND m."approveAt" IS NOT NULL
          AND m."approveAt" <= NOW() + make_interval(mins => ${minutesLater}::int)
        ORDER BY m."approveAt" ASC`;
    expect((await tick(0)).map((r) => r.id)).not.toContain(g1.id);
    expect((await tick(11)).map((r) => r.id)).toEqual(expect.arrayContaining([g1.id, g2.id]));
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: late.id } })).status).toBe(
      "PENDING_GATE",
    );
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe(
      "REQUESTED",
    );
    const audit = await prisma.auditLog.findFirst({ where: { action: "membership.approve_all" } });
    expect(audit).toMatchObject({ userId, entityType: "Channel", entityId: c.zone });
    expect(audit!.metadata).toMatchObject({
      channelId: c.zone,
      filter: "gate",
      count: 2,
      queued: 2,
      byStatus: { PENDING_GATE: 2 },
    });
    // C'est le service d'arrière-plan qui accepte (limites de Telegram) : rien d'envoyé ici.
    expect(await prisma.outboundMessage.count()).toBe(0);

    // La liste a grossi depuis l'affichage (« Toutes » : 4 demandes, la fenêtre en annonçait 3) : rien n'est accepté.
    const grew = await redirected(() =>
      actions.approveAllRequestsAction(
        fd({ channelId: c.zone, filter: "all", asOf: new Date().toISOString(), expected: "3" }),
      ),
    );
    expect(grew.get("error")).toBe(
      "La liste a changé depuis l'affichage : vérifiez les demandes, puis cliquez à nouveau « Tout accepter ».",
    );
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe(
      "REQUESTED",
    );

    // Puis « Toutes », avec le bon nombre (les tâches de g1 et g2 n'ont pas abouti) : la demande à valider à la main
    // et celle déjà programmée aussi, et une NOUVELLE tâche pour g1 et g2 (autre identifiant : la file garde encore
    // l'ancienne, terminée ou en échec, et ignorerait un identifiant identique).
    const asOf2 = new Date();
    const all = await redirected(() =>
      actions.approveAllRequestsAction(
        fd({ channelId: c.zone, filter: "all", asOf: asOf2.toISOString(), expected: "5" }),
      ),
    );
    expect(all.get("status")).toBeNull();
    expect(all.get("ok")).toMatch(/^5 demandes seront acceptées/);
    const s = await prisma.membership.findUniqueOrThrow({ where: { id: soon.id } });
    expect(s.status).toBe("SCHEDULED");
    expect(isQueuedForApproval(s)).toBe(true);
    expect(s.approveAt!.getTime()).toBeGreaterThan(Date.now() + 9 * MIN);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe(
      "SCHEDULED",
    );
    const ids = capturedJobs("telegram-send").map((j) => j.opts.jobId);
    expect(new Set(ids)).toEqual(
      new Set([
        ...firstIds,
        ...[g1.id, g2.id, manual.id, soon.id, late.id].map(
          (id) => `approve:${id}:${asOf2.getTime()}`,
        ),
      ]),
    );
    expect(ids).toHaveLength(7);
  });

  it("onglet Demandes : chaque filtre montre ses demandes les plus récentes, même au-delà des plus récentes de toutes", async () => {
    // 3 demandes « Attend les canaux » récentes, 2 demandes « à valider à la main » plus anciennes ; 3 cartes au plus.
    const manual1 = await request("manuel", { status: "REQUESTED", minutesAgo: 600 });
    const manual2 = await request("manuel", { status: "REQUESTED", minutesAgo: 500 });
    for (const [who, min] of [
      ["aaron", 30],
      ["momilo", 20],
      ["recent", 10],
    ] as const)
      await request(who, { status: "PENDING_GATE", minutesAgo: min });
    const { requests, counts } = await loadOpenRequests(c.zone, 3);
    expect(counts).toEqual({ all: 5, gate: 3, scheduled: 0, manual: 2 });
    // Les 3 plus récentes (« Toutes »), puis les demandes à valider, relues à part ; de la plus récente à la plus ancienne.
    expect(requests.map((r) => r.status)).toEqual([
      "PENDING_GATE",
      "PENDING_GATE",
      "PENDING_GATE",
      "REQUESTED",
      "REQUESTED",
    ]);
    expect(requests.slice(3).map((r) => r.id)).toEqual([manual2.id, manual1.id]);
    // Avec la limite habituelle : une seule lecture suffit, rien en double.
    const usual = await loadOpenRequests(c.zone);
    expect(usual.requests).toHaveLength(5);
    expect(new Set(usual.requests.map((r) => r.id)).size).toBe(5);
  });

  it("canaux « Proposés » : le cadre des liens ne promet plus « ✅ J'ai rejoint »", async () => {
    await saveDefault("SOFT");
    const rule = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, isDefault: true },
    });
    await prisma.inviteLink.createMany({
      data: [c.roulette, c.tir].map((id, i) => ({
        botId,
        channelId: id,
        kind: "GATE" as const,
        sourceChannelId: c.zone,
        name: `Lien ${i}`,
        telegramInviteLink: `https://t.me/+soft${i}`,
        createsJoinRequest: true,
      })),
    });
    const view = await loadGateLinkView(c.zone, entryRuleFromRow(rule));
    expect(view!.summary).toEqual({
      ok: true,
      text: "Tout est prêt : le bot envoie un bouton par canal.",
    });
    // Repassés en « Obligatoires » : le bouton « ✅ J'ai rejoint » est de nouveau annoncé.
    await saveDefault("REQUIRED");
    const required = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: c.zone, isDefault: true },
    });
    expect((await loadGateLinkView(c.zone, entryRuleFromRow(required)))!.summary.text).toBe(
      "Tout est prêt : le bot envoie un bouton par canal et « ✅ J'ai rejoint ».",
    );
  });
});
