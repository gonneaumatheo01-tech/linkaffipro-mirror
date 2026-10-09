import type { Job } from "bullmq";
import type { AutomationsJob } from "@linkaffipro/queue";
import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { handleEvent, resumePending, runRuleForMember, sweepInactive } from "../automations/run";

/** Processeur de la file `automations` : événements métier et reprise des étapes différées. */
export async function processAutomations(job: Job<AutomationsJob>): Promise<unknown> {
  const data = job.data;
  if (data.type === "event") {
    const r = await handleEvent(data);
    if (r.started > 0) logger.info({ trigger: data.trigger, memberId: data.memberId, started: r.started }, "automatisations déclenchées");
    return r;
  }
  if (data.type === "test") {
    const r = await runRuleForMember(data.ruleId, data.memberId);
    logger.info({ ruleId: data.ruleId, memberId: data.memberId, status: r.status }, "automatisation testée");
    return r;
  }
  const resumed = await resumePending();
  let inactive = 0;
  // Balayage des inactifs une fois par heure (marqueur en base).
  const key = "automations.lastInactiveSweep";
  const last = await prisma.setting.findUnique({ where: { key } });
  const lastAt = typeof last?.value === "string" ? new Date(last.value) : null;
  if (!lastAt || Date.now() - lastAt.getTime() > 3_600_000) {
    inactive = await sweepInactive();
    await prisma.setting.upsert({ where: { key }, create: { key, value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  }
  if (resumed || inactive) logger.info({ resumed, inactive }, "automatisations : tick");
  return { resumed, inactive };
}

export const repeatableAutomations: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 5 * 60_000, jobId: "automations-tick" },
];
