/** Phase 27 : tâches `inspiration-read` / `inspiration-reread` de la file `agents-algo` (aucun réseau, aucune base). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Queue from "@linkaffipro/queue";

const added: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
vi.mock("@linkaffipro/agents", () => ({
  runAlgoTick: vi.fn(async () => ({})),
  runAlgoReportNow: vi.fn(async () => ({})),
  runReferenceRead: vi.fn(async () => ({ ok: true, message: "31 posts lus." })),
  runWeeklyRereads: vi.fn(async () => ({ reread: 1, resumed: 0, skipped: 0, stoppedBy: null })),
}));
vi.mock("@linkaffipro/queue", async (orig) => {
  const real = await orig<typeof Queue>();
  return {
    ...real,
    getQueue: () => ({
      add: async (name: string, data: unknown, opts: Record<string, unknown>) => added.push({ name, data, opts }),
      getJob: async () => null,
    }),
  };
});

import * as agents from "@linkaffipro/agents";
import { processAgentsAlgo, repeatableAgentsAlgo } from "./agents-algo";
import { processAgentsOrchestrator } from "./agents-orchestrator";

const job = (data: unknown) => ({ id: "j", name: "x", data }) as never;

describe("canal d'inspiration dans le worker", () => {
  beforeEach(() => {
    added.length = 0;
  });
  it("relecture quotidienne enregistrée ; inspiration-reread → runWeeklyRereads", async () => {
    expect(repeatableAgentsAlgo).toContainEqual({ data: { type: "inspiration-reread" }, everyMs: 86_400_000, jobId: "agents-algo-inspiration-reread" });
    expect(await processAgentsAlgo(job({ type: "inspiration-reread" }))).toMatchObject({ reread: 1 });
  });
  it("Grand Chef : inspiration-read transmis à agents-algo avec l'identifiant inspiration-read:<id>", async () => {
    expect(await processAgentsOrchestrator(job({ type: "inspiration-read", referenceChannelId: "ref1" }))).toEqual({ forwarded: true });
    expect(added).toEqual([{ name: "inspiration-read", data: { type: "inspiration-read", referenceChannelId: "ref1" }, opts: { jobId: "inspiration-read-ref1" } }]);
  });
  it("lecture ; nouvel essai différé si demandé (verrou, quota, panne), abandon après 8 essais", async () => {
    expect(await processAgentsAlgo(job({ type: "inspiration-read", referenceChannelId: "ref1" }))).toMatchObject({ ok: true });
    expect(agents.runReferenceRead).toHaveBeenCalledWith({}, "ref1");
    expect(added).toEqual([]);
    vi.mocked(agents.runReferenceRead).mockResolvedValue({ ok: false, message: "occupé", retryInMs: 60_000 });
    await processAgentsAlgo(job({ type: "inspiration-read", referenceChannelId: "ref1", attempt: 2 }));
    expect(added).toEqual([{ name: "inspiration-read", data: { type: "inspiration-read", referenceChannelId: "ref1", attempt: 3 }, opts: { jobId: "inspiration-read-ref1-r3", delay: 60_000 } }]);
    added.length = 0;
    await processAgentsAlgo(job({ type: "inspiration-read", referenceChannelId: "ref1", attempt: 8 }));
    expect(added).toEqual([]);
  });
});
