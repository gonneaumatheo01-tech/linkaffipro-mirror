import type { Job } from "bullmq";
import type { ApprovalsJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runApprovalsTick, runExpirations, runReminders } from "../approvals/jobs";

/** Processeur de la file `approvals` : approbations échues, rappels, expirations. */
export async function processApprovals(job: Job<ApprovalsJob>): Promise<unknown> {
  const type = job.data?.type ?? "tick";
  try {
    if (type === "tick") return await runApprovalsTick();
    if (type === "reminders") return { sent: await runReminders() };
    if (type === "expirations") return { expired: await runExpirations() };
    return { ok: true };
  } catch (err) {
    logger.error({ type, err: (err as Error).message }, "approvals : erreur");
    throw err;
  }
}

/** Balayages périodiques. */
export const repeatableApprovals: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 20_000, jobId: "approvals-tick" },
  { data: { type: "reminders" }, everyMs: 5 * 60_000, jobId: "approvals-reminders" },
  { data: { type: "expirations" }, everyMs: 5 * 60_000, jobId: "approvals-expirations" },
];
