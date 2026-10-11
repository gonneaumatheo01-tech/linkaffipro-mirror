/**
 * Requêtes de lecture de l'accueil. Elles reprennent les règles existantes, sans en créer :
 * - « nos » joueurs seulement (`ourPlayers()`), dates de Link Affi, revenu net = somme des événements NGR datés ;
 * - entrées dans un canal = adhésions avec `joinedAt` (indicateur « Entrées » des statistiques) ;
 * - dépense pub = `AdCost` du jour (celle d'hier ramenée à la même heure) ; campagnes : `listCampaigns` (mêmes chiffres
 *   que la page Campagnes) ;
 * - état : battement du service d'arrière-plan, bots, synchro Link Affi, alertes ouvertes (comme État du système, sans
 *   appel à Telegram pour rester rapide).
 * Chaque bloc de la page tolère une panne (voir app/(admin)/page.tsx).
 */
import { ourPlayers, prisma, type Prisma } from "@linkaffipro/db";
import { isWorkerDown, readHeartbeat } from "@linkaffipro/queue";
import { listGateLinksMissing } from "@linkaffipro/telegram";
import { loadAiConfig } from "@/lib/ai/config";
import { isImportedShell } from "@/lib/campaigns/ad-link";
import { listCampaigns, type CampaignList } from "@/lib/campaigns/queries";
import type { CurrentUser } from "@/lib/session";
import { resolvePeriod, type Period } from "@/lib/periods";
import { withRedis } from "@/lib/redis";
import type { ChecklistInput } from "@/lib/onboarding/checklist";
import {
  dayWindows,
  yesterdaySoFar,
  type DayTotals,
  type DayWindows,
  type TimeWindow,
} from "./figures";
import { AB_LOOKBACK_MS, abTestsToConclude } from "./ab";
import { activeCampaigns, type ActiveCampaign } from "./lists";
import type { StatusInput } from "./status";
import { groupGateLinksMissing, type TodoInput } from "./todo";

const DAY = 24 * 3_600_000;

/** Messages de canal (les conteneurs d'envois groupés `broadcast:<id>` n'en sont pas). */
const CHANNEL_POST: Prisma.PostWhereInput = {
  isTemplate: false,
  OR: [{ templateName: null }, { NOT: { templateName: { startsWith: "broadcast:" } } }],
};

// ---------- Chiffres du jour ----------

/**
 * Totaux d'une fenêtre (aujourd'hui jusqu'à maintenant, ou hier à la même heure) ; dépense pub du jour entier (une
 * ligne `AdCost` n'a pas d'heure : `loadHomeFigures` ramène celle d'hier à la même heure).
 */
export async function loadDayTotals(
  window: TimeWindow,
  dayKey: string,
  ours: Prisma.PlayerWhereInput,
): Promise<DayTotals> {
  const within = { gte: window.start, lt: window.end };
  const [members, ftds, deposits, ngr, spend] = await Promise.all([
    prisma.membership.count({ where: { joinedAt: within } }),
    prisma.player.count({ where: { AND: [ours, { ftdAt: within }] } }),
    prisma.playerEvent.aggregate({
      _sum: { amount: true },
      where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] }, occurredAt: within, player: ours },
    }),
    prisma.playerEvent.aggregate({
      _sum: { amount: true },
      where: { type: "NGR", occurredAt: within, player: ours },
    }),
    prisma.adCost.aggregate({
      _sum: { spend: true },
      where: { date: new Date(`${dayKey}T00:00:00.000Z`) },
    }),
  ]);
  return {
    members,
    ftds,
    deposits: Number(deposits._sum.amount ?? 0),
    ngr: Number(ngr._sum.amount ?? 0),
    spend: Number(spend._sum.spend ?? 0),
  };
}

/**
 * Chiffres d'aujourd'hui et d'hier (heure de Paris), pour les trois cartes de l'accueil. Hier : jusqu'à la même heure,
 * dépense pub comprise (dépense de la journée entière ramenée à la part écoulée, `yesterdaySoFar`).
 */
