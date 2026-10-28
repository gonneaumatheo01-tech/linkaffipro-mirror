import { describe, expect, it } from "vitest";
import type { TurnResult } from "@linkaffipro/chat";
import {
  assistantOfferSlug,
  assistantOfferUrl,
  chatLockKey,
  conversationDailyCostCapEur,
  followUpDecision,
  followUpRetryCount,
  guardVerdict,
  planTurnPersistence,
  precheck,
  reconcileTurnPlan,
  retryCountSince,
  shouldWaitForRetry,
  summaryPlan,
  toPersonaInput,
  trackingBaseUrl,
  type FollowUpCheck,
  type HistoryRow,
  type PersonaRow,
  type PrecheckInput,
} from "./rules";

const okInput: PrecheckInput = {
  bot: { mode: "ASSISTANT", isActive: true },
  persona: { isActive: true },
  activation: "all",
  isTeamMember: false,
  conversation: { status: "BOT", stoppedAt: null, isMinor: false },
  blocked: false,
  assistantMessagesToday: 0,
  dailyLimit: 60,
  monthSpendEur: 0,
  monthlyCapEur: 30,
};

describe("contrôles avant tout appel à l'IA", () => {
  it("tout est bon : on peut appeler", () => {
    expect(precheck(okInput)).toEqual({ ok: true });
  });

  it("chaque contrôle, dans l'ordre ; seuls les messages « pas encore activé » sont rendus", () => {
    const cases: Array<[Partial<PrecheckInput>, string, boolean, string | null]> = [
      [{ bot: { mode: "STANDARD", isActive: true } }, "bot_not_assistant", false, null],
      [{ bot: null }, "bot_not_assistant", false, null],
      [{ bot: { mode: "ASSISTANT", isActive: false } }, "bot_inactive", false, null],
      [{ persona: null }, "no_persona", false, null],
      [{ persona: { isActive: false } }, "persona_inactive", false, null],
      [{ activation: "off" }, "not_enabled", true, null],
      [{ activation: "team", isTeamMember: false }, "not_enabled", true, null],
      [
        { conversation: { status: "HUMAN", stoppedAt: null, isMinor: false } },
        "not_bot_status",
        false,
        null,
      ],
      [
        { conversation: { status: "BOT", stoppedAt: new Date(), isMinor: false } },
        "stopped",
        false,
        null,
      ],
      [{ conversation: { status: "BOT", stoppedAt: null, isMinor: true } }, "minor", false, null],
      [{ blocked: true }, "blocked", false, null],
      [{ assistantMessagesToday: 60 }, "daily_limit", false, "daily_limit"],
      [{ monthSpendEur: 30 }, "cap_reached", false, "cap_reached"],
      [{ monthlyCapEur: 0 }, "cap_reached", false, "cap_reached"],
    ];
    for (const [over, reason, release, event] of cases)
      expect(precheck({ ...okInput, ...over }), reason).toEqual({
        ok: false,
        reason,
        release,
        event,
      });
  });

  it("activation « équipe » : un compte de l'équipe passe", () => {
    expect(precheck({ ...okInput, activation: "team", isTeamMember: true })).toEqual({ ok: true });
  });

  it("désactivé passe avant le statut : la personne recevra une réponse si l'assistant est activé à temps", () => {
    const r = precheck({
      ...okInput,
      activation: "off",
      conversation: { status: "HUMAN", stoppedAt: null, isMinor: false },
    });
    expect(r).toMatchObject({ reason: "not_enabled", release: true });
  });
});

describe("nouvel essai après une panne", () => {
  const at = (iso: string) => new Date(iso);
  it("compte les pannes depuis le dernier message de la personne", () => {
    const failures = [
      { createdAt: at("2026-10-18T10:00:00Z") },
      { createdAt: at("2026-10-18T10:06:00Z") },
    ];
    expect(retryCountSince(failures, at("2026-10-18T09:59:00Z"))).toBe(2);
    expect(retryCountSince(failures, at("2026-10-18T10:03:00Z"))).toBe(1);
    expect(retryCountSince(failures, at("2026-10-18T10:07:00Z"))).toBe(0);
    expect(retryCountSince(failures, null)).toBe(2);
  });

  it("attend l'heure prévue sauf si un nouveau message est arrivé depuis la panne", () => {
    const base = {
      retryAt: at("2026-10-18T10:05:00Z"),
      now: at("2026-10-18T10:01:00Z"),
      lastFailureAt: at("2026-10-18T10:00:00Z"),
    };
    expect(shouldWaitForRetry({ ...base, claimedAt: [at("2026-10-18T09:59:00Z")] })).toBe(true);
    expect(
      shouldWaitForRetry({
        ...base,
        claimedAt: [at("2026-10-18T09:59:00Z"), at("2026-10-18T10:00:30Z")],
      }),
    ).toBe(false);
    expect(shouldWaitForRetry({ ...base, now: at("2026-10-18T10:06:00Z"), claimedAt: [] })).toBe(
      false,
    );
    expect(shouldWaitForRetry({ ...base, retryAt: null, claimedAt: [] })).toBe(false);
  });
});

