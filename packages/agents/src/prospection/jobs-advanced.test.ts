/**
 * Phase 32 — socle : planification (heure de Paris) et aiguillage des tâches avancées de la file `agents-prospection`.
 * Les chantiers sont remplacés par un faux port : on vérifie quoi part, quand, et une seule fois.
 */
import { describe, expect, it, vi } from "vitest";
import { createBossKit } from "../boss/testing";
import type { ProspectionAdvancedPort } from "./advanced-port";
import type { ProspectionQueueJob } from "./contract";
import { ACCOUNT_SEARCH } from "./contract-advanced";
import { prospectionAdvancedSchedule, runProspectionAdvancedJob } from "./jobs-advanced";
import type { ProspectionKevinDeps } from "./kevin-port";

type Queued = { job: ProspectionQueueJob; opts?: { jobId?: string; delayMs?: number } };

async function kit() {
  const k = await createBossKit([]);
  const deps = k.deps as unknown as ProspectionKevinDeps;
  const calls: Record<string, unknown[][]> = {};
  const rec =
    <T>(name: string, out: T) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args.slice(1));
      return out;
    };
  const port: Partial<ProspectionAdvancedPort> = {
    dueForRequalify: rec("dueForRequalify", ["p1", "p2", "p3"]) as never,
    requalifyProspect: rec("requalifyProspect", { alerts: 1, status: "ok" }) as never,
    sendAlertsDigest: rec("sendAlertsDigest", { sent: 3, qaBlocked: false }) as never,
    rebuildNetworks: rec("rebuildNetworks", { networks: 1, members: 3 }) as never,
    refreshValues: rec("refreshValues", { updated: 5 }) as never,
    pullAffiliateResults: rec("pullAffiliateResults", { affiliates: 2, rows: 2, activated: 1 }) as never,
    proposeCalibration: rec("proposeCalibration", { proposed: 3 }) as never,
    sendMonthlyReport: rec("sendMonthlyReport", { sent: true, qaBlocked: false }) as never,
    runLinkReminders: rec("runLinkReminders", { sent: 1 }) as never,
    runAccountSearch: rec("runAccountSearch", { ok: true, requests: 20, found: 4, newCount: 3 }) as never,
  };
  deps.prospectionAdvanced = port;
  let now = new Date("2026-10-27T01:30:00Z");
  deps.now = () => now;
  const setNow = (iso: string) => (now = new Date(iso));
  const queued: Queued[] = [];
  const queue = vi.fn(async (_d: ProspectionKevinDeps, job: ProspectionQueueJob, opts?: { jobId?: string; delayMs?: number }) => void queued.push({ job, opts }));
  return { k, deps, calls, queued, queue, setNow };
}

const types = (q: Queued[]) => q.map((x) => x.job.type);

