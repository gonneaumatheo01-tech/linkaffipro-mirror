import { describe, expect, it } from "vitest";
import {
  appliedMessage,
  applyConfirmText,
  beingAccepted,
  effectiveRuleOf,
  keptAsIs,
  latestStatusLookup,
  mayChange,
  channelsShown,
  pendingFlash,
  pendingRuleView,
  pendingSentence,
  planPending,
  ruleIdOf,
  sourceAfterRecalc,
  summarize,
  targetFor,
  writeFor,
  type PendingMembership,
  type PendingRuleRow,
} from "./pending-rule";

/**
 * « Leur appliquer la nouvelle règle » (phase 14) : plan pur, sans base. Cas du client : Zone Interdite passe ses
 * canaux de « Obligatoires » à « Proposés » ; les demandes « Attend les canaux » doivent être acceptées 5 minutes après
 * leur demande (déjà écoulées : tout de suite), sans aucun message.
 */

const now = new Date("2026-10-15T03:40:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const inMin = (min: number) => new Date(now.getTime() + min * 60_000);

type Row = PendingRuleRow & { isActive: boolean };

const row = (over: Partial<Row> = {}): Row => ({
  id: "def",
  channelId: "zone",
  name: "Règle par défaut",
  isDefault: true,
  scope: "DEFAULT",
  isActive: true,
  mode: "DELAY",
  delaySeconds: 300,
  gateMode: "REQUIRED",
  gateChannelIds: ["roulette", "tir"],
  reminderAfterMinutes: [60, 1440],
  maxReminders: 2,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
  sendWelcome: true,
  ...over,
});

const pending = (over: Partial<PendingMembership> = {}): PendingMembership => ({
  id: "m1",
  memberId: "aaron",
  channelId: "zone",
  status: "PENDING_GATE",
  requestedAt: ago(120),
  approveAt: null,
  expiresAt: null,
  gateSatisfiedAt: null,
  approvalRuleId: "def",
  source: {
    provenance: { type: "AD", inviteLinkId: "pub1", sourceChannelId: null, adPlatform: "TIKTOK" },
    appliedRule: { id: "def", scope: "DEFAULT", label: null },
  },
  ...over,
});

describe("règle d'une demande en cours", () => {
  it("la règle appliquée à son arrivée : `approvalRuleId`, sinon `source.appliedRule.id`", () => {
    expect(ruleIdOf(pending())).toBe("def");
    expect(ruleIdOf(pending({ approvalRuleId: null }))).toBe("def");
    expect(ruleIdOf(pending({ approvalRuleId: null, source: {} }))).toBeNull();
    expect(ruleIdOf(pending({ approvalRuleId: null, source: { appliedRule: null } }))).toBeNull();
  });

  it("canaux effectifs : jamais celui d'où vient la personne ; aucun pour une personne venue d'un canal obligatoire", () => {
    const fromTir = pending({
      source: {
        provenance: { type: "GATE", inviteLinkId: "g1", sourceChannelId: "tir", adPlatform: null },
        appliedRule: { id: "def", scope: "DEFAULT", label: null, noGates: true },
      },
    });
    expect(effectiveRuleOf(fromTir, row()).gateChannelIds).toEqual([]);
    const shared = pending({
      source: {
        provenance: { type: "SHARE", inviteLinkId: "s1", sourceChannelId: "tir", adPlatform: null },
      },
    });
    expect(effectiveRuleOf(shared, row()).gateChannelIds).toEqual(["roulette"]);
  });
});

describe("nouvel état d'une demande (date d'origine pour le délai)", () => {
  const none = () => false;
  const plan = (m: PendingMembership, r: Row) => {
    const rule = effectiveRuleOf(m, r);
    return { membership: m, ruleId: r.id, rule, target: targetFor(m, rule) };
  };

  it("Zone Interdite : canaux passés en « Proposés » → acceptation 5 minutes après la demande", () => {
    const old = pending({ requestedAt: ago(120) });
    const p = plan(old, row({ gateMode: "SOFT" }));
    expect(p.target).toEqual({ status: "SCHEDULED", approveAt: ago(115), gateChannelIds: [] });
    expect(mayChange(old, p.target, now)).toBe(true);
    // Délai déjà écoulé : acceptée au prochain passage (maintenant).
    expect(writeFor(p, none, now)).toEqual({
      status: "SCHEDULED",
      approveAt: now,
      expiresAt: null,
      gateSatisfiedAt: null,
    });
    // Demande d'il y a 1 minute : acceptée 4 minutes plus tard (5 minutes après sa demande).
    expect(
      writeFor(plan(pending({ requestedAt: ago(1) }), row({ gateMode: "SOFT" })), none, now)!
        .approveAt,
    ).toEqual(inMin(4));
  });

  it("sans canaux, ou tout de suite : acceptation à la date de la demande + délai", () => {
    const none2 = row({ gateMode: "NONE", gateChannelIds: [] });
    expect(
      targetFor(pending({ requestedAt: ago(2) }), effectiveRuleOf(pending(), none2)).approveAt,
    ).toEqual(inMin(3));
    const immediate = row({ mode: "IMMEDIATE", gateMode: "NONE" });
    expect(
      writeFor(plan(pending({ requestedAt: ago(2) }), immediate), none, now)!.approveAt,
    ).toEqual(now);
  });

  it("validation à la main → à valider à la main, en gardant son expiration", () => {
    const m = pending({ requestedAt: ago(60), expiresAt: inMin(600) });
    const p = plan(m, row({ mode: "MANUAL", expireAfterHours: 1 }));
    expect(p.target.status).toBe("REQUESTED");
    expect(writeFor(p, none, now)).toEqual({
      status: "REQUESTED",
      approveAt: null,
      expiresAt: inMin(600),
      gateSatisfiedAt: null,
    });
  });

  it("canaux obligatoires déjà rejoints : le délai part du moment où ils l'ont été", () => {
    const joined = pending({ status: "SCHEDULED", gateSatisfiedAt: ago(3), approveAt: inMin(2) });
    const p = plan(joined, row());
    expect(p.target).toMatchObject({ status: "SCHEDULED", approveAt: inMin(2) });
    expect(mayChange(joined, p.target, now)).toBe(false);
    // Délai raccourci à « tout de suite » : acceptée maintenant.
    const fast = plan(joined, row({ delaySeconds: 0 }));
    expect(writeFor(fast, none, now)).toMatchObject({ status: "SCHEDULED", approveAt: now });
  });

  it("même règle : rien ne change ; l'expiration n'est jamais recalculée", () => {
    const m = pending();
    expect(mayChange(m, plan(m, row()).target, now)).toBe(false);
    // Une expiration ajoutée à la règle ne fait pas expirer d'un coup les demandes déjà là.
    expect(
      mayChange(m, plan(m, row({ expireAfterHours: 1, expireAction: "DECLINE" })).target, now),
    ).toBe(false);
  });

  it("une demande programmée est recalculée comme si elle arrivait maintenant (décision E7)", () => {
    // Programmée par l'ancienne règle « 2 jours » : acceptation dans 30 minutes, accueil sans les canaux.
    const promised = pending({ status: "SCHEDULED", approveAt: inMin(30), requestedAt: ago(10) });
    // Le client passe en validation à la main : la demande est à valider à la main, plus d'acceptation toute seule.
    const manual = plan(promised, row({ mode: "MANUAL" }));
    expect(manual.target.status).toBe("REQUESTED");
    expect(mayChange(promised, manual.target, now)).toBe(true);
    expect(writeFor(manual, none, now)).toEqual({
      status: "REQUESTED",
      approveAt: null,
      expiresAt: null,
      gateSatisfiedAt: null,
    });
    // Canaux devenus obligatoires, rejoints d'après nos données : acceptée 5 minutes après maintenant.
    const req = plan(promised, row());
    expect(req.target.status).toBe("PENDING_GATE");
    expect(writeFor(req, () => true, now)).toEqual({
      status: "SCHEDULED",
      approveAt: inMin(5),
      expiresAt: null,
      gateSatisfiedAt: now,
    });
    // Pas rejoints, et l'accueil lui a montré les canaux : « Attend les canaux ».
    const shown = pending({
      status: "SCHEDULED",
      approveAt: inMin(30),
      requestedAt: ago(10),
      source: { gates: [{ channelId: "tir", title: "Tir Cadré", url: "https://t.me/+x" }] },
    });
    expect(writeFor(plan(shown, row()), none, now)).toEqual({
      status: "PENDING_GATE",
      approveAt: null,
      expiresAt: null,
      gateSatisfiedAt: null,
    });
    // Pas rejoints, accueil sans les canaux : elle resterait bloquée sans boutons, elle garde son heure.
    expect(writeFor(req, none, now)).toBeNull();
    expect(keptAsIs(req, writeFor(req, none, now))).toBe(true);
    expect(keptAsIs(manual, writeFor(manual, none, now))).toBe(false);
    // Délai allongé : repoussée à la date de la demande + le nouveau délai ; raccourci : avancée.
    const later = plan(promised, row({ gateMode: "SOFT", delaySeconds: 86400 }));
    expect(mayChange(promised, later.target, now)).toBe(true);
    expect(writeFor(later, none, now)!.approveAt).toEqual(new Date(ago(10).getTime() + 86_400_000));
    const sooner = plan(promised, row({ gateMode: "SOFT", delaySeconds: 600 }));
    expect(mayChange(promised, sooner.target, now)).toBe(true);
    expect(writeFor(sooner, none, now)!.approveAt).toEqual(new Date(ago(10).getTime() + 600_000));
    // Même heure : rien ne change.
    const same = plan(promised, row({ gateMode: "SOFT", delaySeconds: 40 * 60 }));
    expect(mayChange(promised, same.target, now)).toBe(false);
  });

  it("une demande en train d'être acceptée n'est jamais touchée (heure passée, ou « Tout accepter »)", () => {
    // Déjà due : le passage des 20 secondes l'accepte en ce moment.
    const due = pending({ status: "SCHEDULED", approveAt: ago(1), requestedAt: ago(30) });
    for (const r of [
      row({ mode: "MANUAL" }),
      row(),
      row({ gateMode: "SOFT", delaySeconds: 86400 }),
    ])
      expect(mayChange(due, plan(due, r).target, now)).toBe(false);
    // Acceptée par l'équipe (« Tout accepter ») : heure de secours dans 10 minutes, marque dans la source.
    const queued = pending({
      status: "SCHEDULED",
      approveAt: inMin(10),
      requestedAt: ago(30),
      source: {
        approveAll: { at: now.toISOString(), byUserId: "u1", fallbackAt: inMin(10).toISOString() },
      },
    });
    expect(beingAccepted(queued, now)).toBe(true);
    for (const r of [row({ mode: "MANUAL" }), row(), row({ gateMode: "SOFT", delaySeconds: 0 })])
      expect(mayChange(queued, plan(queued, r).target, now)).toBe(false);
    expect(beingAccepted(pending({ status: "SCHEDULED", approveAt: inMin(10) }), now)).toBe(false);
    expect(beingAccepted(pending({ status: "PENDING_GATE" }), now)).toBe(false);
  });

  it("à valider → canaux obligatoires : en attente seulement si l'accueil a montré les canaux", () => {
    const shown = pending({
      status: "REQUESTED",
      expiresAt: inMin(60),
      source: { gates: [{ channelId: "tir", title: "Tir Cadré", url: "https://t.me/+x" }] },
    });
    const p = plan(shown, row());
    expect(channelsShown(shown.source)).toBe(true);
    expect(writeFor(p, none, now)).toEqual({
      status: "PENDING_GATE",
      approveAt: null,
      expiresAt: inMin(60),
      gateSatisfiedAt: null,
    });
    // Accueil sans boutons : elle resterait bloquée, elle garde son état (sauf canaux déjà rejoints).
    const hidden = pending({ status: "REQUESTED", source: {} });
    expect(channelsShown(hidden.source)).toBe(false);
    expect(writeFor(plan(hidden, row()), none, now)).toBeNull();
    expect(writeFor(plan(hidden, row()), () => true, now)).toMatchObject({
      status: "SCHEDULED",
      approveAt: inMin(5),
    });
  });
});

describe("plan d'un canal", () => {
  const ms = [
    pending({ id: "a", memberId: "aaron" }),
    pending({ id: "b", memberId: "momilo", requestedAt: ago(1) }),
    pending({ id: "c", memberId: "x", approvalRuleId: "autre" }),
    pending({ id: "d", memberId: "y", approvalRuleId: null, source: {} }),
  ];

  it("seulement les demandes de la règle, d'une règle active, qui changeraient", () => {
    const rows = [row({ gateMode: "SOFT" }), row({ id: "autre", isDefault: false })];
    expect(planPending(ms, rows, now).map((p) => p.membership.id)).toEqual(["a", "b"]);
    expect(planPending(ms, [row({ gateMode: "SOFT", isActive: false })], now)).toEqual([]);
    // Règle d'un autre canal : jamais appliquée ici.
    expect(planPending(ms, [row({ gateMode: "SOFT", channelId: "ailleurs" })], now)).toEqual([]);
  });

  it("canaux obligatoires vérifiés avec nos données : la dernière demande de la personne dans chaque canal", () => {
    const lookup = latestStatusLookup([
      { memberId: "aaron", channelId: "roulette", status: "APPROVED" },
      { memberId: "aaron", channelId: "tir", status: "PENDING_GATE" },
      { memberId: "momilo", channelId: "roulette", status: "LEFT" },
      { memberId: "momilo", channelId: "roulette", status: "APPROVED" },
      { memberId: "momilo", channelId: "tir", status: "APPROVED" },
    ]);
    expect(lookup("aaron", ["roulette", "tir"])).toBe(true);
    // Dernière demande « partie » : le canal n'est plus rejoint.
    expect(lookup("momilo", ["roulette", "tir"])).toBe(false);
    expect(lookup("aaron", [])).toBe(false);
    expect(lookup("inconnu", ["tir"])).toBe(false);
  });

  it("résumé : nombre, état d'arrivée, acceptées tout de suite", () => {
    const s = summarize(
      "def",
      [
        { status: "SCHEDULED", approveAt: now, expiresAt: null, gateSatisfiedAt: null },
        { status: "SCHEDULED", approveAt: inMin(4), expiresAt: null, gateSatisfiedAt: null },
        { status: "PENDING_GATE", approveAt: null, expiresAt: null, gateSatisfiedAt: null },
        { status: "REQUESTED", approveAt: null, expiresAt: null, gateSatisfiedAt: null },
      ],
      now,
    );
    expect(s).toEqual({
      ruleId: "def",
      count: 4,
      byStatus: { SCHEDULED: 2, PENDING_GATE: 1, REQUESTED: 1 },
      acceptNow: 1,
      kept: 0,
    });
  });
});

describe("textes", () => {
  const s = {
    ruleId: "def",
    count: 37,
    byStatus: { SCHEDULED: 30, PENDING_GATE: 5, REQUESTED: 2 },
    acceptNow: 25,
  };

  it("phrase sous « Enregistrer la règle »", () => {
    expect(pendingSentence(37)).toBe("37 demandes déjà en attente suivent l'ancienne règle.");
    expect(pendingSentence(1)).toBe("1 demande déjà en attente suit l'ancienne règle.");
    expect(pendingSentence(3, "Personnes venues de « Tir Cadré »")).toBe(
      "Personnes venues de « Tir Cadré » : 3 demandes déjà en attente suivent l'ancienne règle.",
    );
  });

  it("fenêtre de confirmation avec le nombre et ce qui va se passer", () => {
    expect(applyConfirmText(s)).toEqual({
      title: "Appliquer la nouvelle règle à 37 demandes ?",
      description:
        "Chaque demande est recalculée comme si elle arrivait maintenant, avec sa date d'origine pour le délai : 30 seront acceptées (25 tout de suite), 5 attendront encore les canaux obligatoires et 2 seront à valider à la main. Aucun message d'accueil n'est renvoyé.",
    });
    expect(
      applyConfirmText({
        ruleId: "def",
        count: 1,
        byStatus: { SCHEDULED: 1, PENDING_GATE: 0, REQUESTED: 0 },
        acceptNow: 1,
      }).description,
    ).toBe(
      "Chaque demande est recalculée comme si elle arrivait maintenant, avec sa date d'origine pour le délai : 1 sera acceptée tout de suite. Aucun message d'accueil n'est renvoyé.",
    );
  });

  it("demandes gardées telles quelles (accueil sans les canaux) : dites dans la confirmation et le retour", () => {
    expect(
      applyConfirmText({
        ruleId: "def",
        count: 3,
        byStatus: { SCHEDULED: 0, PENDING_GATE: 3, REQUESTED: 0 },
        acceptNow: 0,
        kept: 2,
      }).description,
    ).toBe(
      "Chaque demande est recalculée comme si elle arrivait maintenant, avec sa date d'origine pour le délai : 3 attendront encore les canaux obligatoires. Aucun message d'accueil n'est renvoyé. 2 autres demandes gardent leur état : l'accueil du bot ne leur a pas montré les canaux à rejoindre.",
    );
    expect(
      appliedMessage({
        status: "ok",
        count: 1,
        byStatus: { SCHEDULED: 0, PENDING_GATE: 0, REQUESTED: 1 },
        acceptNow: 0,
        gateSatisfied: 0,
        skipped: 0,
        kept: 1,
      }),
    ).toBe(
      "Nouvelle règle appliquée à 1 demande en attente : 1 à valider à la main. Aucun message n'a été envoyé. 1 autre demande garde son état : l'accueil du bot ne lui a pas montré les canaux à rejoindre.",
    );
    expect(
      summarize(
        "def",
        [{ status: "REQUESTED", approveAt: null, expiresAt: null, gateSatisfiedAt: null }],
        now,
        2,
      ),
    ).toMatchObject({ count: 1, kept: 2 });
  });

  it("vue de l'écran : rien quand aucune demande n'est à recalculer", () => {
    expect(pendingRuleView(null)).toBeNull();
    expect(pendingRuleView({ ...s, count: 0 })).toBeNull();
    expect(pendingRuleView(s)).toMatchObject({
      ruleId: "def",
      count: 37,
      sentence: "37 demandes déjà en attente suivent l'ancienne règle.",
      confirmTitle: "Appliquer la nouvelle règle à 37 demandes ?",
    });
  });

  it("message de retour, sans aucun message envoyé", () => {
    expect(appliedMessage({ status: "ok", ...s, gateSatisfied: 0, skipped: 0, count: 37 })).toBe(
      "Nouvelle règle appliquée à 37 demandes en attente : 30 acceptations programmées (25 tout de suite), 5 attendent encore les canaux obligatoires et 2 à valider à la main. Aucun message n'a été envoyé.",
    );
    expect(
      appliedMessage({
        status: "ok",
        count: 1,
        byStatus: { SCHEDULED: 1, PENDING_GATE: 0, REQUESTED: 0 },
        acceptNow: 0,
        gateSatisfied: 0,
        skipped: 1,
      }),
    ).toBe(
      "Nouvelle règle appliquée à 1 demande en attente : 1 acceptation programmée. Aucun message n'a été envoyé. 1 demande a changé entre-temps : elle n'a pas été modifiée.",
    );
    expect(
      appliedMessage({
        status: "ok",
        count: 0,
        byStatus: { SCHEDULED: 0, PENDING_GATE: 0, REQUESTED: 0 },
        acceptNow: 0,
        gateSatisfied: 0,
        skipped: 0,
      }),
    ).toBe("Aucune demande en attente à recalculer : elles suivent déjà la règle enregistrée.");
  });
});

describe("après l'enregistrement d'une règle", () => {
  it("le message de confirmation signale les demandes qui suivent encore l'ancienne règle", () => {
    expect(pendingFlash(37, "default")).toBe(
      "37 demandes déjà en attente suivent encore l'ancienne règle : « Leur appliquer la nouvelle règle » est sous le bouton « Enregistrer la règle ».",
    );
    expect(pendingFlash(1, "exception")).toBe(
      "1 demande déjà en attente suit encore l'ancienne règle : « Leur appliquer la nouvelle règle » est juste au-dessus des exceptions.",
    );
    expect(pendingFlash(0, "default")).toBe("");
  });
});

describe("marques des canaux à rejoindre", () => {
  it("effacées quand la demande n'attend plus les canaux, gardées sinon", () => {
    const source = { botId: "b1", gateLinksMissing: [{ channelId: "tir" }], gateCheckFailed: [{}] };
    expect(sourceAfterRecalc(source, "SCHEDULED")).toEqual({
      botId: "b1",
      gateLinksMissing: [],
      gateCheckFailed: [],
    });
    expect(sourceAfterRecalc(source, "PENDING_GATE")).toBe(source);
    expect(sourceAfterRecalc({ botId: "b1" }, "REQUESTED")).toEqual({ botId: "b1" });
  });
});
