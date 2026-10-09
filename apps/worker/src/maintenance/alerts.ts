import { prisma, toJsonValue } from "@linkaffipro/db";
import { HEALTH_WINDOW_DAYS, evaluateSubIdHealth } from "@linkaffipro/linkaffi";
import { HEARTBEAT_LAST_KEY, QUEUE_NAMES, countRecentFailures, getQueue, getRedis, parseHeartbeat } from "@linkaffipro/queue";
import type { Redis } from "ioredis";
import { notifyAdmin } from "@linkaffipro/telegram";
import { logger } from "../logger";
import {
  detectBackupFailed,
  detectBotWebhook,
  detectDmBlocked,
  detectJobFailures,
  detectQueueBacklog,
  detectSubIdHealth,
  detectSyncFailed,
  detectWorkerDown,
  DEDUP_WINDOW_MS,
  formatAlert,
  shouldCreate,
  type AlertKind,
  type BackupSnapshot,
  type Detected,
} from "./alert-rules";

/** Santé du sub-ID sur 7 jours (mêmes requêtes que Réglages → Connecteurs). */
async function subIdHealth(now: Date) {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 24 * 3600 * 1000);
  const [postback, timeMatch, offerClicks, clicked] = await Promise.all([
    prisma.player.count({ where: { subIdSource: "postback", createdAt: { gte: since } } }),
    prisma.player.count({ where: { subIdSource: "time_match", createdAt: { gte: since } } }),
    prisma.click.count({ where: { subId: { not: null }, createdAt: { gte: since } } }),
    prisma.trackingLink.findMany({
      where: { affiliateCampaignId: { not: null }, clickRecords: { some: { subId: { not: null }, createdAt: { gte: since } } } },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const ids = clicked.map((t) => t.affiliateCampaignId).filter((x): x is string => x !== null);
  const missingWithClicks = ids.length === 0 ? 0 : await prisma.player.count({ where: { subId: null, createdAt: { gte: since }, affiliateCampaignId: { in: ids } } });
  return evaluateSubIdHealth({ postback, timeMatch, missingWithClicks, offerClicks });
}

function parseBackupSnapshot(value: unknown): BackupSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<BackupSnapshot>;
  if (typeof v.at !== "string" || typeof v.ok !== "boolean") return null;
  return { at: v.at, file: typeof v.file === "string" ? v.file : null, ok: v.ok, ...(typeof v.error === "string" ? { error: v.error } : {}) };
}

/** Évalue toutes les règles et renvoie les alertes détectées. */
export async function detectAlerts(now = new Date()): Promise<Detected[]> {
  const detected: Detected[] = [];
  const bots = await prisma.bot.findMany({ select: { username: true, isActive: true, lastWebhookAt: true, lastError: true } });
  const d1 = detectBotWebhook(bots, now);
  if (d1) detected.push(d1);

  const states = await prisma.syncState.findMany({ select: { source: true, lastError: true, cursor: true } });
  const d2 = detectSyncFailed(
    states.map((s) => ({ source: s.source, lastError: s.lastError, errorStreak: Number((s.cursor as { errorStreak?: number } | null)?.errorStreak ?? (s.lastError ? 1 : 0)) })),
  );
  if (d2) detected.push(d2);

  try {
    const waiting = await getQueue("telegram-send").getWaitingCount();
    const d3 = detectQueueBacklog(waiting);
    if (d3) detected.push(d3);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "lecture de la file impossible");
  }

  const blocked = await prisma.outboundMessage.count({ where: { status: "BLOCKED", queuedAt: { gte: new Date(now.getTime() - 3600_000) } } });
  const d4 = detectDmBlocked(blocked);
  if (d4) detected.push(d4);

  const health = await subIdHealth(now);
  const d5 = detectSubIdHealth(health.status, health.message);
  if (d5) detected.push(d5);

  // Erreurs répétées : compteur glissant par file alimenté par l'événement `failed` des workers (queues.ts).
  try {
    const d6 = detectJobFailures(await countRecentFailures(getRedis(), QUEUE_NAMES, now));
    if (d6) detected.push(d6);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "lecture des échecs de tâches impossible");
  }
  // Sauvegarde : dernier état écrit par `backups/run.ts` dans `Setting` `backup.last`.
  const backup = await prisma.setting.findUnique({ where: { key: "backup.last" } });
  const d7 = detectBackupFailed(parseBackupSnapshot(backup?.value), now);
  if (d7) detected.push(d7);

  // `worker_down` n'est jamais « détectée » ici (le worker qui évalue est vivant) : une alerte ouverte de ce type,
  // créée par le site pendant l'absence, est donc résolue automatiquement au passage suivant.
  return detected;
}

