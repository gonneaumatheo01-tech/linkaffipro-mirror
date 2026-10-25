import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ jobs: [] as unknown[], watch: 0 }));
vi.mock("@linkaffipro/agents", () => ({
  runAnalystsJob: vi.fn(async (deps: Record<string, unknown>, job: unknown) => {
    calls.jobs.push({ job, hasLlm: "analystsLlm" in deps, hasQueue: !!(deps.analysts as { enqueue?: unknown } | undefined)?.enqueue });
    return { ok: true };
  }),
  loadWatchDeps: vi.fn(async (d: Record<string, unknown>) => {
    calls.watch++;
    return { ...d, analystsLlm: { complete: vi.fn() }, web: {} };
  }),
}));
vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({ prisma: {}, enqueue: {} }) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@linkaffipro/queue", async (orig) => ({ ...(await orig<Record<string, unknown>>()), createAnalystsEnqueue: () => vi.fn(async () => undefined) }));

const { processAgentsAnalystes, repeatableAgentsAnalystes, workerAnalystsDeps } = await import("./agents-analystes");
const { JOB_RETRY_OPTIONS, QUEUE_NAMES } = await import("@linkaffipro/queue");
const { PROCESSORS } = await import("./index");
const { ALERT_KIND_LABELS, QUEUE_LABELS, SWITCHABLE_ALERT_KINDS } = await import("@linkaffipro/core");
const { detectAnalystsFailing } = await import("../maintenance/alert-rules");

const job = (data: unknown) => ({ data, attemptsMade: 0, opts: { attempts: 2 }, id: "1", name: "n" }) as never;

describe("file agents-analystes", () => {
  it("déclarée : deux tâches à la fois, planification toutes les heures, libellés", () => {
    expect(QUEUE_NAMES).toContain("agents-analystes");
    expect(JOB_RETRY_OPTIONS["agents-analystes"]).toEqual({ attempts: 2, backoff: { type: "exponential", delay: 60_000 } });
    expect(PROCESSORS["agents-analystes"].concurrency).toBe(2);
    expect(repeatableAgentsAnalystes).toEqual([{ data: { type: "analysts.schedule" }, everyMs: 3600_000, jobId: "agents-analystes-schedule" }]);
    expect(QUEUE_LABELS["agents-analystes"]).toBe("Analyse du marché");
    expect(ALERT_KIND_LABELS.analysts_failing).toBeTruthy();
    expect(SWITCHABLE_ALERT_KINDS).toContain("analysts_failing");
  });

  it("chaque tâche connue va à `runAnalystsJob` avec la file ; l'IA de la veille seulement pour la lecture", async () => {
    for (const data of [{ type: "analysts.schedule" }, { type: "analysts.scrape", sourceId: "s" }, { type: "analysts.compliance_check", entryId: "e" }, { type: "analysts.strategy", kind: "weekly" }])
      await processAgentsAnalystes(job(data));
    expect(calls.jobs).toEqual([
      { job: { type: "analysts.schedule" }, hasLlm: false, hasQueue: true },
      { job: { type: "analysts.scrape", sourceId: "s" }, hasLlm: true, hasQueue: true },
      { job: { type: "analysts.compliance_check", entryId: "e" }, hasLlm: false, hasQueue: true },
      { job: { type: "analysts.strategy", kind: "weekly" }, hasLlm: false, hasQueue: true },
    ]);
    expect(await processAgentsAnalystes(job({ type: "autre" }))).toMatchObject({ ok: false });
    expect(calls.jobs).toHaveLength(4);
    expect((await workerAnalystsDeps({ type: "analysts.discover" })).analystsLlm).toBeTruthy();
  });

  it("alerte « veille du marché en panne » : 5 échecs en 15 minutes", () => {
    expect(detectAnalystsFailing(4)).toBeNull();
    const d = detectAnalystsFailing(5)!;
    expect(d.kind).toBe("analysts_failing");
    expect(d.message).toContain("5 tâches en échec");
  });
});
