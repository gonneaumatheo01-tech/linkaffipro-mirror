/**
 * Événements d'ordres du Grand Chef vers Kevin (phase 33) : `started`, `day_done`, `finished`, `failures`, `blocked`.
 * Toujours journalisés (`Event` `agents.order.<type>`) ; le chantier B branche les rapports de Kevin par
 * `setOrderEventHook((deps, event) => …)`. Un crochet qui lève n'arrête jamais le Grand Chef.
 */
import { agentEvent } from "../admin/journal";
import type { AgentsDeps } from "../types";
import type { OrderFacts, OrderRow } from "./contract";

export type OrderEventType = "started" | "day_done" | "finished" | "failures" | "blocked";

export type OrderEvent = {
  type: OrderEventType;
  /** Ordre tel que lu en base au moment de l'événement. */
  order?: OrderRow;
  orderId: string;
  number: number;
  teamKey: string;
  chatId: string | null;
  /** Jour concerné (`day_done`), AAAA-MM-JJ. */
  day?: string;
  /** Rang du jour dans l'ordre (1 = premier) et nombre de jours. */
  dayIndex?: number;
  days?: number;
  /** Missions échouées (`failures`). */
  failures?: number;
  /** Motif (`blocked`, `failures`). */
  reason?: string;
  /** Chiffres structurés (seule source des chiffres des messages de Kevin). */
  facts: OrderFacts;
};

/** Crochet des rapports : `false` = message pas parti (le Grand Chef ne marque alors pas le jour comme rapporté). */
export type OrderEventHook = (deps: AgentsDeps, event: OrderEvent) => Promise<void | boolean> | void | boolean;

let hook: OrderEventHook | null = null;

/** Branche (ou retire avec `null`) le crochet des rapports de Kevin. */
export function setOrderEventHook(fn: OrderEventHook | null): void {
  hook = fn;
}

/** Journalise l'événement et appelle le crochet ; vrai si le rapport est parti (ou s'il n'y a pas de crochet). */
export async function emitOrderEvent(deps: AgentsDeps, event: OrderEvent): Promise<boolean> {
  await agentEvent(deps, `agents.order.${event.type}`, {
    orderId: event.orderId,
    number: event.number,
    teamKey: event.teamKey,
    ...(event.day ? { day: event.day } : {}),
    ...(event.failures !== undefined ? { failures: event.failures } : {}),
    ...(event.reason ? { reason: event.reason.slice(0, 300) } : {}),
  });
  if (!hook) return true;
  try {
    return (await hook(deps, event)) !== false;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, orderId: event.orderId, type: event.type }, "[orders] crochet des rapports en erreur");
    return false;
  }
}