describe("nouvel essai d'une relance en panne", () => {
  const last = new Date("2026-10-17T10:00:00Z");
  const at = (iso: string, kind: unknown) => ({ createdAt: new Date(iso), payload: { kind } });
  it("compte seulement les pannes de relance depuis le dernier message parti", () => {
    expect(
      followUpRetryCount(
        [
          at("2026-10-17T09:00:00Z", "follow_up"), // avant le dernier message parti
          at("2026-10-18T10:00:00Z", "reply"), // panne d'une réponse
          at("2026-10-18T10:05:00Z", "follow_up"),
          at("2026-10-18T10:10:00Z", "follow_up"),
          { createdAt: new Date("2026-10-18T10:15:00Z"), payload: null },
        ],
        last,
      ),
    ).toBe(2);
    expect(followUpRetryCount([], last)).toBe(0);
  });
});

describe("relances (au plus 2, 24 h d'écart, heures calmes)", () => {
  const base: FollowUpCheck = {
    now: new Date("2026-10-21T10:01:00Z"), // 12 h 01 à Paris
    status: "BOT",
    stoppedAt: null,
    isMinor: false,
    stage: "CHAT",
    nextFollowUpAt: new Date("2026-10-21T10:00:00Z"),
    followUpCount: 0,
    lastAssistantAt: new Date("2026-10-20T10:00:00Z"),
    lastInboundAt: new Date("2026-10-20T09:59:00Z"),
    followUpsMax: 2,
  };

  it("due : part ; pas encore due : rien", () => {
    expect(followUpDecision(base)).toEqual({ action: "send" });
    expect(followUpDecision({ ...base, now: new Date("2026-10-21T09:00:00Z") })).toEqual({
      action: "none",
    });
    expect(followUpDecision({ ...base, nextFollowUpAt: null })).toEqual({ action: "none" });
  });

  it("annulée : /stop, mineur, reprise par l'équipe, conversion, maximum atteint, la personne a écrit", () => {
    for (const over of [
      { stoppedAt: new Date() },
      { isMinor: true },
      { status: "HUMAN" },
      { stage: "CONVERTED" as const },
      { stage: "WELCOME" as const },
      { followUpCount: 2 },
      { followUpsMax: 1, followUpCount: 1 },
      { followUpsMax: 0 },
      { followUpsMax: 5, followUpCount: 2 },
      { lastInboundAt: new Date("2026-10-20T11:00:00Z") },
      { lastAssistantAt: null },
    ])
      expect(followUpDecision({ ...base, ...over }).action, JSON.stringify(over)).toBe("cancel");
  });

  it("la seconde jamais à moins de 24 h de la première", () => {
    const d = followUpDecision({
      ...base,
      followUpCount: 1,
      lastAssistantAt: new Date("2026-10-21T08:00:00Z"),
      nextFollowUpAt: new Date("2026-10-21T09:00:00Z"),
    });
    expect(d).toEqual({
      action: "reschedule",
      at: new Date("2026-10-22T08:00:00Z"),
      reason: "too_soon",
    });
  });

  it("entre 22 h et 9 h (Paris) : reportée à 10 h", () => {
    const night = followUpDecision({ ...base, now: new Date("2026-10-21T21:30:00Z") }); // 23 h 30
    expect(night).toEqual({
      action: "reschedule",
      at: new Date("2026-10-22T08:00:00Z"),
      reason: "quiet_hours",
    });
    const early = followUpDecision({
      ...base,
      nextFollowUpAt: new Date("2026-10-21T04:00:00Z"),
      now: new Date("2026-10-21T05:00:00Z"), // 7 h
    });
    expect(early).toEqual({
      action: "reschedule",
      at: new Date("2026-10-21T08:00:00Z"),
      reason: "quiet_hours",
    });
  });
});

