import {
  ALERT_SETTINGS_KEY,
  campaignPlayerWhere,
  isAlertKindEnabled,
  parseAlertSwitches,
  scopeFromCampaign,
  type AlertSwitches,
} from "@linkaffipro/core";
import { prisma, toJsonValue, ourPlayers, type Prisma } from "@linkaffipro/db";
import { HEALTH_WINDOW_DAYS, evaluateSubIdHealth } from "@linkaffipro/linkaffi";
import { TELEGRAM_SESSION_ID } from "@linkaffipro/mtproto";
import {
  HEARTBEAT_LAST_KEY,
  QUEUE_NAMES,
  countRecentFailures,
  getQueue,
  getRedis,
  parseHeartbeat,
} from "@linkaffipro/queue";
import type { Redis } from "ioredis";
import { listGateLinksMissing, notifyAdmin } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { dayKey, parisMidnightUtc } from "../stats/aggregate";
import {
  alertToReopen,
  detectBackupFailed,
  detectBotWebhook,
  detectConnectorReconnect,
  detectCustomEmojiRefused,
  CUSTOM_EMOJI_REFUSED_WINDOW_MS,
  detectChannelLeak,
  detectDmBlocked,
  detectGateLinksMissing,
  detectJobFailures,
  detectLinkaffiEventsStuck,
  detectOfferLinkInactive,
  detectPostFailed,
  detectQueueBacklog,
  detectRegistrationsDrop,
  detectSpendNoConversion,
  detectSubIdHealth,
  detectSyncFailed,
  detectTelegramAccountReconnect,
  detectWorkerDown,
  DEDUP_WINDOW_MS,
  formatAlert,
  parseThresholds,
  PER_CHANNEL_KINDS,
  REOPEN_KINDS,
  shouldCreate,
  type AlertKind,
  type AlertThresholds,
  type BackupSnapshot,
  type Detected,
  type SpendSnapshot,
} from "./alert-rules";
import { syncBotBlockedRateAlerts } from "./blocked-rate";

const DAY_MS = 24 * 3600 * 1000;

/**
 * Réglages des alertes sur les chiffres (Réglages → Alertes), `Setting` `alerts.thresholds`, lu une fois par passage :
 * seuils et interrupteurs « Alerte activée » (absent = activée, règle commune `@linkaffipro/core`, alert-switches).
 */
export async function loadAlertSettings(): Promise<{
  thresholds: AlertThresholds;
  switches: AlertSwitches;
}> {
  const row = await prisma.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } });
  return { thresholds: parseThresholds(row?.value), switches: parseAlertSwitches(row?.value) };
}

/** Inscriptions des dernières 24 h et total des 7 jours précédents (`Player.registeredAt`). */
async function registrationsSnapshot(now: Date) {
  const h24 = new Date(now.getTime() - DAY_MS);
  const d8 = new Date(now.getTime() - 8 * DAY_MS);
  const ours = await ourPlayers();
  const [last24h, previous7dTotal] = await Promise.all([
    prisma.player.count({ where: { AND: [ours, { registeredAt: { gte: h24, lte: now } }] } }),
    prisma.player.count({ where: { AND: [ours, { registeredAt: { gte: d8, lt: h24 } }] } }),
  ]);
  return { last24h, previous7dTotal };
}

/**
 * Dépense par campagne sur les jours couvrant les dernières 24 h, et inscriptions rattachées sur la même fenêtre.
 * Rattachement identique à la fiche campagne (règle commune @linkaffipro/core, campaign-attribution) : clic sur un de
 * ses liens, membre arrivé par un de ses liens d'entrée, ou joueur sans clic de ses offres Link Affi.
 */
