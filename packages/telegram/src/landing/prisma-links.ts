/**
 * Accès base des liens d'invitation et de la relecture des canaux des pages d'atterrissage (phase 15), partagés par le
 * site (enregistrement d'une page), le worker (nouvel essai, liens orphelins, relecture des titres et photos, campagne
 * des liens actuels) et le script de la page de test. Règles dans `links.ts` et `chat.ts`.
 */
import { decrypt, landingLinkCampaignFixes } from "@linkaffipro/core";
import { ACTIVE_CHANNEL_BOT_WHERE, CHANNEL_BOT_WHERE, Prisma, prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { publishLandingInvalidate } from "@linkaffipro/queue";
import type { Api } from "grammy";
import { canInviteFromRights } from "../join-flow/prisma-gate-links";
import {
  refreshLandingChat,
  refreshLandingChats,
  type LandingChatChannel,
  type LandingChatClient,
  type LandingChatDeps,
  type LandingChatInfo,
  type LandingChatOutcome,
  type LandingChatsReport,
} from "./chat";
import {
  ensureLandingLinks,
  landingSourceLinkIsCurrent,
  revokeLandingLinks,
  type EnsureLandingLinksReport,
  type LandingInvalidate,
  type LandingLinkApi,
  type LandingLinkDeps,
  type LandingLinkToRevoke,
  type RevokeLandingLinksReport,
} from "./links";

/** API d'un de nos bots utilisée par les pages (grammY `Api` : liens d'invitation, `getChat`, `getFile`). */
export type LandingBotApi = LandingLinkApi & {
  getChat(chatId: number): Promise<LandingChatInfo>;
  getFile(fileId: string): Promise<{ file_path?: string }>;
};

/**
 * API d'un de nos bots dans le site et le webhook : l'instance grammY mise en cache (la même que celle des webhooks),
 * ce qui permet aux tests d'intercepter les appels. Import différé (pas de cycle avec factory).
 */
export async function webLandingApi(botId: string): Promise<LandingBotApi | null> {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true, ...CHANNEL_BOT_WHERE },
    // Mode et persona : l'instance en cache reste celle du webhook (handlers du bon mode, phase 17).
    select: {
      id: true,
      name: true,
      username: true,
      telegramBotId: true,
      vertical: true,
      tokenEncrypted: true,
      mode: true,
      personaId: true,
    },
  });
  if (!bot) return null;
  const [{ getOrCreateBot }, { prismaTelegramDeps }] = await Promise.all([
    import("../factory"),
    import("../prisma-deps"),
  ]);
  return landingApiOf(getOrCreateBot(bot, prismaTelegramDeps).api);
}

/** grammY `Api` vue comme `LandingBotApi` (les méthodes gardent leur instance). */
export function landingApiOf(api: Api): LandingBotApi {
  return {
    createChatInviteLink: (chatId, other) => api.createChatInviteLink(chatId, other),
    revokeChatInviteLink: (chatId, link) => api.revokeChatInviteLink(chatId, link),
    getChat: async (chatId) => (await api.getChat(chatId)) as unknown as LandingChatInfo,
    getFile: (fileId) => api.getFile(fileId),
  };
}

