/**
 * Phase 28, chantier D — ménage du disque de travail (règle 4 : seuls la source LONG_VIDEO et les shorts SHORT restent,
 * et ils vivent dans Telegram).
 * - `cleanupClip` : images, son, SRT, rendus intermédiaires d'un short (après son rangement, son échec ou son abandon) ;
 * - `cleanupJob` : images de l'analyse, dossiers des shorts finis ; la copie de travail de la source reste tant que le
 *   travail vit et part quand il est fini (APPROVED / DONE / FAILED / CANCELLED) ;
 * - `sweepMontageWorkDir` : dossiers de plus de 24 h sans travail en cours (orphelins d'un plantage, travail supprimé),
 *   et fichiers temporaires de `resolveAssetBytes` oubliés.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  clipDir,
  framesDir,
  isTerminalJob,
  jobDir,
  safeName,
  workDirOf,
  type MontagePipelineDeps,
} from "./runtime";

export const ORPHAN_MAX_AGE_MS = 24 * 3600_000;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function remove(path: string): Promise<boolean> {
  if (!(await exists(path))) return false;
  await rm(path, { recursive: true, force: true });
  return true;
}

/** Fichiers temporaires d'un short (tout son dossier). */
export async function cleanupClip(deps: MontagePipelineDeps, jobId: string, clipId: string): Promise<boolean> {
  return remove(clipDir(deps, jobId, clipId));
}

/** Short dont le dossier n'a plus d'utilité (fabriqué, tranché ou abandonné). */
function clipFinished(c: { status: string; assetId: string | null }): boolean {
  return Boolean(c.assetId) || ["APPROVED", "REJECTED", "CANCELLED", "QC_FAILED"].includes(c.status);
}

/**
 * Ménage d'un travail. Travail fini (ou `final`) : tout le dossier, copie de la source comprise. Sinon : les images de
 * l'analyse dès que le plan est fait, et les dossiers des shorts finis.
 */
export async function cleanupJob(deps: MontagePipelineDeps, jobId: string, opts: { final?: boolean } = {}): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  const job = await deps.prisma.montageJob.findUnique({ where: { id: jobId }, select: { id: true, status: true } });
  if (!job || opts.final || isTerminalJob(job.status)) {
    if (await remove(jobDir(deps, jobId))) removed.push(jobDir(deps, jobId));
    return { removed };
  }
  if (!["PENDING", "ANALYZING"].includes(job.status) && (await remove(framesDir(deps, jobId)))) removed.push(framesDir(deps, jobId));
  const clips = await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, select: { id: true, status: true, assetId: true } });
  for (const c of clips) if (clipFinished(c) && (await cleanupClip(deps, jobId, c.id))) removed.push(clipDir(deps, jobId, c.id));
  // Dossiers de shorts disparus de la base (plan refait, short supprimé).
  const known = new Set(clips.map((c) => safeName(c.id)));
  const clipsRoot = join(jobDir(deps, jobId), "clips");
  for (const name of await readdir(clipsRoot).catch(() => [] as string[]))
    if (!known.has(name) && (await remove(join(clipsRoot, name)))) removed.push(join(clipsRoot, name));
  return { removed };
}

/**
 * Ménage quotidien : un dossier de plus de 24 h dont le travail n'existe plus ou est fini part entièrement ; un
 * travail encore en cours garde sa source mais perd ses fichiers inutiles (`cleanupJob`).
 */
export async function sweepMontageWorkDir(deps: MontagePipelineDeps, opts: { maxAgeMs?: number } = {}): Promise<{ removed: string[] }> {
  const root = workDirOf(deps);
  const maxAge = opts.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const now = (deps.now ? deps.now() : new Date()).getTime();
  const removed: string[] = [];
  const entries = await readdir(root).catch(() => [] as string[]);
  const jobs = entries.length
    ? await deps.prisma.montageJob.findMany({ select: { id: true, status: true } })
    : [];
  const byDir = new Map(jobs.map((j) => [safeName(j.id), j]));
  for (const name of entries) {
    const path = join(root, name);
    const s = await stat(path).catch(() => null);
    if (!s) continue;
    const old = now - s.mtimeMs > maxAge;
    if (name === "_resolve") {
      for (const f of await readdir(path).catch(() => [] as string[])) {
        const fs = await stat(join(path, f)).catch(() => null);
        if (fs && now - fs.mtimeMs > maxAge && (await remove(join(path, f)))) removed.push(join(path, f));
      }
      continue;
    }
    const job = byDir.get(name);
    if (!job || isTerminalJob(job.status)) {
      if (old || (job && isTerminalJob(job.status))) {
        if (await remove(path)) removed.push(path);
      }
      continue;
    }
    removed.push(...(await cleanupJob(deps, job.id)).removed);
  }
  return { removed };
}
