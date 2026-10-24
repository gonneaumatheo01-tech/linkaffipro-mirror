/** Relecture adverse (phase 25) : « Rapport maintenant » respecte les pauses ; le rapport compte le plafond IA. */
import { describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { ALGO_WEEKLY_KEY, runAlgoReportNowImpl } from "./algo";
import type { LlmProvider } from "../types";

function kitWith(o: { paused?: boolean; pausedAll?: boolean; level?: number; llmCap?: number; spent?: number }) {
  const kit = createTestKit(new Date("2026-10-26T08:00:00Z"));
  kit.prisma._tables.agentTeamConfig = [
    { id: "t1", teamKey: "algo", paused: o.paused ?? false, autonomyLevel: o.level ?? 2, simulation: true, settings: {}, monthlyBudgetCents: o.llmCap === undefined ? {} : { llm: o.llmCap } },
  ] as never;
  if (o.pausedAll) (kit.prisma._tables.setting as unknown[]).push({ key: "agents.pausedAll", value: true });
  if (o.spent) kit.prisma._tables.agentUsage = [{ id: "u1", teamKey: "algo", provider: "llm", month: "2026-10", cents: o.spent, alerted80: false, alerted100: false }] as never;
  kit.prisma._tables.recommendation = [
    { id: "r1", teamKey: "dating", target: "TEAM_CONFIG", targetId: "dating", field: "styleGuidelines", status: "PROPOSED", size: "SMALL", after: "Ton simple.", evidence: {}, createdAt: new Date() },
  ] as never;
  (kit.prisma._tables.agentTeamConfig as unknown[]).push({ id: "t2", teamKey: "dating", styleGuidelines: "" });
  const complete = vi.fn(async () => ({ text: JSON.stringify({ teams: {} }), costCents: 7 }));
  const llm: LlmProvider = { complete };
  (kit.deps as { providers?: unknown }).providers = { llm };
  return { kit, complete };
}

describe("« Rapport maintenant » de l'équipe Algorithme", () => {
  it("équipe en pause : rapport produit, sans test ni réglage appliqué, lundi non marqué", async () => {
    for (const o of [{ paused: true }, { pausedAll: true }]) {
      const { kit } = kitWith(o);
      const r = await runAlgoReportNowImpl(kit.deps, { send: false });
      expect(r.ok).toBe(true);
      expect(r.message).toContain("en pause");
      expect(kit.tables("experiment")).toHaveLength(0);
      expect(kit.tables("recommendation").find((x) => x.id === "r1")!.status).toBe("PROPOSED");
      expect(kit.tables("setting").some((s) => s.key === ALGO_WEEKLY_KEY)).toBe(false);
      expect(kit.tables("insightReport").length).toBeGreaterThan(0);
    }
  });
  it("équipe active (niveau 2) : la proposition en attente est appliquée", async () => {
    const { kit } = kitWith({});
    const r = await runAlgoReportNowImpl(kit.deps, { send: false });
    expect(r.ok).toBe(true);
    expect(kit.tables("recommendation").find((x) => x.id === "r1")!.status).toBe("APPLIED");
  });
  it("rapport : plafond IA vérifié avant l'appel, dépense comptée après", async () => {
    const a = kitWith({ paused: true, llmCap: 500 });
    await runAlgoReportNowImpl(a.kit.deps, { send: false });
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(a.kit.tables("agentUsage").find((u) => u.teamKey === "algo" && u.provider === "llm")!.cents).toBe(7);
    const b = kitWith({ paused: true, llmCap: 500, spent: 500 });
    await runAlgoReportNowImpl(b.kit.deps, { send: false });
    expect(b.complete).not.toHaveBeenCalled();
    const c = kitWith({ paused: true, llmCap: 0 });
    await runAlgoReportNowImpl(c.kit.deps, { send: false });
    expect(c.complete).not.toHaveBeenCalled();
  });
  it("alerte 80 % du plafond après la dépense du rapport", async () => {
    const { kit } = kitWith({ paused: true, llmCap: 10, spent: 1 });
    await runAlgoReportNowImpl(kit.deps, { send: false });
    expect(kit.sent.some((m) => m.html.includes("80 %"))).toBe(true);
  });
});
