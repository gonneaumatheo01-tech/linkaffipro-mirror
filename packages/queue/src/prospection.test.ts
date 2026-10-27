import { describe, expect, it } from "vitest";
import { JOB_RETRY_OPTIONS, QUEUE_NAMES, type JobOf } from "./jobs";
import type { AgentsQueueLike } from "./agents";
import { createProspectionEnqueue } from "./prospection";

function fakeQueue() {
  const jobs = new Map<string, { state: string }>();
  const added: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const q: AgentsQueueLike = {
    async add(name, data, opts) {
      added.push({ name, data, opts });
      jobs.set(String(opts.jobId ?? `auto${added.length}`), { state: "waiting" });
    },
    async getJob(id) {
      const j = jobs.get(id);
      return j ? { getState: async () => j.state, remove: async () => void jobs.delete(id) } : null;
    },
  };
  return { q, jobs, added };
}

describe("file agents-prospection", () => {
  it("déclarée avec 2 essais (reprise après 1 minute)", () => {
    expect(QUEUE_NAMES).toContain("agents-prospection");
    expect(JOB_RETRY_OPTIONS["agents-prospection"]).toEqual({ attempts: 2, backoff: { type: "exponential", delay: 60_000 } });
    const job: JobOf<"agents-prospection"> = { type: "prospection.enrich", prospectId: "p1" };
    expect(job.type).toBe("prospection.enrich");
  });

  it("identifiant stable sans deux-points, jamais doublé en attente ; priorité transmise", async () => {
    const { q, jobs, added } = fakeQueue();
    const enqueue = createProspectionEnqueue(() => q);
    await enqueue({ type: "prospection.daily-top" }, { jobId: "prospection.daily-top:2026-10-26" });
    await enqueue({ type: "prospection.daily-top" }, { jobId: "prospection.daily-top:2026-10-26" });
    expect(added).toEqual([{ name: "agents-prospection:prospection.daily-top", data: { type: "prospection.daily-top" }, opts: { jobId: "prospection.daily-top-2026-10-26" } }]);
    jobs.get("prospection.daily-top-2026-10-26")!.state = "completed";
    await enqueue({ type: "prospection.daily-top" }, { jobId: "prospection.daily-top:2026-10-26" });
    expect(added).toHaveLength(2);
    await enqueue({ type: "prospection.enrich", prospectId: "p1" }, { jobId: "prospection.enrich:p1", priority: 1 });
    expect(added[2]!.opts).toEqual({ jobId: "prospection.enrich-p1", priority: 1 });
    await enqueue({ type: "prospection.schedule" }, { delayMs: 500 });
    expect(added[3]!.opts).toEqual({ delay: 500 });
  });
});