export async function loadHomeFigures(
  now = new Date(),
): Promise<{ windows: DayWindows; today: DayTotals; yesterday: DayTotals }> {
  const windows = dayWindows(now);
  const ours = (await ourPlayers()) as Prisma.PlayerWhereInput;
  const [today, yesterday] = await Promise.all([
    loadDayTotals(windows.today, windows.todayKey, ours),
    loadDayTotals(windows.yesterday, windows.yesterdayKey, ours),
  ]);
  return { windows, today, yesterday: yesterdaySoFar(yesterday, windows.yesterdayShare) };
}

// ---------- Barre d'état ----------

/** Le service d'arrière-plan est-il muet (battement absent depuis 3 min, ou Redis injoignable) ? */
async function workerDownFromRedis(now: Date): Promise<boolean> {
  try {
    const { heartbeat } = await withRedis((c) => readHeartbeat(c), 1500);
    return isWorkerDown(heartbeat, now);
  } catch {
    return true;
  }
}

export async function loadStatusInput(
  now = new Date(),
  workerDown: (now: Date) => Promise<boolean> = workerDownFromRedis,
): Promise<StatusInput> {
  const [down, bots, sync, openAlerts] = await Promise.all([
    workerDown(now),
    prisma.bot.findMany({ select: { username: true, isActive: true, lastError: true } }),
    prisma.syncState.findMany({ select: { lastSuccessAt: true, lastError: true } }),
    prisma.alert.findMany({ where: { resolvedAt: null }, select: { kind: true }, take: 200 }),
  ]);
  return { workerDown: down, bots, sync, openAlerts };
}

// ---------- À faire ----------

/** Une demande « à la main » plus jeune que ce délai est peut-être encore en cours de traitement automatique. */
const REQUEST_GRACE_MS = 2 * 60_000;

/**
 * Données du bloc « À faire ». `telegramInChecklist` vaut `false` : la page le fixe d'après la liste « À faire pour
 * démarrer » (chargée en parallèle) pour ne pas proposer deux fois de relier Telegram.
 */
export async function loadTodoInput(
  user: Pick<CurrentUser, "role" | "telegramUserId">,
  now = new Date(),
): Promise<TodoInput> {
  const isAdmin = user.role === "ADMIN";
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [requests, failedPosts, adReconnect, session, noRule, abPosts, aiKeyMissing, gateRows] =
    await Promise.all([
      prisma.membership.groupBy({
        by: ["channelId"],
        where: {
          channel: { isActive: true },
          OR: [
            {
              status: "REQUESTED",
              requestedAt: { lt: new Date(now.getTime() - REQUEST_GRACE_MS) },
            },
            { status: "FAILED", requestedAt: { gte: weekAgo } },
          ],
        },
        _count: { _all: true },
      }),
      prisma.post.count({
        where: { AND: [CHANNEL_POST, { status: "FAILED", updatedAt: { gte: weekAgo } }] },
      }),
      prisma.adAccountConnection.findMany({
        where: { status: "NEEDS_RECONNECT" },
        orderBy: [{ platform: "asc" }, { name: "asc" }],
        select: { platform: true, name: true },
      }),
      prisma.telegramUserSession.findUnique({ where: { id: "main" }, select: { status: true } }),
      prisma.channel.findMany({
        where: {
          isActive: true,
          isMediaLibrary: false,
          approvalRules: { none: { isDefault: true, isActive: true } },
        },
        orderBy: { title: "asc" },
        select: { id: true, title: true },
      }),
      prisma.post.findMany({
        where: {
          AND: [
            CHANNEL_POST,
            { abGroupId: { not: null }, sentAt: { gte: new Date(now.getTime() - AB_LOOKBACK_MS) } },
          ],
        },
        select: {
          abGroupId: true,
          abVariant: true,
          status: true,
          sentAt: true,
          channel: { select: { title: true } },
          stats: {
            select: { views: true, clicks: true, uniqueClickers: true, reactionsTotal: true },
          },
        },
      }),
      isAdmin
        ? loadAiConfig()
            .then((c) => !c.apiKeyEncrypted)
            .catch(() => false)
        : Promise.resolve(false),
      // Demandes dont l'accueil est parti sans tous les liens des canaux à rejoindre (règle commune avec l'alerte).
      listGateLinksMissing({ limit: 1000 }),
    ]);

  const titles = new Map(
    (
      await prisma.channel.findMany({
        where: { id: { in: requests.map((r) => r.channelId) } },
        select: { id: true, title: true },
      })
    ).map((c) => [c.id, c.title]),
  );

  return {
    isAdmin,
    pendingRequests: requests.map((r) => ({
      channelId: r.channelId,
      channelTitle: titles.get(r.channelId) ?? "canal",
      count: r._count._all,
    })),
    failedPosts,
    adReconnect,
    telegramSessionError: session?.status === "ERROR",
    channelsWithoutRule: noRule,
    abTests: abTestsToConclude(abPosts, now),
    telegramLinked: user.telegramUserId !== null,
    telegramInChecklist: false,
    aiKeyMissing,
    gateLinksMissing: groupGateLinksMissing(gateRows),
  };
}