async function spendSnapshot(now: Date, t: AlertThresholds): Promise<SpendSnapshot[]> {
  const windowStart = parisMidnightUtc(dayKey(new Date(now.getTime() - DAY_MS)));
  const costs = await prisma.adCost.findMany({
    where: { date: { gte: new Date(`${dayKey(windowStart)}T00:00:00Z`) } },
    select: {
      spend: true,
      campaignId: true,
      adSet: { select: { campaignId: true } },
      ad: { select: { adSet: { select: { campaignId: true } } } },
    },
  });
  const spendByCampaign = new Map<string, number>();
  for (const c of costs) {
    const id = c.campaignId ?? c.adSet?.campaignId ?? c.ad?.adSet.campaignId;
    if (!id) continue;
    spendByCampaign.set(id, (spendByCampaign.get(id) ?? 0) + Number(c.spend));
  }
  const candidates = [...spendByCampaign.entries()]
    .filter(([, spend]) => spend > t.spendNoConversionEur)
    .map(([id]) => id);
  if (candidates.length === 0) return [];
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: candidates } },
    select: {
      id: true,
      name: true,
      channelIds: true,
      affiliateCampaignIds: true,
      inviteLinks: { select: { id: true } },
      trackingLinks: { select: { id: true } },
      adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
    },
  });
  const out: SpendSnapshot[] = [];
  for (const c of campaigns) {
    const scope = scopeFromCampaign(c);
    const registrations = await prisma.player.count({
      where: {
        AND: [
          campaignPlayerWhere(scope) as Prisma.PlayerWhereInput,
          { registeredAt: { gte: windowStart } },
        ],
      },
    });
    // Commissions de la campagne sur la même fenêtre (phase 10) : primes par joueur datées (CPA versées et annulées)
    // + part du revenu (revshare) de ses offres Link Affi. Le message d'alerte ajoute alors les gains.
    const [cpa, revshare] = await Promise.all([
      prisma.playerEvent.aggregate({
        _sum: { amount: true },
        where: {
          type: { in: ["CPA", "CPA_REVERSAL"] },
          occurredAt: { gte: windowStart },
          player: campaignPlayerWhere(scope) as Prisma.PlayerWhereInput,
        },
      }),
      scope.affiliateCampaignIds.length > 0
        ? prisma.affiliateDailyStat.aggregate({
            _sum: { revshareRevenue: true },
            where: {
              affiliateCampaignId: { in: scope.affiliateCampaignIds },
              date: { gte: new Date(`${dayKey(windowStart)}T00:00:00Z`) },
            },
          })
        : Promise.resolve({ _sum: { revshareRevenue: null } }),
    ]);
    const commissions =
      Math.round(
        (Number(cpa._sum.amount ?? 0) + Number(revshare._sum?.revshareRevenue ?? 0)) * 100,
      ) / 100;
    out.push({
      name: c.name,
      spend: Math.round((spendByCampaign.get(c.id) ?? 0) * 100) / 100,
      registrations,
      commissions,
    });
  }
  return out;
}

/** Membres actifs (adhésion APPROVED) et départs des dernières 24 h par canal actif. */
async function channelLeakSnapshot(now: Date) {
  const channels = await prisma.channel.findMany({
    where: { isActive: true },
    select: { id: true, title: true },
  });
  if (channels.length === 0) return [];
  const [active, left] = await Promise.all([
    prisma.membership.groupBy({
      by: ["channelId"],
      where: { status: "APPROVED" },
      _count: { _all: true },
    }),
    prisma.membership.groupBy({
      by: ["channelId"],
      where: { leftAt: { gte: new Date(now.getTime() - DAY_MS) } },
      _count: { _all: true },
    }),
  ]);
  const activeBy = new Map(active.map((r) => [r.channelId, r._count._all]));
  const leftBy = new Map(left.map((r) => [r.channelId, r._count._all]));
  return channels.map((c) => ({
    title: c.title,
    activeMembers: activeBy.get(c.id) ?? 0,
    left24h: leftBy.get(c.id) ?? 0,
  }));
}

