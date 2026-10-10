/**
 * Recalcul complet demandé après une modification d'une campagne : une file Redis injoignable ne bloque jamais
 * l'action (attente bornée), et une modification faite PENDANT un recalcul en cours en programme un second (le
 * premier a déjà lu les périmètres des campagnes), sans multiplier les recalculs en attente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/dashboard/cache", () => ({
  DASHBOARD_TAG: "dashboard",
  invalidateDashboards: vi.fn(),
}));
const queue = vi.hoisted(() => ({
  getJobState: vi.fn(async (_id: string) => "unknown" as string),
  remove: vi.fn(async (_id: string) => 1),
  enqueue: vi.fn(async (..._args: unknown[]) => ({})),
}));
vi.mock("@linkaffipro/queue", () => ({
  enqueue: queue.enqueue,
  getQueue: () => ({ getJobState: queue.getJobState, remove: queue.remove }),
}));

import {
  CAMPAIGN_STATS_JOB_ID,
  CAMPAIGN_STATS_NEXT_JOB_ID,
  pickRecomputeJob,
  refreshCampaignStats,
} from "./refresh";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  queue.getJobState.mockResolvedValue("unknown");
  queue.enqueue.mockResolvedValue({});
});

function jobIdOfLastEnqueue(): string | undefined {
  const call = queue.enqueue.mock.calls.at(-1) as [string, unknown, { jobId?: string }] | undefined;
  return call?.[2].jobId;
}

describe("choix de la tâche de recalcul (règle pure)", () => {
  it("aucune tâche : la tâche principale", () => {
    expect(pickRecomputeJob({ main: "unknown", next: "unknown" })).toEqual({
      jobId: CAMPAIGN_STATS_JOB_ID,
      removeFirst: false,
    });
  });
  it("tâche principale en attente : on la réutilise (elle verra la modification)", () => {
    expect(pickRecomputeJob({ main: "delayed", next: "unknown" }).jobId).toBe(
      CAMPAIGN_STATS_JOB_ID,
    );
  });
  it("tâche principale en cours : une seconde est programmée", () => {
    expect(pickRecomputeJob({ main: "active", next: "unknown" }).jobId).toBe(
      CAMPAIGN_STATS_NEXT_JOB_ID,
    );
    expect(pickRecomputeJob({ main: "active", next: "delayed" }).jobId).toBe(
      CAMPAIGN_STATS_NEXT_JOB_ID,
    );
  });
  it("la seconde en cours : la principale reprend le relais", () => {
    expect(pickRecomputeJob({ main: "unknown", next: "active" }).jobId).toBe(CAMPAIGN_STATS_JOB_ID);
  });
  it("tâche terminée restée dans Redis : retirée avant d'en ajouter une", () => {
    expect(pickRecomputeJob({ main: "completed", next: "unknown" })).toEqual({
      jobId: CAMPAIGN_STATS_JOB_ID,
      removeFirst: true,
    });
  });
  it("les deux en cours : identifiant unique", () => {
    const r = pickRecomputeJob({ main: "active", next: "active" }, 123);
    expect(r.jobId).toBe(`${CAMPAIGN_STATS_JOB_ID}-123`);
  });
});

describe("refreshCampaignStats", () => {
  it("demande un recalcul complet retardé", async () => {
    await refreshCampaignStats();
    expect(queue.enqueue).toHaveBeenCalledWith(
      "stats",
      { type: "daily", full: true },
      expect.objectContaining({ jobId: CAMPAIGN_STATS_JOB_ID, delay: 30_000 }),
    );
  });

  it("modification pendant un recalcul en cours : un second recalcul est programmé", async () => {
    queue.getJobState.mockImplementation(async (id: string) =>
      id === CAMPAIGN_STATS_JOB_ID ? "active" : "unknown",
    );
    await refreshCampaignStats();
    expect(jobIdOfLastEnqueue()).toBe(CAMPAIGN_STATS_NEXT_JOB_ID);
  });

  it("Redis injoignable (commande sans réponse) : l'action n'attend pas plus de quelques secondes", async () => {
    vi.useFakeTimers();
    queue.getJobState.mockImplementation(() => new Promise<string>(() => undefined));
    queue.enqueue.mockImplementation(() => new Promise(() => undefined));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let done = false;
    const p = refreshCampaignStats().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(done).toBe(true);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("erreur de la file : journalisée, jamais propagée", async () => {
    queue.enqueue.mockRejectedValue(new Error("REDIS_URL manquante"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(refreshCampaignStats()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