// ---------- Prochains messages ----------

export type UpcomingPost = {
  id: string;
  scheduledAt: Date;
  text: string;
  mediaCount: number;
  channelId: string;
  channelTitle: string;
  /** Univers du canal, à défaut celui du bot qui publie. */
  vertical: string | null;
};

export async function loadUpcomingPosts(now = new Date(), take = 3): Promise<UpcomingPost[]> {
  const rows = await prisma.post.findMany({
    where: { AND: [CHANNEL_POST, { status: "SCHEDULED", scheduledAt: { gte: now } }] },
    orderBy: { scheduledAt: "asc" },
    take,
    select: {
      id: true,
      scheduledAt: true,
      text: true,
      mediaAssetIds: true,
      channel: { select: { id: true, title: true, vertical: true } },
      bot: { select: { vertical: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    scheduledAt: p.scheduledAt!,
    text: p.text,
    mediaCount: Array.isArray(p.mediaAssetIds) ? p.mediaAssetIds.length : 0,
    channelId: p.channel.id,
    channelTitle: p.channel.title,
    vertical: p.channel.vertical ?? p.bot.vertical ?? null,
  }));
}

// ---------- Campagnes actives ----------

/** Période des campagnes de l'accueil : les 7 derniers jours (Paris), comme la page Campagnes par défaut. */
export function homeCampaignPeriod(now = new Date()): Period {
  return resolvePeriod({ range: "7d" }, now);
}

/** Campagnes actives sur 7 jours ; `load` : `listCampaigns` (cache 60 s partagé avec la page Campagnes). */
export async function loadActiveCampaigns(
  now = new Date(),
  load: (period: Period, compare: boolean) => Promise<CampaignList> = listCampaigns,
): Promise<{ rows: ActiveCampaign[]; total: number }> {
  const list = await load(homeCampaignPeriod(now), false);
  return activeCampaigns(list.rows);
}

// ---------- À faire pour démarrer ----------

export async function loadChecklistInput(
  user: Pick<CurrentUser, "role" | "telegramUserId">,
): Promise<ChecklistInput> {
  const isAdmin = user.role === "ADMIN";
  const [campaigns, post, invitations, users] = await Promise.all([
    prisma.campaign.findMany({
      select: {
        externalCampaignId: true,
        adExternalIds: true,
        affiliateCampaignIds: true,
        channelIds: true,
      },
    }),
    prisma.post.findFirst({
      where: { AND: [CHANNEL_POST, { status: { in: ["SCHEDULED", "SENDING", "SENT"] } }] },
      select: { id: true },
    }),
    isAdmin ? prisma.invitation.count() : Promise.resolve(0),
    isAdmin ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(0),
  ]);
  return {
    isAdmin,
    telegramLinked: user.telegramUserId !== null,
    hasCampaign: campaigns.some((c) => !isImportedShell(c)),
    hasScheduledPost: post !== null,
    teamInvited: invitations > 0 || users > 1,
  };
}
