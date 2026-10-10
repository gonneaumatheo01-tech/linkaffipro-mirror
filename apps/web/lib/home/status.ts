/**
 * Barre d'état de l'accueil (fonction pure, testée dans status.test.ts) : verte « Tout va bien · 3 bots en ligne ·
 * Link Affi synchronisé il y a 2 min », orange « N points à voir » sinon.
 *
 * Points à voir : service d'arrière-plan muet (battement `worker:heartbeat` absent depuis 3 min), aucun bot actif,
 * chaque bot actif en erreur (`Bot.lastError`), synchro Link Affi en échec (une table `SyncState` en erreur), et
 * chaque alerte ouverte qui ne redit pas un de ces points (une alerte `worker_down` alors que le service est déjà
 * signalé muet ne compte pas deux fois).
 */
import { fmtRelative } from "@/lib/format";

export type StatusBotInput = {
  username: string;
  isActive: boolean;
  lastError: string | null;
};

export type StatusInput = {
  workerDown: boolean;
  bots: readonly StatusBotInput[];
  /** Tables de la synchro Link Affi (`SyncState`). */
  sync: ReadonlyArray<{ lastSuccessAt: Date | null; lastError: string | null }>;
  /** Alertes non résolues (`Alert.resolvedAt` vide). */
  openAlerts: ReadonlyArray<{ kind: string }>;
};

export type StatusIssue = {
  key: string;
  /** Phrase courte, en français simple. */
  label: string;
  /** Poids dans « N points à voir » (les alertes comptent une par une). */
  count: number;
};

export type StatusBar = {
  ok: boolean;
  /** Nombre de points à voir. */
  points: number;
  issues: StatusIssue[];
  botsOnline: number;
  /** Dernière synchro Link Affi réussie (toutes tables confondues). */
  lastSyncAt: Date | null;
};

/** Alertes qui redisent un point déjà signalé par la barre. */
const ALERT_KIND_OF_ISSUE: Record<string, string> = {
  worker: "worker_down",
  "no-bot": "bot_webhook",
  bot: "bot_webhook",
  sync: "sync_failed",
};

export function buildStatusBar(input: StatusInput): StatusBar {
  const issues: StatusIssue[] = [];
  if (input.workerDown)
    issues.push({ key: "worker", label: "Envois et synchro à l'arrêt", count: 1 });
  const active = input.bots.filter((b) => b.isActive);
  if (active.length === 0) issues.push({ key: "no-bot", label: "Aucun bot actif", count: 1 });
  for (const b of active)
    if (b.lastError)
      issues.push({ key: `bot:${b.username}`, label: `Bot @${b.username} en erreur`, count: 1 });
  if (input.sync.some((s) => s.lastError))
    issues.push({ key: "sync", label: "Synchro Link Affi en échec", count: 1 });

  const covered = new Set(
    issues.map((i) => ALERT_KIND_OF_ISSUE[i.key.split(":")[0]!]).filter(Boolean),
  );
  const alerts = input.openAlerts.filter((a) => !covered.has(a.kind)).length;
  if (alerts > 0)
    issues.push({
      key: "alerts",
      label: alerts === 1 ? "1 alerte ouverte" : `${alerts} alertes ouvertes`,
      count: alerts,
    });

  const lastSyncAt = input.sync.reduce<Date | null>(
    (acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc),
    null,
  );
  const points = issues.reduce((n, i) => n + i.count, 0);
  return {
    ok: points === 0,
    points,
    issues,
    botsOnline: active.filter((b) => !b.lastError).length,
    lastSyncAt,
  };
}

/** « 3 bots en ligne », « 1 bot en ligne », « Aucun bot en ligne ». */
export function botsOnlineLabel(n: number): string {
  if (n === 0) return "Aucun bot en ligne";
  return n === 1 ? "1 bot en ligne" : `${n} bots en ligne`;
}

/** « Link Affi synchronisé il y a 2 min », ou « Link Affi pas encore synchronisé ». */
export function syncLabel(lastSyncAt: Date | null, now: Date): string {
  if (!lastSyncAt) return "Link Affi pas encore synchronisé";
  return `Link Affi synchronisé ${fmtRelative(lastSyncAt, now)}`;
}

/** « 1 point à voir », « 3 points à voir ». */
export function pointsLabel(n: number): string {
  return n === 1 ? "1 point à voir" : `${n} points à voir`;
}

/** Morceaux de la phrase de la barre (séparés par « · » à l'écran). */
export function statusParts(bar: StatusBar, now: Date): string[] {
  const head = bar.ok ? "Tout va bien" : pointsLabel(bar.points);
  return [head, botsOnlineLabel(bar.botsOnline), syncLabel(bar.lastSyncAt, now)];
}
