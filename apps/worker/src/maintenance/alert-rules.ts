/** Règles pures de détection des alertes (testées sans base). */

export type AlertKind = "bot_webhook" | "sync_failed" | "queue_backlog" | "dm_blocked" | "subid_health" | "worker_down" | "job_failures" | "backup_failed";
export type AlertSeverityKey = "INFO" | "WARNING" | "CRITICAL";
export type Detected = { kind: AlertKind; severity: AlertSeverityKey; message: string; payload: Record<string, unknown> };

export const WEBHOOK_SILENCE_MS = 10 * 60 * 1000;
export const QUEUE_BACKLOG_THRESHOLD = 500;
export const DM_BLOCKED_THRESHOLD = 50;
export const SYNC_ERROR_STREAK = 3;
/** Worker considéré arrêté sans battement depuis 3 min ; « erreurs répétées » à partir de 10 échecs en 15 min sur une file. */
export const WORKER_DOWN_MS = 3 * 60 * 1000;
export const JOB_FAILURES_THRESHOLD = 10;
/** Sauvegarde : alerte si le dernier essai a échoué et qu'aucune sauvegarde n'a réussi depuis 36 h. */
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60 * 1000;
/** Une alerte du même type non résolue datant de moins de 24 h n'est pas recréée (une notification par jour au plus). */
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BotSnapshot = { username: string; isActive: boolean; lastWebhookAt: Date | null; lastError: string | null };

/** Bots en erreur, ou silencieux depuis 10 min alors qu'un autre bot reçoit des updates. */
export function detectBotWebhook(bots: BotSnapshot[], now: Date): Detected | null {
  const active = bots.filter((b) => b.isActive);
  const recent = active.some((b) => b.lastWebhookAt && now.getTime() - b.lastWebhookAt.getTime() < WEBHOOK_SILENCE_MS);
  const faulty = active.filter((b) => b.lastError || (recent && (!b.lastWebhookAt || now.getTime() - b.lastWebhookAt.getTime() >= WEBHOOK_SILENCE_MS)));
  if (faulty.length === 0) return null;
  const names = faulty.map((b) => `@${b.username}${b.lastError ? ` (${b.lastError.slice(0, 80)})` : " (silencieux)"}`).join(", ");
  return { kind: "bot_webhook", severity: "CRITICAL", message: `Bot en difficulté : ${names}`, payload: { bots: faulty.map((b) => b.username) } };
}

export type SyncSnapshot = { source: string; lastError: string | null; errorStreak: number };

/** Une table en échec sur 3 passages consécutifs. */
export function detectSyncFailed(states: SyncSnapshot[]): Detected | null {
  const failing = states.filter((s) => s.lastError && s.errorStreak >= SYNC_ERROR_STREAK);
  if (failing.length === 0) return null;
  return { kind: "sync_failed", severity: "WARNING", message: `Synchro Link Affi en échec répété : ${failing.map((s) => `${s.source} (${(s.lastError ?? "").slice(0, 60)})`).join(", ")}`, payload: { sources: failing.map((s) => s.source) } };
}

export function detectQueueBacklog(waiting: number): Detected | null {
  if (waiting <= QUEUE_BACKLOG_THRESHOLD) return null;
  return { kind: "queue_backlog", severity: "WARNING", message: `File d'envoi Telegram engorgée : ${waiting} messages en attente`, payload: { waiting } };
}

export function detectDmBlocked(blockedLastHour: number): Detected | null {
  if (blockedLastHour <= DM_BLOCKED_THRESHOLD) return null;
  return { kind: "dm_blocked", severity: "WARNING", message: `${blockedLastHour} messages privés bloqués dans l'heure (membres ayant bloqué le bot ou fenêtres expirées)`, payload: { blockedLastHour } };
}

export function detectSubIdHealth(status: string, message: string): Detected | null {
  if (status !== "alert") return null;
  return { kind: "subid_health", severity: "CRITICAL", message: `Santé du sub-ID : ${message}`, payload: { status } };
}

/**
 * Worker absent : le dernier battement connu date de plus de 3 minutes.
 * Évaluée (1) par le site dans `/api/health` pendant l'absence et (2) par le worker à son redémarrage,
 * pour signaler la durée de l'absence (`lastHeartbeatAt` = copie persistante du battement).
 */
export function detectWorkerDown(lastHeartbeatAt: Date | null, now: Date): Detected | null {
  if (!lastHeartbeatAt) return null;
  const downMs = now.getTime() - lastHeartbeatAt.getTime();
  if (downMs < WORKER_DOWN_MS) return null;
  const minutes = Math.round(downMs / 60_000);
  return { kind: "worker_down", severity: "CRITICAL", message: `Worker arrêté : aucun signe de vie depuis ${minutes} min (dernier battement ${formatTime(lastHeartbeatAt)})`, payload: { lastHeartbeatAt: lastHeartbeatAt.toISOString(), downMinutes: minutes } };
}

/** Erreurs répétées : au moins 10 tâches échouées en 15 minutes sur une même file. */
export function detectJobFailures(failuresByQueue: Record<string, number>): Detected | null {
  const hot = Object.entries(failuresByQueue).filter(([, n]) => n >= JOB_FAILURES_THRESHOLD);
  if (hot.length === 0) return null;
  const list = hot.map(([q, n]) => `${q} (${n})`).join(", ");
  return { kind: "job_failures", severity: "WARNING", message: `Erreurs répétées sur les tâches du worker en 15 min : ${list}. Voir Réglages → État du système.`, payload: { queues: Object.fromEntries(hot) } };
}

/** Dernier état de sauvegarde (`Setting` `backup.last`, écrit par `backups/run.ts`) ; un échec garde le `file` du dernier succès. */
export type BackupSnapshot = { at: string; file: string | null; ok: boolean; error?: string };

/** Date encodée dans le nom d'un fichier de sauvegarde (`linkaffipro-2026-10-09T04-00-00.sql.gz`), sinon null. */
export function backupFileDate(file: string | null | undefined): Date | null {
  const m = file?.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sauvegarde en échec : le dernier essai a échoué et le dernier succès (date du fichier conservé) est absent ou
 * plus vieux que 36 h. Rien tant qu'aucune sauvegarde n'a été tentée.
 */
export function detectBackupFailed(status: BackupSnapshot | null, now: Date): Detected | null {
  if (!status || status.ok) return null;
  const lastSuccess = backupFileDate(status.file);
  if (lastSuccess && now.getTime() - lastSuccess.getTime() < BACKUP_MAX_AGE_MS) return null;
  const error = (status.error ?? "erreur inconnue").slice(0, 160);
  return { kind: "backup_failed", severity: "CRITICAL", message: `La sauvegarde automatique de la base a échoué : ${error}`, payload: { at: status.at, lastSuccessAt: lastSuccess?.toISOString() ?? null, error } };
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(d);
}

/** Faut-il créer une nouvelle alerte ? Non si une alerte du même type est ouverte et récente. */
export function shouldCreate(kind: AlertKind, open: Array<{ kind: string; createdAt: Date }>, now: Date): boolean {
  return !open.some((a) => a.kind === kind && now.getTime() - a.createdAt.getTime() < DEDUP_WINDOW_MS);
}

/** Formate l'alerte pour Telegram (HTML). */
export function formatAlert(d: Detected): string {
  const icon = d.severity === "CRITICAL" ? "🔴" : d.severity === "WARNING" ? "🟠" : "ℹ️";
  return `${icon} <b>Alerte ${d.kind}</b>\n${escapeHtml(d.message)}\n<i>Voir Réglages → Alertes.</i>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
