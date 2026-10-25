/**
 * `pnpm montage:diag` (phase 28) : ffmpeg (version, codecs h264 / hevc / aac, filtres), place libre du dossier de
 * travail, file `agents-montage`, dernier montage. Code 0 si tout est prêt, 1 sinon. En production (le montage tourne
 * dans le worker) : `railway ssh --service worker -- pnpm montage:diag`.
 * La file est lue par le paquet `queue` (importé par son chemin : ce paquet ne dépend pas de Redis).
 */
import { prisma } from "@linkaffipro/db";
import { createFfmpegRunner } from "../src/montage/ffmpeg";
import { MONTAGE_LIMITS, MONTAGE_QUEUE } from "../src/montage/contract";
import { formatMontageDiag, runMontageDiag } from "../src/montage/diag";

async function queueCounts(): Promise<Record<string, number> | null> {
  if (!process.env.REDIS_URL) return null;
  const queue = (await import("../../queue/src/client")) as {
    getQueue(name: string): { getJobCounts(...types: string[]): Promise<Record<string, number>> };
    closeQueues(): Promise<void>;
  };
  try {
    const counts = await Promise.race([
      queue.getQueue(MONTAGE_QUEUE).getJobCounts("waiting", "active", "delayed", "prioritized", "failed"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return counts;
  } finally {
    await queue.closeQueues().catch(() => undefined);
  }
}

const result = await runMontageDiag({
  ffmpeg: createFfmpegRunner({ defaultTimeoutMs: 20_000 }),
  workDir: process.env.MONTAGE_WORK_DIR ?? MONTAGE_LIMITS.workDir,
  prisma: process.env.DATABASE_URL ? prisma : null,
  queueCounts,
});
console.log(formatMontageDiag(result));
await prisma.$disconnect().catch(() => undefined);
process.exit(result.ok ? 0 : 1);
