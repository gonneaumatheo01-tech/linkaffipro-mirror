import { enqueue } from "./client";
import type { AutomationsJob } from "./jobs";

type EventJob = Extract<AutomationsJob, { type: "event" }>;

/**
 * Émet un événement métier vers la file `automations`. Ne lève jamais (une automatisation ne doit pas
 * faire échouer le flux qui l'émet) ; sans REDIS_URL (tests), ne fait rien.
 */
export async function emitAutomationEvent(trigger: EventJob["trigger"], memberId: string | null | undefined, context: Record<string, unknown> = {}): Promise<void> {
  if (!memberId || !process.env.REDIS_URL) return;
  try {
    await enqueue("automations", { type: "event", trigger, memberId, context }, { removeOnComplete: 500, removeOnFail: 500 });
  } catch (err) {
    console.warn("[automations] émission impossible", trigger, (err as Error).message);
  }
}