describe("historique et résumé roulant", () => {
  const rows = (n: number): HistoryRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      direction: i % 2 ? "OUT" : "IN",
      author: i % 2 ? "ASSISTANT" : "MEMBER",
      text: `message ${i}`,
      media: null,
      createdAt: new Date(Date.UTC(2026, 9, 18, 10, i)),
    }));
  it("30 messages hors du résumé ou moins : pas de résumé", () => {
    expect(summaryPlan(rows(30))).toEqual({
      needsSummary: false,
      summaryMessages: [],
      markId: null,
    });
  });
  it("au-delà : les plus anciens hors des 20 derniers, repère sur le dernier résumé", () => {
    const p = summaryPlan(rows(31));
    expect(p.needsSummary).toBe(true);
    expect(p.summaryMessages).toHaveLength(11);
    expect(p.summaryMessages[0]).toMatchObject({ direction: "IN", text: "message 0" });
    expect(p.markId).toBe("m10");
  });
});

function result(over: Partial<TurnResult> = {}): TurnResult {
  return {
    outcome: "replied",
    sent: [{ index: 0, text: "Coucou", offerSubId: null, mediaAssetId: null, fixedKey: null }],
    newStage: "CHAT",
    stageChanges: [{ from: "WELCOME", to: "CHAT" }],
    style: { tone: "direct" },
    facts: ["habite à Lyon"],
    offerSent: null,
    events: [{ type: "stage_changed", payload: { fromStage: "WELCOME", toStage: "CHAT" } }],
    language: "fr",
    model: "venice-uncensored-role-play",
    rejected: [],
    note: null,
    inboundUsed: [{ id: "in1", text: "salut" }],
    deferredInbound: [],
    followUpCount: 0,
    nextFollowUpAt: new Date("2026-10-19T10:00:00Z"),
    neutralSent: false,
    closeReason: null,
    sendError: null,
    unsentOfferSubId: null,
    ...over,
  };
}

