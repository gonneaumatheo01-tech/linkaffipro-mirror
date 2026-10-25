/**
 * Phase 33 (chantier B) — seul point de passage vers le chantier A (registre des capacités, exécution par le Grand
 * Chef, tâche `orders-tick`, thèmes de paris). Kevin n'exécute rien lui-même : il transmet l'ordre validé ici, et le
 * Grand Chef (`run.ts`) le confie au Chef de l'équipe. Si une signature de A change, seul ce fichier s'adapte ; les
 * tests de B remplacent ce module (`vi.mock("./ports")`).
 */
import type { AgentsDeps } from "../types";
import type { Capability, OrderFacts, OrderPlan, OrderRow, OrderStep } from "./contract";
import { capability as registryCapability, listCapabilities as registryList } from "./registry";
import { extendOrder as aExtend, modifyOrder as aModify, runOrder as aRun, stopOrder as aStop } from "./run";
import { setOrderEventHook as aSetHook } from "./tick";
import { listBetThemes } from "../sports/themes";

export type AnyCapability = Capability<Record<string, unknown>>;

/** Événements du suivi d'un ordre (tâche `orders-tick` du chantier A). */
export type OrderEventType = "started" | "day_done" | "finished" | "failures" | "blocked";
export type OrderEvent = {
  type: OrderEventType;
  order: OrderRow;
  /** Jour concerné (AAAA-MM-JJ Paris) pour `day_done`. */
  day?: string | null;
  /** Chiffres déjà rassemblés par la capacité (`report`), sinon Kevin les demande. */
  facts?: OrderFacts | null;
  /** Motif (incident) en français. */
  reason?: string | null;
};

export function listCapabilities(): AnyCapability[] {
  return registryList() as unknown as AnyCapability[];
}

export function capability(teamKey: string, key: string): AnyCapability | null {
  return (registryCapability(teamKey as never, key) as unknown as AnyCapability | null | undefined) ?? null;
}

/** Thèmes de paris connus (clé, libellé, synonymes) : `sports/themes.ts`. */
export function knownBetThemes(): { key: string; label: string }[] {
  try {
    return (listBetThemes() as { key: string; label?: string; name?: string }[]).map((t) => ({ key: t.key, label: t.label ?? t.name ?? t.key }));
  } catch {
    return [];
  }
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

export function setOrderEventHook(hook: (deps: AgentsDeps, event: OrderEvent) => Promise<void>): void {
  aSetHook(hook as never);
}

function normalizeResult(r: unknown): { ok: boolean; message?: string } {
  if (r && typeof r === "object" && "ok" in r) return { ok: !!(r as { ok: unknown }).ok, message: (r as { message?: string }).message };
  return { ok: true };
}