describe("planification avancée de la prospection", () => {
  it("nuit : relectures dues une seule fois, étalées ; compte réel seulement s'il est activé", async () => {
    const { deps, queued, queue, setNow, k } = await kit();
    await prospectionAdvancedSchedule(deps, queue); // 02:30 Paris
    expect(types(queued)).toEqual(["prospection.requalify-one", "prospection.requalify-one", "prospection.requalify-one"]);
    expect(queued[2]!.opts!.delayMs).toBeGreaterThan(0);
    await prospectionAdvancedSchedule(deps, queue);
    expect(queued).toHaveLength(3);

    // Activée par le client : un lot par verticale, la nuit suivante.
    await k.prisma.setting.create({ data: { key: ACCOUNT_SEARCH.enabled.key, value: true } });
    setNow("2026-10-28T01:30:00Z");
    queued.length = 0;
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued).filter((t) => t === "prospection.account-search")).toHaveLength(2);
  });

  it("compte réel désactivé par défaut : aucun lot", async () => {
    const { deps, queued, queue } = await kit();
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).not.toContain("prospection.account-search");
  });

  it("matin : réseaux et valeurs à 6 h 30, alertes à 9 h 10 (pas avant), lundi : rappel du rattachement", async () => {
    const { deps, queued, queue, setNow } = await kit();
    setNow("2026-10-27T05:35:00Z"); // 06:35 Paris (mardi)
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).toEqual(["prospection.networks", "prospection.values"]);
    queued.length = 0;
    setNow("2026-10-27T08:05:00Z"); // 09:05
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).toEqual([]);
    setNow("2026-10-27T08:12:00Z"); // 09:12
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).toEqual(["prospection.alerts-digest"]);
    expect(types(queued)).not.toContain("prospection.link-reminders");
    queued.length = 0;
    setNow("2026-11-02T08:25:00Z"); // lundi 09:25 Paris (heure d'hiver)
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).toContain("prospection.link-reminders");
  });

  it("le 1er du mois : résultats, calibrage puis rapport, une seule fois", async () => {
    const { deps, calls, queued, queue, setNow } = await kit();
    setNow("2026-11-01T06:30:00Z"); // 07:30 Paris
    await prospectionAdvancedSchedule(deps, queue);
    const pull = queued.find((q) => q.job.type === "prospection.learn-pull")!;
    expect(pull.job).toEqual({ type: "prospection.learn-pull", month: "2026-10" });
    const r = await runProspectionAdvancedJob(deps, pull.job as never);
    expect(r).toMatchObject({ monthly: { pulled: { affiliates: 2 }, calibration: { proposed: 3 }, report: { sent: true } } });
    expect(await runProspectionAdvancedJob(deps, pull.job as never)).toEqual({ monthly: { skipped: "déjà fait" } });
    expect(calls.pullAffiliateResults).toHaveLength(1);
    expect(calls.sendMonthlyReport).toHaveLength(1);
    queued.length = 0;
    await prospectionAdvancedSchedule(deps, queue);
    expect(types(queued)).not.toContain("prospection.learn-pull");
  });

  it("message des alertes : une seule fois par jour ; un échec libère le repère", async () => {
    const { deps, calls, setNow } = await kit();
    setNow("2026-10-27T08:12:00Z");
    let fail = true;
    deps.prospectionAdvanced!.sendAlertsDigest = (async () => {
      (calls.digest ??= []).push([]);
      if (fail) throw new Error("panne");
      return { sent: 2, qaBlocked: false };
    }) as never;
    await expect(runProspectionAdvancedJob(deps, { type: "prospection.alerts-digest" })).rejects.toThrow("panne");
    fail = false;
    expect(await runProspectionAdvancedJob(deps, { type: "prospection.alerts-digest" })).toEqual({ digest: { sent: 2, qaBlocked: false } });
    expect(await runProspectionAdvancedJob(deps, { type: "prospection.alerts-digest" })).toEqual({ digest: { skipped: "déjà fait" } });
    expect(calls.digest).toHaveLength(2);
  });

  it("aiguillage : chaque tâche va à sa fonction", async () => {
    const { deps, calls } = await kit();
    await runProspectionAdvancedJob(deps, { type: "prospection.requalify-one", prospectId: "p9" });
    await runProspectionAdvancedJob(deps, { type: "prospection.networks" });
    await runProspectionAdvancedJob(deps, { type: "prospection.values" });
    await runProspectionAdvancedJob(deps, { type: "prospection.account-search", lot: { vertical: "CASINO", languages: ["pl"] } });
    await runProspectionAdvancedJob(deps, { type: "prospection.learn-pull" });
    expect(calls.requalifyProspect).toEqual([["p9"]]);
    expect(calls.rebuildNetworks).toHaveLength(1);
    expect(calls.refreshValues).toHaveLength(1);
    expect(calls.runAccountSearch).toEqual([[{ vertical: "CASINO", languages: ["pl"] }]]);
    expect(calls.pullAffiliateResults).toEqual([[null]]);
  });
});