describe("enregistrement du résultat d'un tour", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  const before = { stage: "WELCOME" as const, followUpCount: 0 };

  it("réponse : étape, style, faits, langue, compteurs, prochaine relance ; événements sans texte", () => {
    const plan = planTurnPersistence({ kind: "reply", before, result: result(), now });
    expect(plan.patch).toEqual({
      stage: "CHAT",
      styleProfile: { tone: "direct" },
      facts: ["habite à Lyon"],
      language: "fr",
      lastAssistantAt: now,
      assistantTurnsIncrement: 1,
      followUpCount: 0,
      retryAt: null,
      nextFollowUpAt: new Date("2026-10-19T10:00:00Z"),
    });
    expect(plan.events).toEqual([
      { type: "stage_changed", fromStage: "WELCOME", toStage: "CHAT", payload: {} },
    ]);
    expect(plan.releaseIds).toEqual([]);
  });

  it("lien parti : compteur augmenté, `offer_sent` laissé à l'envoi (pas de doublon)", () => {
    const plan = planTurnPersistence({
      kind: "reply",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        newStage: "LINK_SENT",
        offerSent: { subId: "AbCdEfGh1234", url: "https://go.goolink.eu/a/AbCdEfGh1234" },
        events: [
          { type: "stage_changed", payload: { fromStage: "CHAT", toStage: "LINK_SENT" } },
          { type: "offer_sent", payload: { subId: "AbCdEfGh1234", offerSends: 1 } },
        ],
      }),
      now,
    });
    expect(plan.patch.offerSendsIncrement).toBe(1);
    expect(plan.events.map((e) => e.type)).toEqual(["stage_changed"]);
  });

  it("lien du canal VIP parti (Paris sportifs) : CONVERTED et `vip_link_sent` avec le bookmaker", () => {
    const vip = { url: "https://t.me/+vipCelsius", bookmakerKey: "celsius" };
    const plan = planTurnPersistence({
      kind: "reply",
      before: { stage: "LINK_SENT", followUpCount: 0 },
      result: result({ newStage: "LINK_SENT", stageChanges: [], events: [], vipLinkSent: vip }),
      now,
    });
    expect(plan.patch.stage).toBe("CONVERTED");
    expect(plan.events).toEqual([
      { type: "stage_changed", fromStage: "LINK_SENT", toStage: "CONVERTED", payload: {} },
      { type: "vip_link_sent", payload: vip },
    ]);
    const already = planTurnPersistence({
      kind: "reply",
      before: { stage: "CONVERTED", followUpCount: 0 },
      result: result({ newStage: "CONVERTED", stageChanges: [], events: [], vipLinkSent: vip }),
      now,
    });
    expect(already.events.some((e) => e.type === "vip_link_sent")).toBe(false);
  });

  it("panne avec nouvel essai : messages du tour et messages tardifs rendus, heure du nouvel essai gardée", () => {
    const retryAt = new Date("2026-10-18T10:05:00Z");
    const plan = planTurnPersistence({
      kind: "reply",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        outcome: "failed",
        sent: [],
        newStage: "CHAT",
        events: [{ type: "ai_failed", payload: { code: "server", final: false, pass: 1 } }],
        retryAt,
        inboundUsed: [
          { id: "in1", text: "a" },
          { id: "in2", text: "b" },
        ],
        deferredInbound: [{ id: "in3", text: "c" }],
        nextFollowUpAt: null,
      }),
      now,
    });
    expect(plan.patch.retryAt).toEqual(retryAt);
    expect(plan.patch.assistantTurnsIncrement).toBeUndefined();
    expect(plan.patch.lastAssistantAt).toBeUndefined();
    expect(plan.patch.nextFollowUpAt).toBeUndefined();
    expect(plan.releaseIds.sort()).toEqual(["in1", "in2", "in3"]);
    expect(plan.events).toEqual([
      { type: "ai_failed", payload: { code: "server", final: false, pass: 1, kind: "reply" } },
    ]);
  });

  it("relance partie : événement `follow_up_sent`, compteur et prochaine relance du moteur", () => {
    const plan = planTurnPersistence({
      kind: "follow_up",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        newStage: "FOLLOW_UP",
        followUpCount: 1,
        nextFollowUpAt: new Date("2026-10-19T10:00:00Z"),
      }),
      now,
    });
    expect(plan.patch).toMatchObject({
      followUpCount: 1,
      nextFollowUpAt: new Date("2026-10-19T10:00:00Z"),
    });
    expect(plan.events.at(-1)).toEqual({ type: "follow_up_sent", payload: { number: 1 } });
  });

  it("relance pas partie : compteur rendu, nouvel essai hors heures calmes ou plus rien", () => {
    const failed = planTurnPersistence({
      kind: "follow_up",
      before: { stage: "CHAT", followUpCount: 1 },
      result: result({
        outcome: "failed",
        sent: [],
        newStage: "CHAT",
        events: [],
        followUpCount: 1,
        retryAt: new Date("2026-10-18T21:30:00Z"), // 23 h 30 à Paris
      }),
      now,
    });
    expect(failed.patch).toMatchObject({
      followUpCount: 1,
      nextFollowUpAt: new Date("2026-10-19T08:00:00Z"),
    });
    const capped = planTurnPersistence({
      kind: "follow_up",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        outcome: "skipped_cap",
        sent: [],
        newStage: "CHAT",
        events: [],
        followUpCount: 0,
      }),
      now,
    });
    expect(capped.patch).toMatchObject({ followUpCount: 0, nextFollowUpAt: null });
  });

  it("relance en panne : jamais plus de 3 passages (plus de nouvel essai au-delà)", () => {
    const failedPass = (retryCount: number | undefined) =>
      planTurnPersistence({
        kind: "follow_up",
        before: { stage: "CHAT", followUpCount: 0 },
        result: result({
          outcome: "failed",
          sent: [],
          newStage: "CHAT",
          events: [],
          followUpCount: 0,
          retryAt: new Date("2026-10-18T10:05:00Z"),
          ...(retryCount === undefined ? {} : { retryCount }),
        }),
        now,
      }).patch.nextFollowUpAt;
    expect(failedPass(1)).toEqual(new Date("2026-10-18T10:05:00Z"));
    expect(failedPass(2)).toEqual(new Date("2026-10-18T10:05:00Z"));
    expect(failedPass(3)).toBeNull();
  });

  it("mineur : fermé (MINOR), plus de relance ni de nouvel essai", () => {
    const plan = planTurnPersistence({
      kind: "reply",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        outcome: "minor",
        newStage: "CLOSED",
        events: [
          { type: "minor", payload: { source: "code", age: 16 } },
          { type: "stage_changed", payload: { fromStage: "CHAT", toStage: "CLOSED" } },
        ],
        closeReason: "MINOR",
        nextFollowUpAt: null,
      }),
      now,
    });
    expect(plan.patch).toMatchObject({
      isMinor: true,
      status: "CLOSED",
      closedReason: "MINOR",
      closedAt: now,
      stage: "CLOSED",
      nextFollowUpAt: null,
      retryAt: null,
    });
    expect(plan.events.map((e) => e.type)).toEqual(["minor", "stage_changed"]);
  });

  it("bot bloqué / personne injoignable : conversation fermée, passage à FERMÉ journalisé", () => {
    const blocked = planTurnPersistence({
      kind: "reply",
      before: { stage: "CHAT", followUpCount: 0 },
      result: result({
        outcome: "failed",
        sent: [],
        newStage: "CHAT",
        stageChanges: [],
        events: [],
        closeReason: "BLOCKED",
        sendError: { blocked: true, unreachable: false, error: "bloqué" },
        nextFollowUpAt: null,
      }),
      now,
    });
    expect(blocked.patch).toMatchObject({
      status: "CLOSED",
      closedReason: "BLOCKED",
      stage: "CLOSED",
      nextFollowUpAt: null,
    });
    expect(blocked.events).toEqual([
      { type: "stage_changed", fromStage: "CHAT", toStage: "CLOSED", payload: {} },
      { type: "blocked", payload: { kind: "reply" } },
    ]);
    const unreachable = planTurnPersistence({
      kind: "follow_up",
      before: { stage: "LINK_SENT", followUpCount: 0 },
      result: result({
        outcome: "failed",
        sent: [],
        newStage: "LINK_SENT",
        events: [],
        closeReason: "UNREACHABLE",
      }),
      now,
    });
    expect(unreachable.patch).toMatchObject({ closedReason: "UNREACHABLE", status: "CLOSED" });
    expect(unreachable.events.at(-1)).toEqual({
      type: "closed",
      payload: { reason: "UNREACHABLE", kind: "follow_up" },
    });
  });
});

