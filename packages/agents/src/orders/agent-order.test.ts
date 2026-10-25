/**
 * Phase 33 — « dis à l'agent X de … » : agent retrouvé dans l'annuaire, capacités du VRAI registre, plan ramené aux
 * capacités de l'agent (aucun raccourci vers un agent).
 */
import { describe, expect, it } from "vitest";
import { agentAddressOf, agentTargetOf, restrictPlanToAgent, type AgentTarget } from "./agent-order";
import type { OrderPlan } from "./contract";

const plan = (steps: OrderPlan["steps"]): OrderPlan => ({ teamKey: "transverse", scope: { teamWide: true }, kind: "ADJUST", mode: "simulation", steps, resolved: {}, questions: [], impossible: [] });

describe("agent nommé dans la phrase", () => {
  it("repère l'agent et la consigne", () => {
    expect(agentAddressOf("dis à l'agent Rédaction d'écrire plus court sur Roulette")).toEqual({ name: "Rédaction", rest: "écrire plus court sur Roulette" });
    expect(agentAddressOf("Dis à l'agent Contrôle qualité d'interdire le mot \"gratuit\" sur Zone Interdite")?.name).toBe("Contrôle qualité");
    expect(agentAddressOf("demande à l’agent Horaires de regarder Zone Interdite")?.name).toBe("Horaires");
    expect(agentAddressOf("l'agent Horaires, il conseille quoi ?")).toBeNull();
    expect(agentAddressOf("programme les paris pour 3 jours")).toBeNull();
  });

  it("capacités du registre : Rédaction → consignes_canal, Contrôle qualité → mot_interdit_canal", () => {
    const r = agentTargetOf("dis à l'agent Rédaction d'écrire plus court sur Roulette") as AgentTarget;
    expect(r.agent.key).toBe("redaction");
    expect(r.capabilities.map((c) => c.key)).toContain("consignes_canal");
    const c = agentTargetOf("dis à l'agent Contrôle qualité d'interdire le mot gratuit sur Zone Interdite") as AgentTarget;
    expect(c.agent.key).toBe("controle");
    expect(c.capabilities.map((x) => x.key)).toContain("mot_interdit_canal");
    expect(agentTargetOf("dis à l'agent Zorglub de danser")).toEqual({ unknown: "Zorglub" });
  });

  it("plan ramené aux capacités de l'agent : une étape d'un autre agent devient impossible, avec replis", () => {
    const t = agentTargetOf("dis à l'agent Rédaction d'écrire plus court sur Roulette") as AgentTarget;
    const ok = plan([{ teamKey: "transverse", capability: "consignes_canal", params: { canal: "Roulette", consigne: "écris plus court" } }]);
    expect(restrictPlanToAgent(ok, t)).toBe(ok);
    const mixed = restrictPlanToAgent(plan([...ok.steps, { teamKey: "transverse", capability: "mot_interdit_canal", params: { mot: "gratuit" } }]), t);
    expect(mixed.steps).toHaveLength(1);
    expect(mixed.impossible[0]!.reason).toContain("Rédaction");
    const none = restrictPlanToAgent(plan([{ teamKey: "transverse", capability: "mot_interdit_canal", params: { mot: "gratuit" } }]), t);
    expect(none.steps).toEqual([]);
    expect(none.impossible[0]!.alternatives.length).toBeGreaterThan(0);
  });
});