/** Messages programmés passés en échec dans les dernières 24 h. */
async function failedPostsSnapshot(now: Date) {
  const posts = await prisma.post.findMany({
    where: { status: "FAILED", updatedAt: { gte: new Date(now.getTime() - DAY_MS) } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { code: true, lastError: true, channel: { select: { title: true } } },
  });
  return posts.map((p) => ({
    code: p.code,
    channelTitle: p.channel.title,
    lastError: p.lastError,
  }));
}

/** Clics humains des dernières 24 h sur des liens traqués désactivés. */
async function inactiveLinkClicksSnapshot(now: Date) {
  const groups = await prisma.click.groupBy({
    by: ["trackingLinkId"],
    where: {
      createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      isBot: false,
      trackingLink: { isActive: false },
    },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];
  const links = await prisma.trackingLink.findMany({
    where: { id: { in: groups.map((g) => g.trackingLinkId) } },
    select: { id: true, slug: true, label: true },
  });
  const byId = new Map(links.map((l) => [l.id, l]));
  return groups.map((g) => ({
    slug: byId.get(g.trackingLinkId)?.slug ?? g.trackingLinkId,
    label: byId.get(g.trackingLinkId)?.label ?? "lien",
    clicks: g._count._all,
  }));
}

/**
 * Santé du sub-ID sur 7 jours (mêmes requêtes que Réglages → Connecteurs, apps/web/lib/linkaffi/sub-id-health.ts) :
 * joueurs comptés à leur date d'inscription Link Affi (`registeredAt`), jamais à leur date d'import.
 */
async function subIdHealth(now: Date) {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 24 * 3600 * 1000);
  const [postback, timeMatch, offerClicks, clicked] = await Promise.all([
    prisma.player.count({ where: { subIdSource: "postback", registeredAt: { gte: since } } }),
    prisma.player.count({ where: { subIdSource: "time_match", registeredAt: { gte: since } } }),
    prisma.click.count({ where: { subId: { not: null }, createdAt: { gte: since } } }),
    prisma.trackingLink.findMany({
      where: {
        affiliateCampaignId: { not: null },
        clickRecords: { some: { subId: { not: null }, createdAt: { gte: since } } },
      },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const ids = clicked.map((t) => t.affiliateCampaignId).filter((x): x is string => x !== null);
  const missingWithClicks =
    ids.length === 0
      ? 0
      : await prisma.player.count({
          where: { subId: null, registeredAt: { gte: since }, affiliateCampaignId: { in: ids } },
        });
  return evaluateSubIdHealth({ postback, timeMatch, missingWithClicks, offerClicks });
}

function parseBackupSnapshot(value: unknown): BackupSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<BackupSnapshot>;
  if (typeof v.at !== "string" || typeof v.ok !== "boolean") return null;
  return {
    at: v.at,
    file: typeof v.file === "string" ? v.file : null,
    ok: v.ok,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
  };
}

/**
 * Messages partis avec les emojis normaux dans la dernière heure (phase 12) : événements `dm.custom_emoji_fallback`
 * (envoi des messages privés, réponses directes du bot) et `post.custom_emoji_fallback` (messages programmés publiés
 * par un bot, groupes).
 */
async function customEmojiFallbackSnapshot(now: Date) {
  const events = await prisma.event.findMany({
    where: {
      type: { in: ["dm.custom_emoji_fallback", "post.custom_emoji_fallback"] },
      occurredAt: { gte: new Date(now.getTime() - CUSTOM_EMOJI_REFUSED_WINDOW_MS), lte: now },
    },
    orderBy: { occurredAt: "desc" },
    take: 500,
    select: { botId: true, payload: true, type: true },
  });
  if (events.length === 0) return [];
  const botIds = [...new Set(events.map((e) => e.botId).filter((b): b is string => !!b))];
  const bots = botIds.length
    ? await prisma.bot.findMany({
        where: { id: { in: botIds } },
        select: { id: true, username: true },
      })
    : [];
  const names = new Map(bots.map((b) => [b.id, b.username]));
  return events.map((e) => ({
    botUsername: e.botId ? (names.get(e.botId) ?? null) : null,
    resent: (e.payload as { resent?: unknown } | null)?.resent !== false,
    kind: e.type === "post.custom_emoji_fallback" ? ("post" as const) : ("dm" as const),
  }));
}

/** Session du compte Telegram connecté et messages programmés qui en dépendent (phase 12). */
async function telegramAccountSnapshot(now: Date) {
  const session = await prisma.telegramUserSession.findUnique({
    where: { id: TELEGRAM_SESSION_ID },
    select: { status: true },
  });
  if (!session) return null;
  const pendingAccountPosts =
    session.status === "ERROR"
      ? await prisma.post.count({
          where: {
            publisher: "ACCOUNT",
            isTemplate: false,
            status: { in: ["SCHEDULED", "SENDING"] },
            scheduledAt: { gte: new Date(now.getTime() - DAY_MS) },
          },
        })
      : 0;
  return { status: session.status, pendingAccountPosts };
}

/** Événements à envoyer à Link Affi encore en attente (phase 13) : nombre, plus ancien, sa raison d'attente. */
async function linkaffiEventsSnapshot() {
  const oldest = await prisma.linkaffiEvent.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, lastError: true },
  });
  if (!oldest) return null;
  const pending = await prisma.linkaffiEvent.count({ where: { status: "PENDING" } });
  return { pending, oldestCreatedAt: oldest.createdAt, lastError: oldest.lastError };
}

/** Évalue toutes les règles et renvoie les alertes détectées. */
export async function detectAlerts(now = new Date()): Promise<Detected[]> {
  const detected: Detected[] = [];
  const bots = await prisma.bot.findMany({
    select: { username: true, isActive: true, lastWebhookAt: true, lastError: true },
  });
  const d1 = detectBotWebhook(bots, now);
  if (d1) detected.push(d1);

  const states = await prisma.syncState.findMany({
    select: { source: true, lastError: true, cursor: true },
  });
  const d2 = detectSyncFailed(
    states.map((s) => ({
      source: s.source,
      lastError: s.lastError,
      errorStreak: Number(
        (s.cursor as { errorStreak?: number } | null)?.errorStreak ?? (s.lastError ? 1 : 0),
      ),
    })),
  );
  if (d2) detected.push(d2);

  try {
    const waiting = await getQueue("telegram-send").getWaitingCount();
    const d3 = detectQueueBacklog(waiting);
    if (d3) detected.push(d3);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "lecture de la file impossible");
  }

  const blocked = await prisma.outboundMessage.count({
    where: { status: "BLOCKED", queuedAt: { gte: new Date(now.getTime() - 3600_000) } },
  });
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

  // Règles métier (seuils réglables) : chaque lecture est isolée pour qu'une erreur n'empêche pas les autres règles.
  const { thresholds, switches } = await loadAlertSettings();
  const business: Array<[string, () => Promise<Detected | null>]> = [
    [
      "registrations_drop",
      async () => detectRegistrationsDrop(await registrationsSnapshot(now), thresholds),
    ],
    [
      "spend_no_conversion",
      async () => detectSpendNoConversion(await spendSnapshot(now, thresholds), thresholds),
    ],
    ["channel_leak", async () => detectChannelLeak(await channelLeakSnapshot(now), thresholds)],
    ["post_failed", async () => detectPostFailed(await failedPostsSnapshot(now))],
    [
      "offer_link_inactive",
      async () => detectOfferLinkInactive(await inactiveLinkClicksSnapshot(now)),
    ],
    // Demandes en attente bloquées par un canal à rejoindre : lien impossible à créer, accueil parti sans ce lien
    // (ancienne version) ou canal obligatoire impossible à vérifier (`listGateLinksMissing`).
    [
      "gate_links_missing",
      async () =>
        detectGateLinksMissing(
          (await listGateLinksMissing({ limit: 500 })).map((r) => ({
            channelTitle: r.channelTitle,
            status: r.status,
            missing: r.missing.map((m) => ({
              title: m.title,
              suggestedBot: m.suggestedBot,
              ...(m.reason ? { reason: m.reason } : {}),
            })),
          })),
        ),
    ],
    // Emojis animés refusés ou retirés par Telegram dans les messages privés (phase 12).
    [
      "custom_emoji_refused",
      async () => detectCustomEmojiRefused(await customEmojiFallbackSnapshot(now)),
    ],
    // Événements des membres d'affiliés pas reçus par Link Affi depuis plus d'une heure (phase 13).
    [
      "linkaffi_events_stuck",
      async () => detectLinkaffiEventsStuck(await linkaffiEventsSnapshot(), now),
    ],
    // Compte Telegram connecté à reconnecter (vues, messages avec emojis animés : phase 12).
    [
      "telegram_account_reconnect",
      async () => detectTelegramAccountReconnect(await telegramAccountSnapshot(now)),
    ],
    [
      "connector_reconnect",
      async () =>
        detectConnectorReconnect(
          await prisma.adAccountConnection.findMany({
            where: { status: { in: ["ACTIVE", "NEEDS_RECONNECT"] } },
            select: {
              platform: true,
              name: true,
              status: true,
              tokenExpiresAt: true,
              lastError: true,
            },
          }),
          now,
        ),
    ],
  ];
  for (const [kind, run] of business) {
    // Alerte désactivée dans Réglages → Alertes : ni lecture ni détection. Une alerte encore ouverte de ce type n'est
    // donc plus « détectée » et se ferme dans `runAlerts` (résolution automatique), sans notification.
    if (!isAlertKindEnabled(switches, kind)) continue;
    try {
      const d = await run();
      if (d) detected.push(d);
    } catch (err) {
      logger.warn({ kind, err: (err as Error).message }, "règle d'alerte impossible à évaluer");
    }
  }

  // `worker_down` n'est jamais « détectée » ici (le worker qui évalue est vivant) : une alerte ouverte de ce type,
  // créée par le site pendant l'absence, est donc résolue automatiquement au passage suivant.
  return detected;
}

