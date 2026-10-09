import { QUEUE_NAMES, cleanFailedOlderThan } from "@linkaffipro/queue";
import { logger } from "../logger";

/** Les tâches échouées sont gardées 7 jours (consultables et relançables sur la page État), puis purgées. */
export const FAILED_JOBS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Purge, dans chaque file, les tâches échouées depuis plus de 7 jours. */
export async function cleanOldFailedJobs(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of QUEUE_NAMES) {
    try {
      out[name] = await cleanFailedOlderThan(name, FAILED_JOBS_RETENTION_MS);
    } catch (err) {
      logger.warn({ queue: name, err: (err as Error).message }, "purge des tâches échouées impossible");
      out[name] = 0;
    }
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > 0) logger.info({ removed: out }, "tâches échouées anciennes purgées");
  return out;
}
