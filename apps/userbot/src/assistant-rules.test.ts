import { describe, expect, it } from "vitest";
import type { TurnResult } from "@linkaffipro/chat";
import {
  NOT_OURS_ERROR,
  SEND_RETRY_MS,
  deadInbound,
  eventPayload,
  isUniversePersona,
  planUniverseTurn,
  reconcileUniversePlan,
  remainingDelayMs,
  shouldWaitForRetry,
  universeSkipReason,
  type RecentMessage,
} from "./assistant-rules";

const now = new Date("2026-11-02T17:50:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

function result(over: Partial<TurnResult>): TurnResult {
  return {
    outcome: "replied",
    sent: [{ index: 0, text: "yo", offerSubId: null, mediaAssetId: null, fixedKey: null }],
    newStage: "CHAT",
    stageChanges: [],
    style: {},
    facts: [],
    offerSent: null,
    events: [],
    language: "fr",
    model: "grok",
    rejected: [],
    note: null,
    inboundUsed: [{ id: "in1", text: "salut" }],
    deferredInbound: [],
    followUpCount: 0,
    nextFollowUpAt: null,
    neutralSent: false,
    closeReason: null,
    sendError: null,
    unsentOfferSubId: null,
    ...over,
  } as TurnResult;
}

const open = { status: "BOT", stoppedAt: null, isMinor: false, needsHumanAt: null, needsHumanReason: null };

describe("compte réel Casino / Paris : qui passe par ce tour", () => {
  it("Casino et Paris sportifs seulement (jamais une persona Rencontres)", () => {
    expect(isUniversePersona({ universe: "sports" })).toBe(true);
    expect(isUniversePersona({ universe: "casino" })).toBe(true);
    expect(isUniversePersona({ universe: "dating" })).toBe(false);
    expect(isUniversePersona({ universe: null })).toBe(false);
    expect(isUniversePersona(null)).toBe(false);
  });

  it("pas de réponse : reprise par l'équipe, /stop, mineur, passée à l'équipe pour un motif grave", () => {
    expect(universeSkipReason(open)).toBeNull();
    expect(universeSkipReason({ ...open, status: "HUMAN" })).toBe("not_bot_status");
    expect(universeSkipReason({ ...open, stoppedAt: ago(1) })).toBe("stopped");
    expect(universeSkipReason({ ...open, isMinor: true })).toBe("minor");
    expect(universeSkipReason({ ...open, needsHumanAt: ago(1), needsHumanReason: "money" })).toBe(
      "needs_human",
    );
    // Une simple question hors fiche ne le fait pas taire.
    expect(
      universeSkipReason({ ...open, needsHumanAt: ago(1), needsHumanReason: "off_faq" }),
    ).toBeNull();
  });
});

describe("nouvel essai et délai de réponse", () => {
  it("attend l'heure du nouvel essai tant qu'aucun nouveau message n'est arrivé", () => {
    const retryAt = new Date(now.getTime() + 45_000);
    expect(
      shouldWaitForRetry({ retryAt, now, lastFailureAt: ago(0.1), claimedAt: [ago(3)] }),
    ).toBe(true);
    // Il écrit après la panne : réponse tout de suite.
    expect(
      shouldWaitForRetry({ retryAt, now, lastFailureAt: ago(1), claimedAt: [ago(3), ago(0.5)] }),
    ).toBe(false);
    // Heure passée : on y va.
    expect(
      shouldWaitForRetry({ retryAt: ago(0.1), now, lastFailureAt: ago(1), claimedAt: [ago(3)] }),
    ).toBe(false);
  });

  it("délai de la persona compté depuis le plus ancien message (jamais attendu deux fois)", () => {
    expect(remainingDelayMs(150_000, ago(1), now)).toBe(90_000);
    expect(remainingDelayMs(150_000, ago(5), now)).toBe(0);
    expect(remainingDelayMs(0, ago(1), now)).toBe(0);
    expect(remainingDelayMs(150_000, null, now)).toBe(150_000);
  });
});

describe("messages pris par le tour d'un process arrêté", () => {
  const row = (
    id: string,
    direction: "IN" | "OUT",
    min: number,
    turnId: string | null,
    meta: unknown = {},
  ): RecentMessage => ({ id, direction, turnId, meta, createdAt: ago(min) });
  const opts = { ownTurnPrefix: "ub_moi_", now };

  it("« attends je reviens 2 sec » n'est pas une réponse : ses messages sont rendus (conversation d'abde13kz)", () => {
    const rows = [
      row("a", "IN", 150, "ub_old1"),
      row("b", "OUT", 147, "ub_old1"),
      row("c", "IN", 136, "ub_old2"),
      row("d", "IN", 136, "ub_old2"),
      row("e", "OUT", 133, "ub_old2", { fixedKey: "retryLater" }),
    ];
    const r = deadInbound(rows, opts);
    expect(r.release).toEqual(["c", "d"]);
    expect(r.answeredBefore).toEqual(ago(147));
  });

  it("jamais une vieille question à laquelle une réponse plus récente a répondu", () => {
    const rows = [row("a", "IN", 30, "ub_old"), row("b", "OUT", 10, "ub_x_1")];
    expect(deadInbound(rows, opts)).toEqual({ release: [], answeredBefore: ago(10) });
  });

  it("jamais les tours de ce process, ceux marqués terminés, ni ceux du worker", () => {
    const rows = [
      row("a", "IN", 30, "ub_moi_1"),
      row("b", "IN", 30, "ub_old", { turnDone: true }),
      row("c", "IN", 30, "t123abc"),
    ];
    expect(deadInbound(rows, opts).release).toEqual([]);
  });

  it("ni trop tôt (moins de 2 min : le tour tourne peut-être encore) ni trop tard (plus de 24 h)", () => {
    const rows = [row("a", "IN", 1, "ub_old"), row("b", "IN", 25 * 60, "ub_old")];
    expect(deadInbound(rows, opts).release).toEqual([]);
  });
});

describe("enregistrement d'un tour Casino / Paris", () => {
  it("réponse partie : tour compté, heure gardée, aucune relance programmée", () => {
    const plan = planUniverseTurn({ stage: "CHAT", result: result({}), now, sendFailuresBefore: 0 });
    expect(plan.patch).toMatchObject({
      assistantTurnsIncrement: 1,
      lastAssistantAt: now,
      followUpCount: 0,
      nextFollowUpAt: null,
      retryAt: null,
    });
    expect(plan.releaseIds).toEqual([]);
  });

  it("panne de l'IA : aucun message, ses messages rendus pour le nouvel essai", () => {
    const retryAt = new Date(now.getTime() + 45_000);
    const plan = planUniverseTurn({
      stage: "PROPOSAL",
      result: result({
        outcome: "failed",
        sent: [],
        newStage: "PROPOSAL",
        retryAt,
        retryCount: 1,
        events: [{ type: "ai_failed", payload: { attempt: 1 } }],
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch.retryAt).toEqual(retryAt);
    expect(plan.patch.assistantTurnsIncrement).toBeUndefined();
    expect(plan.releaseIds).toEqual(["in1"]);
    expect(plan.events).toEqual([
      { type: "ai_failed", payload: { attempt: 1, kind: "reply" } },
    ]);
  });

  it("lien d'inscription parti : journalisé avec son bookmaker, compteur des liens", () => {
    const plan = planUniverseTurn({
      stage: "PROPOSAL",
      result: result({
        newStage: "LINK_SENT",
        offerSent: { subId: "S1", url: "https://go.goolink.eu/a/S1", bookmakerKey: "celsius" },
        events: [
          { type: "stage_changed", payload: { fromStage: "PROPOSAL", toStage: "LINK_SENT" } },
          { type: "offer_sent", payload: { subId: "S1", bookmakerKey: "celsius" } },
        ],
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch.stage).toBe("LINK_SENT");
    expect(plan.patch.offerSendsIncrement).toBe(1);
    expect(plan.events).toContainEqual({
      type: "offer_sent",
      payload: { subId: "S1", bookmakerKey: "celsius", kind: "reply" },
    });
    expect(plan.events).toContainEqual({
      type: "stage_changed",
      fromStage: "PROPOSAL",
      toStage: "LINK_SENT",
      payload: {},
    });
  });

  it("envoi refusé par Telegram sans raison définitive : nouvel essai 2 fois au plus", () => {
    const failed = result({
      sent: [],
      sendError: { blocked: false, unreachable: false, error: "FLOOD_WAIT_12" },
    });
    const first = planUniverseTurn({ stage: "CHAT", result: failed, now, sendFailuresBefore: 0 });
    expect(first.patch.retryAt).toEqual(new Date(now.getTime() + SEND_RETRY_MS));
    expect(first.releaseIds).toEqual(["in1"]);
    expect(first.events).toContainEqual({
      type: "send_failed",
      payload: { error: "FLOOD_WAIT_12", retry: true, kind: "reply" },
    });
    const third = planUniverseTurn({ stage: "CHAT", result: failed, now, sendFailuresBefore: 2 });
    expect(third.patch.retryAt).toBeNull();
    expect(third.releaseIds).toEqual([]);
  });

  it("envoi arrêté parce que l'équipe a repris la main : jamais de nouvel essai", () => {
    const plan = planUniverseTurn({
      stage: "CHAT",
      result: result({
        sent: [],
        sendError: { blocked: false, unreachable: false, error: NOT_OURS_ERROR },
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch.retryAt).toBeNull();
    expect(plan.events.map((e) => e.type)).not.toContain("send_failed");
  });

  it("personne qui a bloqué le compte : conversation fermée", () => {
    const plan = planUniverseTurn({
      stage: "CHAT",
      result: result({
        sent: [],
        closeReason: "BLOCKED",
        sendError: { blocked: true, unreachable: false, error: "USER_IS_BLOCKED" },
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch).toMatchObject({ status: "CLOSED", stage: "CLOSED", closedReason: "BLOCKED" });
    expect(plan.events.map((e) => e.type)).toEqual(["stage_changed", "blocked"]);
  });

  it("lien du VIP parti après le dépôt : conversion", () => {
    const plan = planUniverseTurn({
      stage: "LINK_SENT",
      result: result({
        newStage: "LINK_SENT",
        vipLinkSent: { url: "https://t.me/+vip", bookmakerKey: "celsius" },
        events: [{ type: "vip_link_sent", payload: { bookmakerKey: "celsius" } }],
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch.stage).toBe("CONVERTED");
    expect(plan.events).toEqual([
      { type: "stage_changed", fromStage: "LINK_SENT", toStage: "CONVERTED", payload: {} },
      { type: "vip_link_sent", payload: { url: "https://t.me/+vip", bookmakerKey: "celsius" } },
    ]);
  });

  it("passage à l'équipe : motif noté, aucun nouvel essai, messages traités", () => {
    const plan = planUniverseTurn({
      stage: "CHAT",
      result: result({
        outcome: "failed",
        retryAt: new Date(now.getTime() + 45_000),
        needsHuman: { reason: "off_faq", source: "code" },
      }),
      now,
      sendFailuresBefore: 0,
    });
    expect(plan.patch.needsHuman).toBe("off_faq");
    expect(plan.patch.retryAt).toBeNull();
    expect(plan.releaseIds).toEqual([]);
  });
});

describe("changements faits pendant le tour", () => {
  const planned = planUniverseTurn({
    stage: "CHAT",
    result: result({
      outcome: "failed",
      sent: [],
      newStage: "PROPOSAL",
      retryAt: new Date(now.getTime() + 45_000),
      events: [{ type: "stage_changed", payload: { fromStage: "CHAT", toStage: "PROPOSAL" } }],
    }),
    now,
    sendFailuresBefore: 0,
  });

  it("toujours à lui : rien ne change", () => {
    const cur = { status: "BOT", stoppedAt: null, stage: "CHAT" as const, handedOver: false };
    expect(reconcileUniversePlan(planned, { stage: "CHAT" }, cur)).toBe(planned);
  });

  it("l'équipe a repris la main : ni nouvel essai ni message rendu", () => {
    const cur = { status: "HUMAN", stoppedAt: null, stage: "CHAT" as const, handedOver: true };
    const plan = reconcileUniversePlan(planned, { stage: "CHAT" }, cur);
    expect(plan.patch).not.toHaveProperty("retryAt");
    expect(plan.releaseIds).toEqual([]);
  });

  it("étape changée entre-temps (conversion) : l'étape du tour n'est ni écrite ni journalisée", () => {
    const cur = { status: "BOT", stoppedAt: null, stage: "CONVERTED" as const, handedOver: false };
    const plan = reconcileUniversePlan(planned, { stage: "CHAT" }, cur);
    expect(plan.patch).not.toHaveProperty("stage");
    expect(plan.events.map((e) => e.type)).not.toContain("stage_changed");
    expect(plan.releaseIds).toEqual(["in1"]);
  });
});

describe("journal", () => {
  it("jamais de texte de conversation", () => {
    expect(
      eventPayload({ text: "salut", texts: ["a"], note: "n", reason: "off_faq", bookmakerKey: "celsius" }),
    ).toEqual({ reason: "off_faq", bookmakerKey: "celsius" });
  });
});