/**
 * Au redémarrage du worker : si l'ancien battement (copie persistante) date de plus de 3 minutes, on signale
 * l'absence. Une alerte `worker_down` ouverte (créée par le site pendant l'absence) est résolue ; sinon une alerte
 * déjà résolue est créée pour garder la trace, avec une seule notification Telegram (dédoublonnée sur 24 h).
 */
export async function reportWorkerRestart(
  redis: Redis,
  now = new Date(),
): Promise<{ downMinutes: number; resolved: boolean; created: boolean } | null> {
  const last = parseHeartbeat(await redis.get(HEARTBEAT_LAST_KEY));
  if (!last) return null;
  const d = detectWorkerDown(new Date(last.at), now);
  if (!d) return null;
  const downMinutes = Number(d.payload.downMinutes ?? 0);
  const backText = `✅ <b>Service d'arrière-plan de retour</b>\nIl a été arrêté environ ${downMinutes} min (dernier signe de vie : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(last.at))}).`;

  const open = await prisma.alert.findFirst({
    where: { kind: "worker_down", resolvedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) {
    await prisma.alert.update({
      where: { id: open.id },
      data: { resolvedAt: now, payload: toJsonValue(d.payload) },
    });
    await notifyAdmin(backText).catch((err: Error) =>
      logger.warn({ err: err.message }, "notification Telegram impossible"),
    );
    logger.warn({ downMinutes }, "worker de retour après une absence (alerte résolue)");
    return { downMinutes, resolved: true, created: false };
  }
  const recent = await prisma.alert.findMany({
    where: { kind: "worker_down", createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) } },
    select: { kind: true, createdAt: true },
  });
  if (!shouldCreate("worker_down", recent, now))
    return { downMinutes, resolved: false, created: false };
  await prisma.alert.create({
    data: {
      kind: d.kind,
      severity: d.severity,
      message: `${d.message} ; de retour maintenant.`,
      payload: toJsonValue(d.payload),
      notifiedAt: now,
      resolvedAt: now,
    },
  });
  await notifyAdmin(backText).catch((err: Error) =>
    logger.warn({ err: err.message }, "notification Telegram impossible"),
  );
  logger.warn({ downMinutes }, "worker de retour après une absence");
  return { downMinutes, resolved: false, created: true };
}

