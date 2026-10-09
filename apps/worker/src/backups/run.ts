/**
 * Sauvegarde logique quotidienne de la base : `pg_dump` (client PostgreSQL installé dans l'image du worker)
 * compressé en gzip dans le volume Railway (`BACKUP_DIR`, défaut /data/backups), rotation sur 14 jours,
 * état écrit dans `Setting` `backup.last` (page Réglages → État du système, brief quotidien).
 * Aucun secret n'est journalisé : l'URL de la base est passée par l'environnement du processus enfant.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { BACKUP_KEEP, DEFAULT_BACKUP_DIR, backupFileName, filesToDelete, isBackupDue, type BackupStatus } from "./plan";

export const BACKUP_SETTING_KEY = "backup.last";

export function backupDir(): string {
  return process.env.BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR;
}

async function readStatus(): Promise<BackupStatus | null> {
  const s = await prisma.setting.findUnique({ where: { key: BACKUP_SETTING_KEY } });
  return s && s.value && typeof s.value === "object" ? (s.value as BackupStatus) : null;
}

async function writeStatus(status: BackupStatus): Promise<void> {
  await prisma.setting.upsert({ where: { key: BACKUP_SETTING_KEY }, create: { key: BACKUP_SETTING_KEY, value: status }, update: { value: status } });
}

/** Lance `pg_dump` vers un fichier gzip ; renvoie la taille écrite. */
async function dumpTo(file: string, databaseUrl: string): Promise<number> {
  const child = spawn("pg_dump", ["--no-owner", "--no-privileges", "--dbname", databaseUrl], { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(file));
  const code = await exit;
  if (code !== 0) throw new Error(`pg_dump a échoué (code ${code}) : ${stderr.trim().split("\n").slice(-2).join(" ")}`);
  return (await stat(file)).size;
}

/** Supprime les sauvegardes au-delà de la rotation ; renvoie les noms supprimés. */
export async function rotate(dir: string, keep = BACKUP_KEEP): Promise<string[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const old = filesToDelete(files, keep);
  for (const f of old) await unlink(join(dir, f)).catch(() => undefined);
  return old;
}

/** Exécute une sauvegarde maintenant (forcée) ; n'échoue jamais : l'état est écrit dans Setting. */
export async function runBackup(opts: { dayKey?: string } = {}): Promise<BackupStatus> {
  const started = Date.now();
  const dir = backupDir();
  const now = new Date();
  const base: Omit<BackupStatus, "ok" | "bytes" | "file"> = { at: now.toISOString(), durationMs: 0, dir, dayKey: opts.dayKey };
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL absent");
    await mkdir(dir, { recursive: true });
    const name = backupFileName(now);
    const file = join(dir, name);
    const bytes = await dumpTo(file, databaseUrl);
    if (bytes < 1024) throw new Error(`fichier de sauvegarde anormalement petit (${bytes} octets)`);
    const removed = await rotate(dir);
    const status: BackupStatus = { ...base, ok: true, file: name, bytes, durationMs: Date.now() - started };
    await writeStatus(status);
    logger.info({ file: name, bytes, removed: removed.length, ms: status.durationMs }, "sauvegarde de la base terminée");
    return status;
  } catch (err) {
    const previous = await readStatus().catch(() => null);
    const status: BackupStatus = { ...base, ok: false, file: previous?.ok ? previous.file : null, bytes: previous?.ok ? previous.bytes : 0, error: (err as Error).message, durationMs: Date.now() - started, dayKey: previous?.dayKey };
    await writeStatus(status).catch(() => undefined);
    logger.error({ err: (err as Error).message, dir }, "sauvegarde de la base en échec");
    return status;
  }
}

/** Tâche périodique (toutes les 10 minutes) : sauvegarde une fois par jour à partir de 4 h (Paris). */
export async function runBackupIfDue(now = new Date()): Promise<{ ran: boolean; status?: BackupStatus }> {
  const previous = await readStatus();
  const { due, dayKey } = isBackupDue(now, previous?.ok ? (previous.dayKey ?? null) : null);
  if (!due) return { ran: false };
  const status = await runBackup({ dayKey });
  return { ran: true, status };
}

/** Liste des sauvegardes présentes (nom, taille, date), la plus récente en premier. */
export async function listBackups(): Promise<Array<{ file: string; bytes: number; mtime: Date }>> {
  const dir = backupDir();
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: Array<{ file: string; bytes: number; mtime: Date }> = [];
  for (const f of files.filter((x) => x.endsWith(".sql.gz")).sort().reverse()) {
    const s = await stat(join(dir, f)).catch(() => null);
    if (s) out.push({ file: f, bytes: s.size, mtime: s.mtime });
  }
  return out;
}
