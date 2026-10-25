/**
 * Phase 33 (chantier B) — seul point de passage vers le chantier A (registre des capacités, exécution par le Grand
 * Chef, tâche `orders-tick`, thèmes de paris). Kevin n'exécute rien lui-même : il transmet l'ordre validé ici, et le
 * Grand Chef (`run.ts`) le confie au Chef de l'équipe. Si une signature de A change, seul ce fichier s'adapte ; les
 * tests de B remplacent ce module (`vi.mock("./ports")`).
 */
import type { AgentsDeps } from "../types";
import type { Capability, OrderPlan, OrderStep } from "./contract";
import { capability as registryCapability, listCapabilities as registryList } from "./registry";
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

/** Thèmes de paris connus (clé, libellé, synonymes) : `sports/themes.ts`. */
export function knownBetThemes(): { key: string; label: string }[] {
  return SPORTS_THEMES.map((t) => ({ key: t.key, label: t.label }));
}

/** Lance un ordre validé (`TeamOrder` existant) : dérogations, missions, réglages posés par le Grand Chef. */
export async function runOrder(deps: AgentsDeps, orderId: string): Promise<{ ok: boolean; message?: string }> {
  const r = (await aRun(deps as never, orderId as never)) as unknown;
  return normalizeResult(r);
}

/** Arrête un ordre : missions non commencées annulées, dérogation close, celle en cours finit. */
export async function stopOrder(deps: AgentsDeps, orderId: string, reason?: string): Promise<{ ok: boolean; message?: string }> {
  const r = (await aStop(deps as never, orderId as never, reason as never)) as unknown;
  return normalizeResult(r);
}

/** Prolonge un ordre de `days` jours (la borne de 30 jours est revérifiée par A). */
export async function extendOrder(deps: AgentsDeps, orderId: string, days: number): Promise<{ ok: boolean; message?: string }> {
  const r = (await aExtend(deps as never, orderId as never, days as never)) as unknown;
  return normalizeResult(r);
}

/** Remplace le plan d'un ordre en cours par un plan revalidé (nouvelles étapes planifiées comprises). */
export async function modifyOrder(
  deps: AgentsDeps,
  orderId: string,
  change: { plan: OrderPlan; steps: OrderStep[] },
): Promise<{ ok: boolean; message?: string }> {
  const r = (await aModify(deps as never, orderId as never, change as never)) as unknown;
  return normalizeResult(r);
}

export function setOrderEventHook(hook: ((deps: AgentsDeps, event: OrderEvent) => Promise<void>) | null): void {
  aSetHook(hook);
}

function normalizeResult(r: unknown): { ok: boolean; message?: string } {
  if (r && typeof r === "object" && "ok" in r) return { ok: !!(r as { ok: unknown }).ok, message: (r as { message?: string }).message };
  return { ok: true };
}
