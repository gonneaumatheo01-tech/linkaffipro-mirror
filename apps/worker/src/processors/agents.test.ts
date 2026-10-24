import { describe, expect, it, vi } from "vitest";

vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({}) }));
vi.mock("@linkaffipro/agents", () => ({
  runNextStep: vi.fn(async () => "next"),
  runCycle: vi.fn(async () => ({ plan: { created: 0 } })),
  resumeMissions: vi.fn(async () => ({ requeued: 0 })),
  sweepHumanRequests: vi.fn(async () => ({ sent: 0 })),
  bossDailyNudge: vi.fn(async () => ({ sent: false, reason: "nothing" })),
  sweepValidations: vi.fn(async () => ({ reminded: 0 })),
  sendDailyReport: vi.fn(async () => ({ sent: false })),
  runBench: vi.fn(async () => ({ ok: true, open: true })),
  runAlgoTick: vi.fn(async () => ({ alerts: {} })),
  runAlgoReportNow: vi.fn(async () => ({ ok: true, message: "ok", reportIds: [] })),
  runAdsTick: vi.fn(async () => ({ alerts: {} })),
  runAdsReportNow: vi.fn(async () => ({ ok: true, message: "ok", reportId: "r" })),
}));

import * as agents from "@linkaffipro/agents";
import { PROCESSORS } from "./index";
import { repeatableAgentsOrchestrator } from "./agents-orchestrator";
import { repeatableAgentsAlgo } from "./agents-algo";
import { repeatableAgentsAds } from "./agents-ads";

const job = (data: unknown, name = "x") => ({ id: "j", name, data }) as never;

describe("processeurs des agents (phase 19)", () => {
  it("files enregistrées, concurrence 2 par équipe", () => {
    for (const q of ["agents-dating", "agents-casino", "agents-sports", "agents-algo"] as const) expect(PROCESSORS[q].concurrency).toBe(2);
    expect(PROCESSORS["agents-orchestrator"].concurrency).toBe(1);
  });
  it("Grand Chef : cycle 30 min, resume 10 min, demandes 5 min", () => {
    const every = Object.fromEntries(repeatableAgentsOrchestrator.map((r) => [r.data.type, r.everyMs]));
    expect(every).toMatchObject({ cycle: 1_800_000, resume: 600_000, "human-requests": 300_000 });
  });
  it("étape : runNextStep(missionId, index) ; type inconnu → { ok: false }", async () => {
    expect(await PROCESSORS["agents-dating"].process(job({ type: "step", missionId: "m", index: 1 }, "redaction"))).toEqual({ ok: true, outcome: "next" });
    expect(agents.runNextStep).toHaveBeenCalledWith({}, "m", 1);
    expect(await PROCESSORS["agents-casino"].process(job({ type: "autre" }))).toMatchObject({ ok: false });
    expect(await PROCESSORS["agents-ads"].process(job({ type: "autre" }))).toMatchObject({ ok: false });
    expect(await PROCESSORS["agents-orchestrator"].process(job({ type: "inconnu" }))).toMatchObject({ ok: false });
  });
  it("Agent Ads : passage toutes les 30 minutes et rapport à la demande", async () => {
    expect(repeatableAgentsAds).toEqual([{ data: { type: "tick" }, everyMs: 1_800_000, jobId: "agents-ads-tick" }]);
    await PROCESSORS["agents-ads"].process(job({ type: "tick" }));
    expect(agents.runAdsTick).toHaveBeenCalledWith({});
    await PROCESSORS["agents-ads"].process(job({ type: "report-now", kind: "weekly", send: false }));
    expect(agents.runAdsReportNow).toHaveBeenCalledWith({}, { kind: "weekly", send: false });
  });
  it("orchestrateur : chaque type appelle sa fonction", async () => {
    await PROCESSORS["agents-orchestrator"].process(job({ type: "cycle", teamKey: "dating" }));
    expect(agents.runCycle).toHaveBeenCalledWith({}, { teamKey: "dating" });
    await PROCESSORS["agents-orchestrator"].process(job({ type: "report", force: true }));
    expect(agents.sendDailyReport).toHaveBeenCalledWith({}, { force: true });
    for (const t of ["resume", "human-requests", "validations"]) await PROCESSORS["agents-orchestrator"].process(job({ type: t }));
    expect(agents.resumeMissions).toHaveBeenCalled();
    expect(agents.sweepHumanRequests).toHaveBeenCalled();
    // Phase 26 : la relance quotidienne du Boss part du même balayage, juste après.
    expect(agents.bossDailyNudge).toHaveBeenCalledWith({});
    expect(agents.sweepValidations).toHaveBeenCalled();
    await PROCESSORS["agents-orchestrator"].process(job({ type: "bench", benchId: "b1" }));
    expect(agents.runBench).toHaveBeenCalledWith({}, { type: "bench", benchId: "b1" });
  });
  it("équipe Algorithme (phase 21) : passage horaire et rapport maintenant", async () => {
    expect(repeatableAgentsAlgo).toEqual([{ data: { type: "algo", task: "tick" }, everyMs: 3_600_000, jobId: "agents-algo-tick" }]);
    await PROCESSORS["agents-algo"].process(job({ type: "algo", task: "tick" }));
    expect(agents.runAlgoTick).toHaveBeenCalledWith({});
    await PROCESSORS["agents-algo"].process(job({ type: "algo", task: "report-now", send: false }));
    expect(agents.runAlgoReportNow).toHaveBeenCalledWith({}, { send: false });
  });
});