describe("changements faits pendant le tour", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  const before = { stage: "CHAT" as const, followUpCount: 0 };
  const replied = () =>
    planTurnPersistence({
      kind: "reply",
      before,
      result: result({
        newStage: "PROPOSAL",
        events: [{ type: "stage_changed", payload: { fromStage: "CHAT", toStage: "PROPOSAL" } }],
      }),
      now,
    });

  it("relecture avant chaque envoi : statut, /stop, mineur, /reset", () => {
    const open = { status: "BOT", stoppedAt: null, isMinor: false };
    expect(guardVerdict(open, 0, 0)).toEqual({ ok: true });
    expect(guardVerdict(null, 0, 0)).toEqual({ ok: false, reason: "missing" });
    expect(guardVerdict({ ...open, status: "HUMAN" }, 0, 0)).toEqual({
      ok: false,
      reason: "not_bot",
    });
    expect(guardVerdict({ ...open, status: "CLOSED", stoppedAt: now }, 0, 0)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(guardVerdict({ ...open, isMinor: true }, 0, 0)).toEqual({ ok: false, reason: "minor" });
    expect(guardVerdict(open, 2, 1)).toEqual({ ok: false, reason: "reset" });
    expect(guardVerdict(open, 2, null)).toEqual({ ok: true });
  });

  it("rien n'a changé : plan inchangé", () => {
    const plan = replied();
    expect(
      reconcileTurnPlan(plan, before, {
        status: "BOT",
        stoppedAt: null,
        stage: "CHAT",
        reset: false,
      }),
    ).toBe(plan);
  });

  it("/reset pendant le tour : ni faits, ni style, ni résumé, ni langue, ni étape, ni relance ne reviennent", () => {
    const plan = replied();
    plan.patch.summary = "Tom, Lyon";
    const r = reconcileTurnPlan(plan, before, {
      status: "BOT",
      stoppedAt: null,
      stage: "WELCOME",
      reset: true,
    });
    expect(r.patch).toEqual({ lastAssistantAt: now });
    expect(r.events).toEqual([]);
  });

  it("/stop pendant le tour : FERMÉ reste, aucune relance ni nouvel essai, mémoire gardée", () => {
    const r = reconcileTurnPlan(replied(), before, {
      status: "CLOSED",
      stoppedAt: now,
      stage: "CLOSED",
      reset: false,
    });
    expect(r.patch.stage).toBeUndefined();
    expect(r.patch.nextFollowUpAt).toBeUndefined();
    expect(r.patch.retryAt).toBeUndefined();
    expect(r.patch.facts).toEqual(["habite à Lyon"]);
    expect(r.events).toEqual([]);
  });

  it("reprise par l'équipe pendant l'envoi : l'étape des messages partis reste, plus de relance", () => {
    const r = reconcileTurnPlan(replied(), before, {
      status: "HUMAN",
      stoppedAt: null,
      stage: "CHAT",
      reset: false,
    });
    expect(r.patch.stage).toBe("PROPOSAL");
    expect(r.patch.nextFollowUpAt).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(["stage_changed"]);
  });

  it("conversion pendant le tour : l'étape CONVERTED n'est jamais remplacée", () => {
    const r = reconcileTurnPlan(replied(), before, {
      status: "BOT",
      stoppedAt: null,
      stage: "CONVERTED",
      reset: false,
    });
    expect(r.patch.stage).toBeUndefined();
    expect(r.patch.nextFollowUpAt).toEqual(new Date("2026-10-19T10:00:00Z"));
    expect(r.events).toEqual([]);
  });

  it("fermeture du tour (bloqué) sur une conversation déjà fermée : sa raison reste ; sinon passage à FERMÉ depuis l'étape réelle", () => {
    const blocked = () =>
      planTurnPersistence({
        kind: "reply",
        before,
        result: result({
          outcome: "failed",
          sent: [],
          newStage: "CHAT",
          events: [],
          closeReason: "BLOCKED",
          sendError: { blocked: true, unreachable: false, error: "bloqué" },
        }),
        now,
      });
    const closed = reconcileTurnPlan(blocked(), before, {
      status: "CLOSED",
      stoppedAt: now,
      stage: "CLOSED",
      reset: false,
    });
    expect(closed.patch.status).toBeUndefined();
    expect(closed.patch.closedReason).toBeUndefined();
    expect(closed.patch.stage).toBeUndefined();
    expect(closed.events.map((e) => e.type)).toEqual(["blocked"]);
    const afterReset = reconcileTurnPlan(blocked(), before, {
      status: "BOT",
      stoppedAt: null,
      stage: "WELCOME",
      reset: true,
    });
    expect(afterReset.patch).toMatchObject({
      status: "CLOSED",
      closedReason: "BLOCKED",
      stage: "CLOSED",
      nextFollowUpAt: null,
      retryAt: null,
    });
    expect(afterReset.events).toEqual([
      { type: "blocked", payload: { kind: "reply" } },
      { type: "stage_changed", fromStage: "WELCOME", toStage: "CLOSED", payload: {} },
    ]);
  });

  it("mineur détecté alors que la conversation vient d'être fermée : toujours noté mineur", () => {
    const minor = planTurnPersistence({
      kind: "reply",
      before,
      result: result({
        outcome: "minor",
        newStage: "CLOSED",
        events: [
          { type: "minor", payload: { source: "code", age: 16 } },
          { type: "stage_changed", payload: { fromStage: "CHAT", toStage: "CLOSED" } },
        ],
        closeReason: "MINOR",
      }),
      now,
    });
    const r = reconcileTurnPlan(minor, before, {
      status: "CLOSED",
      stoppedAt: now,
      stage: "CLOSED",
      reset: false,
    });
    expect(r.patch.isMinor).toBe(true);
    expect(r.patch.closedReason).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(["minor"]);
  });
});

