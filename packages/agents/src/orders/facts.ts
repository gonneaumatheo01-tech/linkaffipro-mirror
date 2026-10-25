/**
 * Chiffres d'un ordre pour Kevin (phase 33) : faits des missions de l'ordre + ce que chaque capacité rapporte
 * (`report`). Seule source des chiffres des rapports (règle « aucun chiffre inventé »). Lecture seule.
 */
import type { AgentsDeps } from "../types";
import type { OrderFacts, OrderRow } from "./contract";
import { orderMissionFacts } from "./capabilities/kit";
import { capability } from "./registry";
import { progressOf } from "./store";

export async function orderFacts(deps: AgentsDeps, order: OrderRow): Promise<OrderFacts> {
  const base = await orderMissionFacts(deps, order.id);
  const out: OrderFacts = { ordre: order.number, equipe: order.teamKey, ...base };
  const steps = progressOf(order.progress).plannedSteps ?? [];
  const seen = new Set<string>();
  for (const s of steps) {
    const k = `${s.teamKey}:${s.capability}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const cap = capability(s.teamKey, s.capability);
    if (!cap) continue;
    try {
      Object.assign(out, await cap.report(deps, order));
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, orderId: order.id }, "[orders] chiffres d'une capacité illisibles");
    }
  }
  return out;
}
