import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ jobs: [] as unknown[], web: 0 }));
vi.mock("@linkaffipro/agents", () => ({
  PROSPECTION_LIMITS: { jobTimeoutMs: 300_000 },
  runProspectionJob: vi.fn(async (deps: Record<string, unknown>, job: { type: string }) => {
    calls.jobs.push({ job, hasWeb: "web" in deps && !!deps.web, hasQueue: !!(deps.prospection as { enqueue?: unknown } | undefined)?.enqueue });
    if (job.type === "prospection.requalify") return new Promise(() => undefined);
    return { ok: true };
  }),
  loadProspectionWeb: vi.fn(async () => {
    calls.web++;
    return { fetchText: vi.fn(), search: vi.fn() };
  }),
}));
vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({ prisma: {}, enqueue: {} }) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@linkaffipro/queue", async (orig) => ({ ...(await orig<Record<string, unknown>>()), createProspectionEnqueue: () => vi.fn(async () => undefined) }));

const { processAgentsProspection, repeatableAgentsProspection, withProspectionTimeout } = await import("./agents-prospection");
const { JOB_RETRY_OPTIONS, QUEUE_NAMES } = await import("@linkaffipro/queue");
const { PROCESSORS } = await import("./index");
const { QUEUE_LABELS } = await import("@linkaffipro/core");

const job = (data: unknown) => ({ data, attemptsMade: 0, opts: { attempts: 2 }, id: "1", name: "n" }) as never;

describe("file agents-prospection", () => {
  it("déclarée : deux tâches à la fois, planification toutes les 10 minutes, libellé", () => {
    expect(QUEUE_NAMES).toContain("agents-prospection");
    expect(JOB_RETRY_OPTIONS["agents-prospection"]).toEqual({ attempts: 2, backoff: { type: "exponential", delay: 60_000 } });
    expect(PROCESSORS["agents-prospection"].concurrency).toBe(2);
    expect(repeatableAgentsProspection).toEqual([{ data: { type: "prospection.schedule" }, everyMs: 600_000, jobId: "agents-prospection-schedule" }]);
    expect(QUEUE_LABELS["agents-prospection"]).toBe("Prospection d'affiliés");
  });

  it("chaque tâche connue va à `runProspectionJob` avec la file ; le réseau seulement pour la lecture", async () => {
    for (const data of [{ type: "prospection.schedule" }, { type: "prospection.enrich", prospectId: "p" }, { type: "prospection.daily-top" }, { type: "prospection.discover", lot: {} }])
      await processAgentsProspection(job(data));
    expect(calls.jobs).toEqual([
      { job: { type: "prospection.schedule" }, hasWeb: false, hasQueue: true },
      { job: { type: "prospection.enrich", prospectId: "p" }, hasWeb: true, hasQueue: true },
      { job: { type: "prospection.daily-top" }, hasWeb: false, hasQueue: true },
      { job: { type: "prospection.discover", lot: {} }, hasWeb: true, hasQueue: true },
    ]);
    expect(await processAgentsProspection(job({ type: "autre" }))).toMatchObject({ ok: false });
    expect(calls.jobs).toHaveLength(4);
  });

  it("5 minutes au plus par tâche", async () => {
    await expect(processAgentsProspection(job({ type: "prospection.requalify" }), undefined, 20)).rejects.toThrow(/trop longue/);
    expect(await withProspectionTimeout(Promise.resolve(3), 50)).toBe(3);
  });
});
