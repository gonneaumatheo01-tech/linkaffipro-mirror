import { describe, expect, it, vi } from "vitest";
import { QUEUE_NAMES } from "./jobs";
import { cleanFailedOlderThan, queueCounts, recentFailedJobs, retryFailedJob, summarizeJob, type JobLike, type QueueLike, type StatsDeps } from "./stats";

function fakeJob(over: Partial<JobLike> & { id: string }): JobLike {
  return { name: "telegram-send:dm", data: { type: "dm" }, failedReason: "boom", attemptsMade: 3, timestamp: 1_000, finishedOn: 2_000, retry: vi.fn(async () => undefined), getState: async () => "failed", ...over };
}

function fakeQueue(failed: JobLike[] = [], counts: Record<string, number> = {}): QueueLike & { clean: ReturnType<typeof vi.fn> } {
  return {
    getJobCounts: vi.fn(async () => counts),
    getFailed: vi.fn(async (start = 0, end = -1) => failed.slice(start, end === -1 ? undefined : end + 1)),
    getJob: vi.fn(async (id: string) => failed.find((j) => j.id === id)),
    clean: vi.fn(async () => ["a", "b"]),
  };
}

describe("statistiques des files", () => {
  it("renvoie les compteurs de chaque file connue, zéro par défaut", async () => {
    const deps: StatsDeps = { getQueue: (name) => fakeQueue([], name === "stats" ? { waiting: 2, failed: 1 } : {}) };
    const counts = await queueCounts(deps);
    expect(counts.map((c) => c.name)).toEqual([...QUEUE_NAMES]);
    const stats = counts.find((c) => c.name === "stats")!;
    expect(stats).toMatchObject({ waiting: 2, failed: 1, active: 0, delayed: 0, completed: 0 });
  });

  it("liste les dernières tâches échouées, les plus récentes en premier, toutes files confondues", async () => {
    const deps: StatsDeps = {
      getQueue: (name) => {
        if (name === "telegram-send") return fakeQueue([fakeJob({ id: "t1", finishedOn: 5_000 }), fakeJob({ id: "t2", finishedOn: 1_500 })]);
        if (name === "stats") return fakeQueue([fakeJob({ id: "s1", name: "stats:tick", finishedOn: 3_000 })]);
        return fakeQueue();
      },
    };
    const jobs = await recentFailedJobs(2, deps);
    expect(jobs.map((j) => j.id)).toEqual(["t1", "s1"]);
    expect(jobs[1]?.queue).toBe("stats");
    expect(jobs[0]?.failedAt?.getTime()).toBe(5_000);
  });

  it("résume une tâche sans identifiant ni raison", () => {
    const s = summarizeJob("stats", fakeJob({ id: undefined as unknown as string, failedReason: undefined, finishedOn: undefined }));
    expect(s.id).toBe("?");
    expect(s.failedReason).toBe("");
    expect(s.failedAt).toBeNull();
  });

  it("relance une tâche en échec et refuse les autres états", async () => {
    const job = fakeJob({ id: "x" });
    const active = fakeJob({ id: "y", getState: async () => "active" });
    const deps: StatsDeps = { getQueue: () => fakeQueue([job, active]) };
    expect(await retryFailedJob("telegram-send", "x", deps)).toEqual({ ok: true });
    expect(job.retry).toHaveBeenCalledWith("failed");
    expect((await retryFailedJob("telegram-send", "y", deps)).ok).toBe(false);
    expect((await retryFailedJob("telegram-send", "z", deps)).ok).toBe(false);
  });

  it("purge les échecs plus anciens qu'un délai", async () => {
    const q = fakeQueue();
    const n = await cleanFailedOlderThan("maintenance", 7 * 86_400_000, { getQueue: () => q });
    expect(n).toBe(2);
    expect(q.clean).toHaveBeenCalledWith(7 * 86_400_000, 1000, "failed");
  });
});
