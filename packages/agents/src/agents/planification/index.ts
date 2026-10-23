/**
 * Agent Planification : choisit l'heure de publication (quota, espacement, fenêtre et heures calmes du canal,
 * meilleurs horaires, posts déjà programmés). Aucun appel externe.
 */
import type { AgentDefinition } from "../../types";
import { planSlot } from "./plan";

export const agent: AgentDefinition = {
  key: "planification",
  async run(mission, ctx) {
    const slot = await planSlot(mission, ctx);
    if (!slot.ok) return { ok: false, error: slot.reason, retryable: false };
    return { ok: true, output: { slot: slot.at.toISOString() }, summary: `créneau ${slot.at.toISOString()}` };
  },
};