export type PrismaLandingOptions = {
  /** API d'un bot (site / webhook : `webLandingApi` ; worker : son propre cache d'API). */
  apiFor?: (botId: string) => Promise<LandingBotApi | null>;
  /** Invalidation du HTML en mémoire (par défaut `publishLandingInvalidate`, ne lève jamais). */
  publish?: (msg: LandingInvalidate) => Promise<unknown>;
  /** Téléchargement des fichiers Telegram (photo du canal) ; tests : simulé. */
  fetch?: typeof fetch;
  warn?: (message: string, details: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** Bots administrateurs du canal (bot qui agit pour le canal d'abord : principal s'il est administrateur). */
async function channelAdmins(channelId: string, primaryBotId: string | null) {
  // Phase 17 : jamais un bot assistant de conversation.
  const rows = await prisma.channelBotAdmin.findMany({
    where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    select: { botId: true, rights: true, bot: { select: { username: true, vertical: true } } },
  });
  const primary = primaryBotId ? rows.find((r) => r.botId === primaryBotId) : undefined;
  return primary ? [primary, ...rows.filter((r) => r !== primary)] : rows;
}

/** Téléchargement d'un fichier Telegram ; message générique en cas d'échec (l'adresse contient le jeton du bot). */
async function downloadTelegramFile(
  fetchImpl: typeof fetch,
  token: string,
  filePath: string,
  maxBytes: number,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Téléchargement de la photo impossible (réseau ou délai dépassé).");
  }
  if (!res.ok) throw new Error(`Téléchargement de la photo refusé par Telegram (${res.status}).`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Photo du canal trop lourde.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("Photo du canal trop lourde.");
  return bytes;
}

const chatChannelSelect = {
  id: true,
  title: true,
  username: true,
  telegramChatId: true,
  photoFileUniqueId: true,
  primaryBotId: true,
  landingPages: {
    where: { isActive: true, showPhoto: true },
    select: { id: true },
    take: 1,
  },
} as const;

async function toChatChannel(row: {
  id: string;
  title: string;
  username: string | null;
  telegramChatId: bigint;
  photoFileUniqueId: string | null;
  primaryBotId: string | null;
  landingPages: Array<{ id: string }>;
}): Promise<LandingChatChannel> {
  const admins = await channelAdmins(row.id, row.primaryBotId);
  return {
    id: row.id,
    title: row.title,
    username: row.username,
    telegramChatId: row.telegramChatId,
    photoFileUniqueId: row.photoFileUniqueId,
    wantsPhoto: row.landingPages.length > 0,
    bots: admins.map((a) => ({ botId: a.botId, username: a.bot.username })),
  };
}

/** Dépendances Prisma des liens (`links.ts`) et de la relecture des canaux (`chat.ts`). */
export function createPrismaLandingDeps(
  opts: PrismaLandingOptions = {},
): LandingLinkDeps & LandingChatDeps {
  const apiFor = opts.apiFor ?? webLandingApi;
  const publish = opts.publish ?? ((msg: LandingInvalidate) => publishLandingInvalidate(msg));
  const fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
  return {
    async loadPage(pageId) {
      const page = await prisma.landingPage.findUnique({
        where: { id: pageId },
        select: {
          id: true,
          name: true,
          language: true,
          channel: {
            select: {
              id: true,
              title: true,
              telegramChatId: true,
              vertical: true,
              primaryBotId: true,
            },
          },
          sources: {
            orderBy: [{ key: "asc" }, { id: "asc" }],
            select: {
              id: true,
              key: true,
              isActive: true,
              inviteLinkId: true,
              linkError: true,
              adId: true,
              inviteLink: { select: { isActive: true, landingAdId: true } },
            },
          },
        },
      });
      if (!page) return null;
      return {
        id: page.id,
        name: page.name,
        language: page.language,
        channel: page.channel,
        sources: page.sources.map((s) => ({
          id: s.id,
          key: s.key,
          isActive: s.isActive,
          inviteLinkId: s.inviteLinkId,
          linkActive: s.inviteLink?.isActive === true,
          linkError: s.linkError,
          adId: s.adId,
          linkAdId: s.inviteLink?.landingAdId ?? null,
        })),
      };
    },
    async adminBots(channelId) {
      // Ordre de détection (le bot qui agit pour le canal est retrouvé par `landingLinkCandidates`). Jamais un bot
      // assistant de conversation (phase 17).
      const rows = await prisma.channelBotAdmin.findMany({
        where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { botId: true, rights: true, bot: { select: { username: true, vertical: true } } },
      });
      return rows.map((r) => ({
        botId: r.botId,
        username: r.bot.username,
        vertical: r.bot.vertical,
        canInvite: canInviteFromRights(r.rights),
      }));
    },
    apiFor,
    async saveLink(input) {
      return prisma.$transaction(async (tx) => {
        // Verrou sur la source : deux passages simultanés (site et worker) ne posent jamais deux liens. La lecture
        // suivante voit le lien posé par l'autre passage s'il a gagné (nouvel instantané après l'attente du verrou),
        // et la pub reliée à la source à cet instant (figée sur le lien gagnant).
        await tx.$queryRaw`SELECT id FROM "LandingSource" WHERE id = ${input.sourceId} FOR UPDATE`;
        const source = await tx.landingSource.findUnique({
          where: { id: input.sourceId },
          select: {
            isActive: true,
            adId: true,
            ad: { select: { adSet: { select: { campaignId: true } } } },
            inviteLink: {
              select: { id: true, isActive: true, telegramInviteLink: true, landingAdId: true },
            },
          },
        });
        const current = source?.inviteLink ?? null;
        const won =
          !!source &&
          source.isActive &&
          !landingSourceLinkIsCurrent({
            inviteLinkId: current?.id ?? null,
            linkActive: current?.isActive === true,
            adId: source.adId,
            linkAdId: current?.landingAdId ?? null,
          });
        const link = await tx.inviteLink.create({
          data: {
            channelId: input.channelId,
            botId: input.botId,
            telegramInviteLink: input.url,
            name: input.name,
            kind: "LANDING",
            createsJoinRequest: true,
            landingPageId: input.pageId,
            // Lien en trop d'un passage concurrent : sans source, sans pub ni campagne (jamais affiché, révoqué tout de
            // suite) ; il ne compte pour rien et n'entre pas dans l'historique des liens de la source.
            landingSource: won ? input.sourceKey : null,
            landingAdId: won ? (source?.adId ?? null) : null,
            campaignId: won ? (source?.ad?.adSet.campaignId ?? null) : null,
            language: input.language,
            createdById: input.userId,
          },
          select: { id: true, telegramInviteLink: true },
        });
        if (won) {
          await tx.landingSource.update({
            where: { id: input.sourceId },
            data: { inviteLinkId: link.id, linkError: null },
          });
          return {
            won: true,
            inviteLinkId: link.id,
            url: link.telegramInviteLink,
            ownInviteLinkId: link.id,
            // Ancien lien encore actif, créé pour une autre pub : détaché, révoqué après le délai des liens remplacés
            // (il garde sa pub).
            replacedInviteLinkId: current?.isActive ? current.id : null,
          };
        }
        // Bon lien déjà posé par un autre passage (ou source retirée entre-temps) : le nôtre reste sans source.
        return {
          won: false,
          inviteLinkId: current?.id ?? link.id,
          url: current?.telegramInviteLink ?? link.telegramInviteLink,
          ownInviteLinkId: link.id,
        };
      });
    },
    async setLinkError(sourceId, error) {
      await prisma.landingSource
        .update({ where: { id: sourceId }, data: { linkError: error } })
        .catch(() => undefined);
    },
    async markTried(sourceIds, at) {
      if (sourceIds.length === 0) return;
      await prisma.landingSource.updateMany({
        where: { id: { in: [...sourceIds] } },
        data: { linkTriedAt: at },
      });
    },
    async markLinkInactive(inviteLinkId) {
      await prisma.inviteLink
        .update({ where: { id: inviteLinkId }, data: { isActive: false } })
        .catch(() => undefined);
    },
    publishInvalidate: publish,
    async recordEvent(input) {
      await recordEvent({
        type: input.type,
        channelId: input.channelId ?? null,
        botId: input.botId ?? null,
        payload: toJsonValue(input.payload ?? {}),
      });
    },
    async listChannels({ checkedBefore, limit }) {
      const rows = await prisma.channel.findMany({
        where: {
          landingPages: { some: { isActive: true } },
          OR: [{ chatCheckedAt: null }, { chatCheckedAt: { lt: checkedBefore } }],
        },
        orderBy: [{ chatCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        take: Math.max(1, Math.min(limit, 500)),
        select: chatChannelSelect,
      });
      return Promise.all(rows.map(toChatChannel));
    },
    async clientFor(botId): Promise<LandingChatClient | null> {
      const bot = await prisma.bot.findFirst({
        where: { id: botId, isActive: true, ...CHANNEL_BOT_WHERE },
        select: { tokenEncrypted: true },
      });
      if (!bot) return null;
      const api = await apiFor(botId);
      if (!api) return null;
      return {
        getChat: (chatId) => api.getChat(chatId),
        getFile: (fileId) => api.getFile(fileId),
        download: (filePath, maxBytes) =>
          downloadTelegramFile(fetchImpl, decrypt(bot.tokenEncrypted), filePath, maxBytes),
      };
    },
    async saveChat(channelId, data) {
      await prisma.channel.update({
        where: { id: channelId },
        data: {
          chatCheckedAt: data.checkedAt,
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.username !== undefined ? { username: data.username } : {}),
          ...(data.photo === null
            ? { photoSmall: null, photoFileUniqueId: null }
            : data.photo
              ? {
                  photoSmall: new Uint8Array(data.photo.bytes),
                  photoFileUniqueId: data.photo.uniqueId,
                }
              : {}),
        },
      });
    },
    ...(opts.warn ? { warn: opts.warn } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };
}

// ─── Fonctions prêtes à l'emploi (site, worker, script) ─────────────────────────────────────────────────────────

type WithDeps = { deps?: LandingLinkDeps & LandingChatDeps };

/** Crée les liens manquants des sources actives d'une page (voir `ensureLandingLinks`). */
export async function ensureLandingLinksWithDb(
  pageId: string,
  opts: WithDeps & { userId?: string | null } = {},
): Promise<EnsureLandingLinksReport> {
  return ensureLandingLinks(opts.deps ?? createPrismaLandingDeps(), pageId, {
    userId: opts.userId ?? null,
  });
}

const revokeSelect = {
  id: true,
  channelId: true,
  telegramInviteLink: true,
  botId: true,
  landingPageId: true,
  landingSource: true,
  bot: { select: { username: true, isActive: true } },
  channel: { select: { telegramChatId: true } },
} as const;

function toRevoke(l: {
  id: string;
  channelId: string;
  telegramInviteLink: string;
  botId: string;
  landingPageId: string | null;
  landingSource: string | null;
  bot: { username: string; isActive: boolean };
  channel: { telegramChatId: bigint };
}): LandingLinkToRevoke {
  return {
    id: l.id,
    channelId: l.channelId,
    telegramChatId: l.channel.telegramChatId,
    telegramInviteLink: l.telegramInviteLink,
    botId: l.botId,
    botUsername: l.bot.username,
    botActive: l.bot.isActive,
    landingPageId: l.landingPageId,
    landingSource: l.landingSource,
  };
}

/**
 * Révoque chez Telegram les liens actifs d'une page (page supprimée : à appeler AVANT de supprimer la page, qui détache
 * ses liens), ou seulement ceux de certaines sources (`sourceIds` : sources retirées). Publie l'invalidation de la page.
 */
export async function revokeLandingPageLinksWithDb(
  pageId: string,
  opts: WithDeps & { sourceIds?: string[]; userId?: string | null } = {},
): Promise<RevokeLandingLinksReport> {
  const deps = opts.deps ?? createPrismaLandingDeps();
  const keys = opts.sourceIds
    ? (
        await prisma.landingSource.findMany({
          where: { id: { in: opts.sourceIds }, landingPageId: pageId },
          select: { key: true },
        })
      ).map((s) => s.key)
    : null;
  if (keys && keys.length === 0) return { revoked: 0, disabledOnly: 0, retryLater: 0 };
  const links = await prisma.inviteLink.findMany({
    where: {
      kind: "LANDING",
      isActive: true,
      landingPageId: pageId,
      ...(keys ? { landingSource: { in: keys } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: revokeSelect,
  });
  const report = await revokeLandingLinks(deps, links.map(toRevoke), { userId: opts.userId });
  if (report.revoked + report.disabledOnly > 0) await deps.publishInvalidate({ pageId });
  return report;
}

/** Délai de grâce avant de révoquer un lien sans source (un lien tout juste créé n'est jamais concerné). */
export const LANDING_ORPHAN_GRACE_MS = 10 * 60_000;

/**
 * Délai pendant lequel un lien REMPLACÉ (la pub de sa source a changé : un nouveau lien a pris sa place sur le bouton)
 * reste valable, compté depuis la création du lien qui l'a remplacé : les visiteurs qui ont encore la page à l'écran,
 * qui la reprennent du cache du navigateur (`max-age=60`) ou par le retour arrière gardent un bouton qui fonctionne.
 * Ses demandes pendant ce délai comptent pour sa pub (pub figée, D9). Révoqué ensuite par le worker (passage toutes
 * les 10 minutes : entre 15 et 25 minutes après le remplacement). Source retirée, page supprimée : aucun délai.
 */
export const LANDING_REPLACED_GRACE_MS = 15 * 60_000;

/**
 * Anciens liens encore actifs d'une source active dont le lien actuel a été créé depuis `since` (même page, même clé,
 * détachés : remplacés parce que la pub de la source a changé), gardés pendant le délai des liens remplacés. Sélection
 * positive puis exclusion par identifiant : un `NOT (page = … AND source = …)` écarterait à tort les liens sans page
 * (page supprimée) ou sans source (lien en trop), la comparaison avec NULL n'étant jamais vraie. Un lien en trop et les
 * liens d'une source retirée ne sont jamais gardés. Peu de lignes : seulement les sources dont le lien est tout récent.
 */
async function recentlyReplacedLandingLinkIds(opts: {
  pageId?: string;
  since: Date;
}): Promise<string[]> {
  const recent = await prisma.landingSource.findMany({
    where: {
      isActive: true,
      ...(opts.pageId ? { landingPageId: opts.pageId } : {}),
      inviteLink: { is: { createdAt: { gte: opts.since } } },
    },
    select: { landingPageId: true, key: true },
  });
  if (recent.length === 0) return [];
  const rows = await prisma.inviteLink.findMany({
    where: {
      kind: "LANDING",
      isActive: true,
      landingSourceOf: { is: null },
      OR: recent.map((s) => ({ landingPageId: s.landingPageId, landingSource: s.key })),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Révoque les liens LANDING actifs qui ne sont plus le lien actuel d'une source active : source retirée ou
 * désactivée, page supprimée (lien détaché), lien en trop d'un passage concurrent, ancien lien remplacé (pub de la
 * source changée) une fois le délai `LANDING_REPLACED_GRACE_MS` passé. `pageId` : seulement cette page (site, juste
 * après l'enregistrement, sans délai pour les liens en trop) ; sinon toutes (worker, liens créés il y a plus de
 * 10 minutes). Une page en pause (`isActive` faux) garde ses liens.
 */
export async function revokeDetachedLandingLinksWithDb(
  opts: WithDeps & {
    pageId?: string;
    now?: Date;
    graceMs?: number;
    /** Délai des liens remplacés (par défaut `LANDING_REPLACED_GRACE_MS` ; 0 : aucun). */
    replacedGraceMs?: number;
    limit?: number;
    userId?: string | null;
  } = {},
): Promise<RevokeLandingLinksReport> {
  const deps = opts.deps ?? createPrismaLandingDeps();
  const now = opts.now ?? new Date();
  const grace = opts.graceMs ?? (opts.pageId ? 0 : LANDING_ORPHAN_GRACE_MS);
  const replacedGrace = opts.replacedGraceMs ?? LANDING_REPLACED_GRACE_MS;
  const kept =
    replacedGrace > 0
      ? await recentlyReplacedLandingLinkIds({
          pageId: opts.pageId,
          since: new Date(now.getTime() - replacedGrace),
        })
      : [];
  const links = await prisma.inviteLink.findMany({
    where: {
      kind: "LANDING",
      isActive: true,
      ...(opts.pageId ? { landingPageId: opts.pageId } : {}),
      ...(grace > 0 ? { createdAt: { lt: new Date(now.getTime() - grace) } } : {}),
      OR: [{ landingSourceOf: { is: null } }, { landingSourceOf: { is: { isActive: false } } }],
      ...(kept.length ? { id: { notIn: kept } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(opts.limit ?? 100, 1000)),
    select: revokeSelect,
  });
  const report = await revokeLandingLinks(deps, links.map(toRevoke), { userId: opts.userId });
  const pages = new Set(links.map((l) => l.landingPageId).filter((id): id is string => !!id));
  if (report.revoked + report.disabledOnly > 0)
    for (const pageId of pages) await deps.publishInvalidate({ pageId });
  return report;
}

/**
 * Pages actives dont une source active attend un lien : aucun lien, lien révoqué, ou lien créé pour une autre pub que
 * celle reliée aujourd'hui à la source (même règle que `landingSourceLinkIsCurrent`). Au plus `limit`, chacune à son
 * tour : d'abord les pages dont la source en attente a été essayée le moins récemment (`linkTriedAt`, jamais essayée
 * d'abord), pour qu'une page récente ne reste jamais derrière des pages qui échouent toujours.
 */
export async function pagesMissingLandingLinks(limit = 20): Promise<string[]> {
  const take = Math.max(1, Math.min(limit, 200));
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id"
    FROM "LandingPage" p
    JOIN "LandingSource" s ON s."landingPageId" = p."id" AND s."isActive"
    LEFT JOIN "InviteLink" l ON l."id" = s."inviteLinkId"
    WHERE p."isActive"
      AND (l."id" IS NULL OR NOT l."isActive" OR l."landingAdId" IS DISTINCT FROM s."adId")
    GROUP BY p."id"
    ORDER BY MIN(s."linkTriedAt") ASC NULLS FIRST, p."id" ASC
    LIMIT ${take}`);
  return rows.map((r) => r.id);
}

export type RetryLandingLinksReport = {
  pages: number;
  created: number;
  failed: number;
  /** Telegram injoignable : le passage s'est arrêté. */
  stopped: boolean;
};

/** Nouvel essai des liens manquants (worker, toutes les 10 minutes) ; arrêt à la première panne de Telegram. */
export async function retryMissingLandingLinksWithDb(
  opts: WithDeps & { limit?: number } = {},
): Promise<RetryLandingLinksReport> {
  const deps = opts.deps ?? createPrismaLandingDeps();
  const report: RetryLandingLinksReport = { pages: 0, created: 0, failed: 0, stopped: false };
  for (const pageId of await pagesMissingLandingLinks(opts.limit)) {
    const r = await ensureLandingLinks(deps, pageId);
    report.pages++;
    report.created += r.created;
    report.failed += r.failed;
    if (r.sources.some((s) => s.status === "error" && s.transient)) {
      report.stopped = true;
      break;
    }
  }
  return report;
}

export type LandingAdSyncReport = {
  /** Liens actuels dont la campagne (`InviteLink.campaignId`) a été corrigée. */
  linksFixed: number;
  /** Une campagne a été corrigée : recalcul complet des statistiques journalières à demander. */
  recomputeNeeded: boolean;
};

/**
 * Pub figée (D9), filet de sécurité : le lien ACTUEL de chaque source, créé pour une pub, porte la campagne de cette pub
 * (`InviteLink.campaignId`, posée à la création ; corrigée ici si elle ne correspond plus). Jamais un ancien lien, jamais
 * un lien sans pub (pub supprimée : le lien garde sa campagne). Un changement de pub d'une source ne passe pas par ici :
 * il crée un nouveau lien (`ensureLandingLinks`), l'historique ne change pas et aucun recalcul n'est nécessaire.
 * `pageId` : seulement cette page (site) ; sinon toutes (worker). L'appelant programme le recalcul si besoin (site :
 * `refreshCampaignStats` ; worker : tâche `stats` `daily` complète).
 */
export async function syncLandingAdLinksWithDb(
  opts: { pageId?: string } = {},
): Promise<LandingAdSyncReport> {
  const sources = await prisma.landingSource.findMany({
    where: {
      ...(opts.pageId ? { landingPageId: opts.pageId } : {}),
      inviteLink: { is: { kind: "LANDING", landingAdId: { not: null } } },
    },
    select: {
      inviteLink: {
        select: {
          id: true,
          landingAdId: true,
          campaignId: true,
          landingAd: { select: { adSet: { select: { campaignId: true } } } },
        },
      },
    },
  });
  const fixes = landingLinkCampaignFixes(
    sources.flatMap((s) =>
      s.inviteLink
        ? [
            {
              id: s.inviteLink.id,
              landingAdId: s.inviteLink.landingAdId,
              campaignId: s.inviteLink.campaignId,
              adCampaignId: s.inviteLink.landingAd?.adSet.campaignId ?? null,
            },
          ]
        : [],
    ),
  );
  for (const f of fixes)
    await prisma.inviteLink.update({ where: { id: f.id }, data: { campaignId: f.campaignId } });
  return { linksFixed: fixes.length, recomputeNeeded: fixes.length > 0 };
}

/**
 * Relit tout de suite un canal (titre, nom public, petite photo si une page active l'affiche ou si `wantsPhoto`) :
 * après l'enregistrement d'une page (site) ou par le script de la page de test. null si le canal n'existe pas.
 */
export async function refreshLandingChannelWithDb(
  channelId: string,
  opts: WithDeps & { wantsPhoto?: boolean; now?: Date } = {},
): Promise<LandingChatOutcome | null> {
  const deps = opts.deps ?? createPrismaLandingDeps();
  const row = await prisma.channel.findUnique({
    where: { id: channelId },
    select: chatChannelSelect,
  });
  if (!row) return null;
  const channel = await toChatChannel(row);
  return refreshLandingChat(
    deps,
    { ...channel, wantsPhoto: channel.wantsPhoto || opts.wantsPhoto === true },
    opts.now ?? new Date(),
  );
}

/** Passage périodique de relecture des canaux qui ont une page active (worker, voir `refreshLandingChats`). */
export async function refreshLandingChatsWithDb(
  opts: WithDeps & { now?: Date; limit?: number } = {},
): Promise<LandingChatsReport> {
  return refreshLandingChats(opts.deps ?? createPrismaLandingDeps(), {
    now: opts.now,
    limit: opts.limit,
  });
}
