/** Règles pures de détection des alertes (testées sans base). */

export type AlertKind = "bot_webhook" | "sync_failed" | "queue_backlog" | "dm_blocked" | "subid_health";
export type AlertSeverityKey = "INFO" | "WARNING" | "CRITICAL";
export type Detected = { kind: AlertKind; severity: AlertSeverityKey; message: string; payload: Record<string, unknown> };

export const WEBHOOK_SILENCE_MS = 10 * 60 * 1000;
export const QUEUE_BACKLOG_THRESHOLD = 500;
export const DM_BLOCKED_THRESHOLD = 50;
export const SYNC_ERROR_STREAK = 3;
/** Une alerte du même type non résolue datant de moins d'une heure n'est pas recréée. */
export const DEDUP_WINDOW_MS = 60 * 60 * 1000;

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
