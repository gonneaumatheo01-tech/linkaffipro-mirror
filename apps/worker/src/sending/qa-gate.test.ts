/**
 * Phase 30 — verrou du QA Global au point d'envoi (worker) : décision du moteur appliquée au post (rien n'est envoyé
 * sans approbation). La décision elle-même est testée dans `packages/agents/src/qa-gates/posts.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn(async () => ({}));
const recordEvent = vi.fn(async () => undefined);
vi.mock("@linkaffipro/db", () => ({ prisma: { post: { update: (...a: unknown[]) => update(...(a as [])) } }, recordEvent: (...a: unknown[]) => recordEvent(...(a as [])), toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/agents", () => ({ agentPostSendGate: vi.fn(async () => ({ decision: "send" })) }));
vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({}) }));

import { passesQaGate } from "./qa-gate";

const post = { id: "p1", agentMissionId: "m1", channelId: "c1", text: "x", mediaAssetIds: [], buttons: [], botId: "b1" };

beforeEach(() => {
  update.mockClear();
  recordEvent.mockClear();
});

describe("verrou d'envoi du QA Global", () => {
  it("post humain : passe sans vérification", async () => {
    const decide = vi.fn();
    expect(await passesQaGate({ ...post, agentMissionId: null }, decide)).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  it("approuvé : part", async () => {
    expect(await passesQaGate(post, async () => ({ decision: "send" }))).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("QA indisponible : retenu (SCHEDULED plus tard, raison claire), rien n'est envoyé", async () => {
    const retryAt = new Date("2026-10-26T10:05:00Z");
    expect(await passesQaGate(post, async () => ({ decision: "held", reason: "En attente", retryAt }))).toBe(false);
    expect(update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "SCHEDULED", scheduledAt: retryAt, lastError: "En attente" } });
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "qa.post.held" }));
  });

  it("refusé : annulé avec le motif ; 3e refus : retenu en brouillon le temps que le client tranche", async () => {
    expect(await passesQaGate(post, async () => ({ decision: "rejected", reason: "Retenu : promesse de gain" }))).toBe(false);
    expect(update).toHaveBeenLastCalledWith({ where: { id: "p1" }, data: { status: "CANCELLED", lastError: "Retenu : promesse de gain" } });
    expect(await passesQaGate(post, async () => ({ decision: "human", reason: "Refusé 3 fois" }))).toBe(false);
    expect(update).toHaveBeenLastCalledWith({ where: { id: "p1" }, data: { status: "DRAFT", lastError: "Refusé 3 fois" } });
  });
});