describe("persona et lien d'offre", () => {
  const persona: PersonaRow = {
    name: "Léa",
    gender: "F",
    personality: "",
    tone: "",
    languages: ["fr"],
    interests: [],
    extraPrompt: null,
    model: null,
    temperature: null,
    minExchangesBeforeOffer: 4,
    requireInterest: true,
    maxOfferSends: 2,
    followUpAfterHours: 24,
    followUpsMax: 2,
    affiliateCampaignId: "off1",
    offerPitch: "App gratuite",
    offerButtonText: "Découvrir l'app",
    offerMediaAssetId: "media1",
  };

  it("offre inutilisable (inactive, sans adresse) : le moteur ne parle jamais du lien ni du visuel", () => {
    expect(
      toPersonaInput(persona, { offerUsable: true, channelTitle: "Canal", botName: "Léa" }),
    ).toMatchObject({
      hasOffer: true,
      offerMediaAssetId: "media1",
      channelTitle: "Canal",
    });
    expect(
      toPersonaInput(persona, { offerUsable: false, channelTitle: null, botName: null }),
    ).toMatchObject({
      hasOffer: false,
      offerMediaAssetId: null,
    });
    expect(
      toPersonaInput(
        { ...persona, affiliateCampaignId: null },
        { offerUsable: true, channelTitle: null, botName: null },
      ).hasOffer,
    ).toBe(false);
  });

  it("bookmakers (Paris sportifs) : offres actives seulement, triés par priorité, lien VIP repéré", () => {
    const extras = { offerUsable: true, channelTitle: null, botName: null };
    const live = { isActive: true, trackingUrlTemplate: "https://linkaffi.me/go/x?sub_id={subid}" };
    const book = (bookmakerKey: string, priority: number, over: object = {}) => ({
      bookmakerKey,
      label: bookmakerKey,
      priority,
      affiliateCampaignId: `c-${bookmakerKey}`,
      affiliateCampaign: live,
      inviteLinkId: null,
      inviteLink: null,
      ...over,
    });
    // Mehdi : aucune offre « simple », seulement des offres par bookmaker.
    const p = toPersonaInput(
      {
        ...persona,
        affiliateCampaignId: null,
        universe: "sports",
        bookmakers: [
          book("sportaza", 3, { affiliateCampaign: { ...live, isActive: false } }),
          book("betportal", 2),
          book("celsius", 1, {
            inviteLinkId: "l1",
            inviteLink: { telegramInviteLink: "https://t.me/+vip" },
          }),
        ],
      },
      extras,
    );
    expect(p.hasOffer).toBe(true);
    expect(p.bookmakers).toEqual([
      { bookmakerKey: "celsius", label: "celsius", priority: 1, hasInviteLink: true },
      { bookmakerKey: "betportal", label: "betportal", priority: 2, hasInviteLink: false },
    ]);
    const none = toPersonaInput(
      {
        ...persona,
        affiliateCampaignId: null,
        bookmakers: [book("celsius", 1, { affiliateCampaign: null })],
      },
      extras,
    );
    expect(none).toMatchObject({ hasOffer: false, bookmakers: undefined });
    expect(toPersonaInput(persona, extras).bookmakers).toBeUndefined();
  });

  it("identité : GIRL et âge repris, ASSISTANT par défaut", () => {
    const extras = { offerUsable: true, channelTitle: null, botName: null };
    expect(toPersonaInput({ ...persona, identityKind: "GIRL", age: 24 }, extras)).toMatchObject({
      identity: "GIRL",
      age: 24,
    });
    expect(toPersonaInput(persona, extras)).toMatchObject({ identity: "ASSISTANT", age: null });
  });

  it("illusion reprise de la persona, false par défaut", () => {
    const extras = { offerUsable: true, channelTitle: null, botName: null };
    expect(
      toPersonaInput({ ...persona, identityKind: "GIRL", illusion: true }, extras),
    ).toMatchObject({ identity: "GIRL", illusion: true });
    expect(toPersonaInput(persona, extras)).toMatchObject({ illusion: false });
  });

  it("nom court stable de 10 caractères par (persona, offre)", () => {
    const a = assistantOfferSlug("persona1", "off1");
    expect(a).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(assistantOfferSlug("persona1", "off1")).toBe(a);
    expect(assistantOfferSlug("persona1", "off2")).not.toBe(a);
    expect(assistantOfferSlug("persona2", "off1")).not.toBe(a);
  });

  it("adresse des liens : TRACKING_BASE_URL, sinon TRACKING_HOST, sinon go.goolink.eu", () => {
    expect(trackingBaseUrl({ TRACKING_BASE_URL: "https://go.example.eu/" })).toBe(
      "https://go.example.eu",
    );
    expect(trackingBaseUrl({ TRACKING_HOST: "go.example.eu" })).toBe("https://go.example.eu");
    expect(trackingBaseUrl({})).toBe("https://go.goolink.eu");
    expect(assistantOfferUrl("AbCdEfGh1234", {})).toBe("https://go.goolink.eu/a/AbCdEfGh1234");
  });

  it("verrou par conversation", () => {
    expect(chatLockKey("c1")).toBe("chat:lock:c1");
  });
});