/**
 * Passage d'alertes : crée les alertes manquantes (dédoublonnées), notifie l'admin une seule fois par alerte,
 * et résout automatiquement les alertes ouvertes dont la condition a disparu.
 */
export async function runAlerts(
  now = new Date(),
): Promise<{ created: number; resolved: number; notified: number }> {
  const detected = await detectAlerts(now);
  const open = await prisma.alert.findMany({
    where: { resolvedAt: null },
    select: { id: true, kind: true, createdAt: true, notifiedAt: true },
  });
  const detectedKinds = new Set<AlertKind>(detected.map((d) => d.kind));

  let created = 0;
  for (const d of detected) {
    if (!shouldCreate(d.kind, open, now)) continue;
    // Condition qui va et vient (liens des canaux à rejoindre) : l'alerte des dernières 24 h est rouverte en silence,
    // jamais une nouvelle notification par demande (au plus une par 24 h).
    if (REOPEN_KINDS.has(d.kind)) {
      const recent = await prisma.alert.findMany({
        where: { kind: d.kind, createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) } },
        select: { id: true, kind: true, createdAt: true },
      });
      const reopenId = alertToReopen(d.kind, recent, now);
      if (reopenId) {
        await prisma.alert.update({
          where: { id: reopenId },
          data: {
            resolvedAt: null,
            severity: d.severity,
            message: d.message,
            payload: toJsonValue(d.payload),
          },
        });
        continue;
      }
    }
    await prisma.alert.create({
      data: {
        kind: d.kind,
        severity: d.severity,
        message: d.message,
        payload: toJsonValue(d.payload),
        createdAt: now,
      },
    });
    created++;
  }

  // Alerte « bot bloqué après l'accueil » (phase 14) : canal par canal, au plus une toutes les 6 heures par canal.
  try {
    created += (await syncBotBlockedRateAlerts(now)).created;
  } catch (err) {
    logger.warn(
      { kind: "bot_blocked_rate", err: (err as Error).message },
      "règle d'alerte impossible à évaluer",
    );
  }

  // Résolution automatique : alertes ouvertes dont le type n'est plus détecté, y compris celles d'un type désactivé
  // dans Réglages → Alertes (jamais évalué, donc jamais détecté) ; les alertes par canal se résolvent canal par canal,
  // ci-dessus.
  const toResolve = open.filter(
    (a) => !detectedKinds.has(a.kind as AlertKind) && !PER_CHANNEL_KINDS.has(a.kind as AlertKind),
  );
  if (toResolve.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: toResolve.map((a) => a.id) } },
      data: { resolvedAt: now },
    });
  }

  // Notification : une seule par alerte, jamais relancée.
  let notified = 0;
  const pending = await prisma.alert.findMany({
    where: { notifiedAt: null, resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  for (const a of pending) {
    try {
      const ok = await notifyAdmin(
        formatAlert({
          kind: a.kind as AlertKind,
          severity: a.severity,
          message: a.message,
          payload: {},
        }),
      );
      // Marquée notifiée même sans destinataire configuré : on ne réessaie pas indéfiniment.
      await prisma.alert.update({ where: { id: a.id }, data: { notifiedAt: now } });
      if (ok) notified++;
    } catch (err) {
      logger.warn(
        { alertId: a.id, err: (err as Error).message },
        "notification Telegram impossible",
      );
    }
  }
  if (created || toResolve.length || notified)
    logger.info({ created, resolved: toResolve.length, notified }, "alertes traitées");
  return { created, resolved: toResolve.length, notified };
}
