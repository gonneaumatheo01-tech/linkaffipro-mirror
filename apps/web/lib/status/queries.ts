/** Requêtes de la page Réglages → État du système. Chaque bloc tolère une panne (message plutôt qu'erreur de page). */
import { prisma } from "@linkaffipro/db";
import {
  QUEUE_NAMES,
  heartbeatAgeSec,
  isWorkerDown,
  queueCounts,
  readHeartbeat,
  recentFailedJobs,
  type FailedJobSummary,
  type Heartbeat,
  type QueueCounts,
} from "@linkaffipro/queue";
import { getWebhookInfoForBot, webhookUrlFor } from "@linkaffipro/telegram";
import { withRedis } from "@/lib/redis";
import { eventLabel } from "@/lib/journal/event-labels";
import { VISIBLE_EVENT_WHERE } from "@/lib/journal/events";

export type WebHealth = { db: "ok" | string; dbLatencyMs: number | null; redis: "ok" | string };
export type WorkerHealth = {
  heartbeat: Heartbeat | null;
  ageSec: number | null;
  down: boolean;
  error?: string;
};
export type BotStatus = {
  id: string;
  name: string;
  username: string;
  isActive: boolean;
  lastWebhookAt: Date | null;
  lastError: string | null;
  webhook: {
    ok: boolean;
    url?: string;
    pending?: number;
    lastError?: string;
    lastErrorAt?: Date;
    fetchError?: string;
  } | null;
};
/** Activité des bots et des membres sur 24 h (table `Event`), par type, avec le libellé en français. */
export type BotActivity = {
  total: number;
  byType: Array<{ type: string; label: string; count: number }>;
  error?: string;
};

export type BackupInfo = {
  at: Date | null;
  file: string | null;
  bytes: number;
  ok: boolean;
  error?: string;
  durationMs?: number;
  dir?: string;
} | null;

export type SystemStatus = {
  web: WebHealth;
  worker: WorkerHealth;
  queues: { counts: QueueCounts[]; error?: string };
  failedJobs: FailedJobSummary[];
  bots: BotStatus[];
  syncStates: Array<{
    source: string;
    lastRunAt: Date | null;
    lastSuccessAt: Date | null;
    lastError: string | null;
    rowsImported: number;
    isRunning: boolean;
  }>;
  openAlerts: Array<{
    id: string;
    kind: string;
    severity: string;
    message: string;
    createdAt: Date;
  }>;
  backup: BackupInfo;
  botActivity: BotActivity;
};

/** Course contre la montre : les files BullMQ utilisent la connexion partagée, qui attend indéfiniment si Redis est absent. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} : pas de réponse en ${ms / 1000} s`)), ms),
    ),
  ]);
}

async function webHealth(): Promise<WebHealth> {
  const t0 = performance.now();
  const db = await prisma.$queryRaw`SELECT 1`
    .then(() => "ok")
    .catch((e: Error) => `erreur : ${e.message}`);
  const dbLatencyMs = db === "ok" ? Math.round((performance.now() - t0) * 10) / 10 : null;
  const redis = await withRedis((c) => c.ping())
    .then((p) => (p === "PONG" ? "ok" : `réponse inattendue : ${p}`))
    .catch((e: Error) => `erreur : ${e.message}`);
  return { db, dbLatencyMs, redis };
}

async function workerHealth(now: Date): Promise<WorkerHealth> {
  try {
    const { heartbeat } = await withRedis((c) => readHeartbeat(c));
    return {
      heartbeat,
      ageSec: heartbeatAgeSec(heartbeat, now),
      down: isWorkerDown(heartbeat, now),
    };
  } catch (err) {
    return { heartbeat: null, ageSec: null, down: true, error: (err as Error).message };
  }
}

async function botStatuses(): Promise<BotStatus[]> {
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      isActive: true,
      lastWebhookAt: true,
      lastError: true,
    },
  });
  return Promise.all(
    bots.map(async (b) => {
      if (!b.isActive) return { ...b, webhook: null };
      try {
        const info = await withTimeout(getWebhookInfoForBot(b.id), 5000, "Telegram");
        return {
          ...b,
          webhook: {
            ok: info.url === webhookUrlFor(b.id) && !info.last_error_message,
            url: info.url,
            pending: info.pending_update_count,
            lastError: info.last_error_message,
            lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000) : undefined,
          },
        };
      } catch (err) {
        return { ...b, webhook: { ok: false, fetchError: (err as Error).message } };
      }
    }),
  );
}

function parseBackup(value: unknown): BackupInfo {
  if (!value || typeof value !== "object") return null;
  const v = value as {
    at?: string;
    file?: string | null;
    bytes?: number;
    ok?: boolean;
    error?: string;
    durationMs?: number;
    dir?: string;
  };
  const at = typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? new Date(v.at) : null;
  return {
    at,
    file: typeof v.file === "string" ? v.file : null,
    bytes: Number(v.bytes ?? 0),
    ok: v.ok === true,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    ...(typeof v.durationMs === "number" ? { durationMs: v.durationMs } : {}),
    ...(typeof v.dir === "string" ? { dir: v.dir } : {}),
  };
}

/** Événements des dernières 24 h (hors activité Link Affi d'autres affiliés), du type le plus fréquent au plus rare. */
export async function botActivity24h(now = new Date()): Promise<BotActivity> {
  const rows = await prisma.event.groupBy({
    by: ["type"],
    where: {
      AND: [
        VISIBLE_EVENT_WHERE,
        { occurredAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } },
      ],
    },
    _count: { _all: true },
  });
  const byType = rows
    .map((r) => ({ type: r.type, label: eventLabel(r.type), count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"));
  return { total: byType.reduce((a, r) => a + r.count, 0), byType };
}

export async function getSystemStatus(now = new Date()): Promise<SystemStatus> {
  const [web, worker, queues, failedJobs, bots, syncStates, openAlerts, backupSetting, activity] =
    await Promise.all([
      webHealth(),
      workerHealth(now),
      withTimeout(queueCounts(), 5000, "Files")
        .then((counts) => ({ counts }))
        .catch((e: Error) => ({
          counts: QUEUE_NAMES.map((name) => ({
            name,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            paused: 0,
          })),
          error: e.message,
        })),
      withTimeout(recentFailedJobs(20), 5000, "Files").catch(() => [] as FailedJobSummary[]),
      botStatuses().catch(() => [] as BotStatus[]),
      prisma.syncState.findMany({
        orderBy: { source: "asc" },
        select: {
          source: true,
          lastRunAt: true,
          lastSuccessAt: true,
          lastError: true,
          rowsImported: true,
          isRunning: true,
        },
      }),
      prisma.alert.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, kind: true, severity: true, message: true, createdAt: true },
      }),
      prisma.setting.findUnique({ where: { key: "backup.last" } }),
      botActivity24h(now).catch((e: Error): BotActivity => ({
        total: 0,
        byType: [],
        error: e.message,
      })),
    ]);
  return {
    web,
    worker,
    queues,
    failedJobs,
    bots,
    syncStates,
    openAlerts,
    backup: parseBackup(backupSetting?.value),
    botActivity: activity,
  };
}
