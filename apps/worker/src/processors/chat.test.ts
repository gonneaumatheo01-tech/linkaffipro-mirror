import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ turn: [] as string[], sweep: 0, refresh: 0 }));
vi.mock("../assistant/turn", () => ({
  processChatTurn: vi.fn(async (id: string) => {
    calls.turn.push(id);
    return { conversationId: id, status: "done" };
  }),
}));
vi.mock("../assistant/sweep", () => ({
  runChatSweep: vi.fn(async () => {
    calls.sweep++;
    return { stuckReleased: 0, converted: 0, unclaimed: 0, retries: 0, followUps: 0 };
  }),
}));
vi.mock("../assistant/settings", () => ({
  refreshAssistantModels: vi.fn(async () => {
    calls.refresh++;
    return { ok: true, models: 3 };
  }),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { Job } from "bullmq";
import type { ChatJob } from "@linkaffipro/queue";
import { processChat, repeatableChat } from "./chat";

const job = (data: unknown) => ({ id: "j1", data }) as unknown as Job<ChatJob>;

describe("file « chat » (assistant de conversation)", () => {
  beforeEach(() => {
    calls.turn.length = 0;
    calls.sweep = 0;
    calls.refresh = 0;
  });

  it("aiguille chaque tâche vers sa logique", async () => {
    expect(await processChat(job({ type: "turn", conversationId: "c1" }))).toEqual({
      conversationId: "c1",
      status: "done",
    });
    expect(calls.turn).toEqual(["c1"]);
    await processChat(job({ type: "sweep" }));
    expect(calls.sweep).toBe(1);
    expect(await processChat(job({ type: "refresh-models" }))).toEqual({ ok: true, models: 3 });
    expect(calls.refresh).toBe(1);
  });

  it("type inconnu : ignoré sans erreur", async () => {
    expect(await processChat(job({ type: "autre" }))).toMatchObject({ ok: false });
    expect(await processChat(job(undefined))).toMatchObject({ ok: false });
  });

  it("balayage toutes les 30 s et relecture des modèles toutes les 24 h, identifiants fixes", () => {
    expect(repeatableChat).toEqual([
      { data: { type: "sweep" }, everyMs: 30_000, jobId: "chat-sweep" },
      { data: { type: "refresh-models" }, everyMs: 86_400_000, jobId: "chat-refresh-models" },
    ]);
  });
});