/**
 * Au redémarrage du worker : si l'ancien battement (copie persistante) date de plus de 3 minutes, on signale
 * l'absence. Une alerte `worker_down` ouverte (créée par le site pendant l'absence) est résolue ; sinon une alerte
 * déjà résolue est créée pour garder la trace, avec une seule notification Telegram (dédoublonnée sur 24 h).
 */
export async function reportWorkerRestart(redis: Redis, now = new Date()): Promise<{ downMinutes: number; resolved: boolean; created: boolean } | null> {
  const last = parseHeartbeat(await redis.get(HEARTBEAT_LAST_KEY));
  if (!last) return null;
  const d = detectWorkerDown(new Date(last.at), now);
  if (!d) return null;
  const downMinutes = Number(d.payload.downMinutes ?? 0);
  const backText = `✅ <b>Worker de retour</b>\nIl a été arrêté environ ${downMinutes} min (dernier signe de vie : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(last.at))}).`;

  const open = await prisma.alert.findFirst({ where: { kind: "worker_down", resolvedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (open) {
    await prisma.alert.update({ where: { id: open.id }, data: { resolvedAt: now, payload: toJsonValue(d.payload) } });
    await notifyAdmin(backText).catch((err: Error) => logger.warn({ err: err.message }, "notification Telegram impossible"));
    logger.warn({ downMinutes }, "worker de retour après une absence (alerte résolue)");
    return { downMinutes, resolved: true, created: false };
  }
  const recent = await prisma.alert.findMany({ where: { kind: "worker_down", createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) } }, select: { kind: true, createdAt: true } });
  if (!shouldCreate("worker_down", recent, now)) return { downMinutes, resolved: false, created: false };
  await prisma.alert.create({ data: { kind: d.kind, severity: d.severity, message: `${d.message} ; de retour maintenant.`, payload: toJsonValue(d.payload), notifiedAt: now, resolvedAt: now } });
  await notifyAdmin(backText).catch((err: Error) => logger.warn({ err: err.message }, "notification Telegram impossible"));
  logger.warn({ downMinutes }, "worker de retour après une absence");
  return { downMinutes, resolved: false, created: true };
}

/**
 * Passage d'alertes : crée les alertes manquantes (dédoublonnées), notifie l'admin une seule fois par alerte,
 * et résout automatiquement les alertes ouvertes dont la condition a disparu.
 */
export async function runAlerts(now = new Date()): Promise<{ created: number; resolved: number; notified: number }> {
  const detected = await detectAlerts(now);
  const open = await prisma.alert.findMany({ where: { resolvedAt: null }, select: { id: true, kind: true, createdAt: true, notifiedAt: true } });
  const detectedKinds = new Set<AlertKind>(detected.map((d) => d.kind));

  let created = 0;
  for (const d of detected) {
    if (!shouldCreate(d.kind, open, now)) continue;
    await prisma.alert.create({ data: { kind: d.kind, severity: d.severity, message: d.message, payload: toJsonValue(d.payload) } });
    created++;
  }

  // Résolution automatique : alertes ouvertes dont le type n'est plus détecté.
  const toResolve = open.filter((a) => !detectedKinds.has(a.kind as AlertKind));
  if (toResolve.length > 0) {
    await prisma.alert.updateMany({ where: { id: { in: toResolve.map((a) => a.id) } }, data: { resolvedAt: now } });
  }

  // Notification : une seule par alerte, jamais relancée.
  let notified = 0;
  const pending = await prisma.alert.findMany({ where: { notifiedAt: null, resolvedAt: null }, orderBy: { createdAt: "asc" }, take: 10 });
  for (const a of pending) {
    try {
      const ok = await notifyAdmin(formatAlert({ kind: a.kind as AlertKind, severity: a.severity, message: a.message, payload: {} }));
      // Marquée notifiée même sans destinataire configuré : on ne réessaie pas indéfiniment.
      await prisma.alert.update({ where: { id: a.id }, data: { notifiedAt: now } });
      if (ok) notified++;
    } catch (err) {
      logger.warn({ alertId: a.id, err: (err as Error).message }, "notification Telegram impossible");
    }
  }
  if (created || toResolve.length || notified) logger.info({ created, resolved: toResolve.length, notified }, "alertes traitées");
  return { created, resolved: toResolve.length, notified };
}
