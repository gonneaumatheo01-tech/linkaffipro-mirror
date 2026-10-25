/**
 * Phase 33 (chantier B) — seul point de passage vers le chantier A (registre des capacités, exécution par le Grand
 * Chef, tâche `orders-tick`, thèmes de paris). Kevin n'exécute rien lui-même : il transmet l'ordre validé ici, et le
 * Grand Chef (`run.ts`) le confie au Chef de l'équipe. Si une signature de A change, seul ce fichier s'adapte ; les
 * tests de B remplacent ce module (`vi.mock("./ports")`).
 */
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";
import type { Capability, OrderPlan, OrderStep } from "./contract";
import { capabilitiesForAgent as registryForAgent, capability as registryCapability, listCapabilities as registryList } from "./registry";
import { extendOrder as aExtend, modifyOrder as aModify, runOrder as aRun, stopOrder as aStop } from "./run";
import { setOrderEventHook as aSetHook, type OrderEvent } from "./events";
import { SPORTS_THEMES } from "../sports/themes";

export type { OrderEvent, OrderEventType } from "./events";

export type AnyCapability = Capability<Record<string, unknown>>;


export function listCapabilities(): AnyCapability[] {
  return registryList() as unknown as AnyCapability[];
}

export function capability(teamKey: string, key: string): AnyCapability | null {
  return (registryCapability(teamKey, key) as unknown as AnyCapability | null | undefined) ?? null;
}

/** Capacités qui passent par un agent de l'annuaire (« dis à l'agent Rédaction de … »). */
export function capabilitiesForAgent(agentKey: string): AnyCapability[] {
  return registryForAgent(agentKey) as unknown as AnyCapability[];
}

/** Thèmes de paris connus (clé, libellé, synonymes) : `sports/themes.ts`. */
export function knownBetThemes(): { key: string; label: string }[] {
  return SPORTS_THEMES.map((t) => ({ key: t.key, label: t.label }));
}

/** Lance un ordre validé (`TeamOrder` existant) : dérogations, missions, réglages posés par le Grand Chef. */
export async function runOrder(
  deps: AgentsDeps,
  orderId: string,
): Promise<{ ok: boolean; message?: string; status?: string; conflicts?: Array<{ orderId: string; number: number | null; channelId: string }> }> {
  const r = await aRun(deps, orderId);
  return { ...normalizeResult(r), status: r.status, ...(r.conflicts?.length ? { conflicts: r.conflicts.map((c) => ({ orderId: c.orderId, number: c.number, channelId: c.channelId })) } : {}) };
}

/**
 * Arrête un ordre : missions non commencées annulées, dérogation close, celle en cours finit. Même forme partout
 * (site, Kevin) : `actor` journalisé dans l'`AuditLog`, `reason` facultative.
 */
export async function stopOrder(deps: AgentsDeps, orderId: string, actor: ActorRef | null, reason?: string | null): Promise<{ ok: boolean; message?: string }> {
  return normalizeResult(await aStop(deps, orderId, actor, reason ?? null));
}

/** Prolonge un ordre de `days` jours (la borne de 30 jours est revérifiée par le Grand Chef). */
export async function extendOrder(deps: AgentsDeps, orderId: string, days: number, actor?: ActorRef | null): Promise<{ ok: boolean; message?: string }> {
  return normalizeResult(await aExtend(deps, orderId, days, actor ?? null));
}

/** Remplace le plan d'un ordre en cours par un plan revalidé (nouvelles étapes planifiées comprises). */
export async function modifyOrder(
  deps: AgentsDeps,
  orderId: string,
  change: { plan: OrderPlan; steps: OrderStep[] },
  actor?: ActorRef | null,
): Promise<{ ok: boolean; message?: string }> {
  return normalizeResult(await aModify(deps, orderId, change, actor ?? null));
}

export function setOrderEventHook(hook: ((deps: AgentsDeps, event: OrderEvent) => Promise<void | boolean>) | null): void {
  aSetHook(hook);
}

function normalizeResult(r: { ok: boolean; message?: string }): { ok: boolean; message?: string } {
  return { ok: !!r.ok, message: r.message };
}