describe("corrections après relecture", () => {
  const now = new Date("2026-10-18T10:00:00Z");

  it("dépense IA par conversation et par jour : 1 % du plafond mensuel, 0,10 € au moins", () => {
    expect(conversationDailyCostCapEur(30)).toBe(0.3);
    expect(conversationDailyCostCapEur(5)).toBe(0.1);
    expect(precheck({ ...okInput, conversationSpendTodayEur: 0.29 })).toEqual({ ok: true });
    expect(precheck({ ...okInput, conversationSpendTodayEur: 0.3 })).toEqual({
      ok: false,
      reason: "daily_cost",
      release: false,
      event: "daily_limit",
    });
  });

  it("l'équipe a pris puis rendu la main pendant le tour : plus rien ne part", () => {
    const open = { status: "BOT", stoppedAt: null, isMinor: false };
    expect(guardVerdict(open, 0, 0, { now: 2, atStart: 0 })).toEqual({
      ok: false,
      reason: "handed_over",
    });
    expect(guardVerdict(open, 0, 0, { now: 2, atStart: 2 })).toEqual({ ok: true });
    expect(guardVerdict(open, 0, 0, { now: 2, atStart: null })).toEqual({ ok: true });
  });

  it("faits écrits à l'envoi : ni tour, ni lien, ni heure, ni passage d'étape écrits une seconde fois", () => {
    const plan = planTurnPersistence({
      kind: "reply",
      before: { stage: "LINK_SENT", followUpCount: 0 },
      result: result({
        newStage: "LINK_SENT",
        offerSent: { subId: "AbCdEfGh1234", url: "https://go.goolink.eu/a/AbCdEfGh1234" },
        events: [
          { type: "stage_changed", payload: { fromStage: "PROPOSAL", toStage: "LINK_SENT" } },
          { type: "offer_sent", payload: { subId: "AbCdEfGh1234" } },
        ],
      }),
      now,
      live: {
        lastSentAt: new Date("2026-10-18T09:59:58Z"),
        assistantTurnCounted: true,
        offerSends: 1,
        stage: { from: "PROPOSAL", to: "LINK_SENT" },
      },
    });
    expect(plan.patch).not.toHaveProperty("assistantTurnsIncrement");
    expect(plan.patch).not.toHaveProperty("offerSendsIncrement");
    expect(plan.patch).not.toHaveProperty("lastAssistantAt");
    expect(plan.patch).not.toHaveProperty("stage");
    expect(plan.events).toEqual([]);
  });

  it("relance pendant laquelle la personne a écrit : compteur et prochaine relance jamais réécrits", () => {
    const before = { stage: "LINK_SENT" as const, followUpCount: 1 };
    const planned = planTurnPersistence({
      kind: "follow_up",
      before,
      result: result({ outcome: "aborted", sent: [], newStage: "LINK_SENT", events: [] }),
      now,
    });
    expect(planned.patch.followUpCount).toBe(1);
    const plan = reconcileTurnPlan(
      planned,
      before,
      { status: "BOT", stoppedAt: null, stage: "LINK_SENT", reset: false, memberWrote: true },
      "follow_up",
    );
    expect(plan.patch).not.toHaveProperty("followUpCount");
    expect(plan.patch).not.toHaveProperty("nextFollowUpAt");
  });

  it("main prise puis rendue pendant le tour : relance et nouvel essai posés en rendant la main gardés", () => {
    const before = { stage: "CHAT" as const, followUpCount: 0 };
    const planned = planTurnPersistence({ kind: "reply", before, result: result(), now });
    const plan = reconcileTurnPlan(planned, before, {
      status: "BOT",
      stoppedAt: null,
      stage: "CHAT",
      reset: false,
      handedOver: true,
    });
    expect(plan.patch).not.toHaveProperty("nextFollowUpAt");
    expect(plan.patch).not.toHaveProperty("retryAt");
  });
});
