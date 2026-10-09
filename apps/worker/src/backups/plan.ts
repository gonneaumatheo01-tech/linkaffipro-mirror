/**
 * Sauvegardes automatiques : règles pures (quand sauvegarder, quel nom de fichier, lesquels supprimer).
 * La sauvegarde elle-même (pg_dump) est dans `run.ts`.
 */
import { parisParts } from "../reports/schedule";

/** Heure de Paris à partir de laquelle la sauvegarde quotidienne est due. */
export const BACKUP_HOUR = 4;
/** Nombre de sauvegardes quotidiennes conservées. */
export const BACKUP_KEEP = 14;
/** Dossier par défaut (volume Railway monté sur /data). */
export const DEFAULT_BACKUP_DIR = "/data/backups";

export const BACKUP_PREFIX = "linkaffipro-";
export const BACKUP_SUFFIX = ".sql.gz";

/** Vrai si une sauvegarde est due : heure atteinte et aucune sauvegarde réussie aujourd'hui (clé de jour Paris). */
export function isBackupDue(now: Date, lastDayKey: string | null, hour = BACKUP_HOUR): { due: boolean; dayKey: string } {
  const { hour: h, dayKey } = parisParts(now);
  return { due: h >= hour && lastDayKey !== dayKey, dayKey };
}

/** Nom de fichier horodaté (UTC, sans caractères spéciaux). */
export function backupFileName(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}${BACKUP_SUFFIX}`;
}

/** Parmi les fichiers de sauvegarde présents, ceux à supprimer pour n'en garder que `keep` (les plus récents par nom). */
export function filesToDelete(files: readonly string[], keep = BACKUP_KEEP): string[] {
  const ours = files.filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/** Dernier état de sauvegarde, stocké dans `Setting` `backup.last` (lu par la page État et le brief quotidien). */
export type BackupStatus = { at: string; file: string | null; bytes: number; ok: boolean; error?: string; durationMs: number; dir: string; dayKey?: string };

/** Résumé en français pour le brief quotidien. */
export function describeBackup(status: BackupStatus | null): string {
  if (!status) return "aucune sauvegarde automatique encore faite";
  const when = new Date(status.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  if (!status.ok) return `dernière sauvegarde en échec le ${when} (${status.error ?? "erreur inconnue"})`;
  return `dernière sauvegarde ok le ${when} (${(status.bytes / 1024).toFixed(0)} Ko)`;
}
