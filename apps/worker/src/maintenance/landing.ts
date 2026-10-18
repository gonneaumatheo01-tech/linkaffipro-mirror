/**
 * Pages d'atterrissage (phase 15), tâches de la file `maintenance` :
 *
 * - `landing-chats` (toutes les 5 minutes) : relecture `getChat` du titre (et de la petite photo si une page active
 *   l'affiche) des canaux qui ont une page active, chacun au plus toutes les 30 minutes, 40 canaux par passage, une
 *   pause de 250 ms entre deux, arrêt au premier 429 ; tout changement invalide le HTML gardé en mémoire par le site
 *   (D7). Règles : `packages/telegram/src/landing/chat.ts`.
 * - `landing-links` (toutes les 10 minutes) : nouvel essai des liens d'invitation manquants des sources actives des
 *   pages actives, chacune à son tour (pages essayées le moins récemment d'abord ; refus de Telegram gardé en français
 *   sur la source), y compris pour une source dont la pub a changé (nouveau lien créé pour la nouvelle pub : pub figée,
 *   D9) ; révocation des liens qui ne sont plus le lien d'une source active (source retirée, page supprimée, lien en
 *   trop ; créés il y a plus de 10 minutes ; ancien lien remplacé : 15 minutes après la création du lien qui l'a
 *   remplacé, `LANDING_REPLACED_GRACE_MS`) ; filet de sécurité sur la campagne des liens actuels
 *   (recalcul complet des statistiques journalières seulement si elle a dû être corrigée : un changement de pub ne
 *   change aucun chiffre passé). Règles : `packages/telegram/src/landing/links.ts`.
 * - Purge (`purge.ts`) : visites, clics et ouvertures (`LandingEvent`) plus anciens que la conservation des données
 *   personnelles (Réglages → Alertes, 24 mois par défaut), par lots.
 */
import { prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import {
  createPrismaLandingDeps,
  landingApiOf,
  refreshLandingChatsWithDb,
  retryMissingLandingLinksWithDb,
  revokeDetachedLandingLinksWithDb,
  syncLandingAdLinksWithDb,
  type LandingAdSyncReport,
  type LandingChatsReport,
  type PrismaLandingOptions,
  type RetryLandingLinksReport,
  type RevokeLandingLinksReport,
} from "@linkaffipro/telegram";
import { apiForBot } from "../approvals/telegram-actions";
import { logger } from "../logger";

/** Identifiant (préfixe) de la tâche `stats` de recalcul complet demandée quand la campagne d'un lien a été corrigée. */
export const LANDING_STATS_JOB_PREFIX = "stats-daily-full-landing";
const RECOMPUTE_DELAY_MS = 30_000;

type Deps = ReturnType<typeof createPrismaLandingDeps>;

/**
 * API d'un de nos bots par le cache d'API du worker (null si le bot est inconnu ou désactivé). Sans filtre sur le mode :
 * Telegram ne laisse révoquer un lien que par le bot qui l'a créé, même devenu assistant de conversation (phase 17) ;
 * la création de liens, elle, ne passe que par des bots normaux (`adminBots`).
 */
export async function workerLandingApi(botId: string) {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, tokenEncrypted: true },
  });
  return bot ? landingApiOf(apiForBot(bot)) : null;
}

/** Dépendances du worker : API des bots par le cache du worker (tests : `apiFor` simulé), journal du worker. */
export function workerLandingDeps(opts: Omit<PrismaLandingOptions, "warn"> = {}): Deps {
  return createPrismaLandingDeps({
    ...opts,
    apiFor: opts.apiFor ?? workerLandingApi,
    warn: (message, details) => logger.warn(details, message),
  });
}

/** Relecture des titres et photos des canaux qui ont une page active (voir l'en-tête). */
export async function runLandingChatRefresh(
  opts: { deps?: Deps; now?: Date } = {},
): Promise<LandingChatsReport> {
  const report = await refreshLandingChatsWithDb({
    deps: opts.deps ?? workerLandingDeps(),
    now: opts.now,
  });
  if (report.updated || report.failed || report.retryLater)
    logger.info(report, "pages d'atterrissage : titres des canaux relus");
  return report;
}

export type LandingLinkRepairReport = {
  retry: RetryLandingLinksReport;
  detached: RevokeLandingLinksReport;
  ads: LandingAdSyncReport;
  /** Recalcul complet des statistiques journalières demandé (campagne d'un lien actuel corrigée). */
  recomputeQueued: boolean;
};

/** Nouvel essai des liens manquants, révocation des liens détachés, campagne des liens actuels (voir l'en-tête). */
export async function runLandingLinkRepair(
  opts: { deps?: Deps; now?: Date } = {},
): Promise<LandingLinkRepairReport> {
  const deps = opts.deps ?? workerLandingDeps();
  const retry = await retryMissingLandingLinksWithDb({ deps });
  const detached = await revokeDetachedLandingLinksWithDb({ deps, now: opts.now });
  const ads = await syncLandingAdLinksWithDb();
  let recomputeQueued = false;
  if (ads.recomputeNeeded) {
    // Identifiant unique : une tâche déjà en cours a lu les liens avant la modification, celle-ci la suit.
    await enqueue(
      "stats",
      { type: "daily", full: true },
      {
        jobId: `${LANDING_STATS_JOB_PREFIX}-${Date.now()}`,
        delay: RECOMPUTE_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    recomputeQueued = true;
  }
  const report = { retry, detached, ads, recomputeQueued };
  if (
    retry.created ||
    retry.failed ||
    detached.revoked ||
    detached.disabledOnly ||
    detached.retryLater ||
    ads.recomputeNeeded
  )
    logger.info(report, "pages d'atterrissage : liens d'invitation repris");
  return report;
}

/** Lot de suppression des visites et clics (une requête courte par lot, sans bloquer la table). */
const PURGE_BATCH = 5000;

/**
 * Supprime les visites, clics et ouvertures des pages (`LandingEvent`) plus anciens que `cutoff` (conservation des
 * données personnelles : empreinte de l'adresse IP, agent utilisateur, identifiants de clic des pubs). Par lots.
 */
export async function deleteLandingEventsBefore(cutoff: Date): Promise<number> {
  let deleted = 0;
  for (;;) {
    const ids = await prisma.landingEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: PURGE_BATCH,
    });
    if (ids.length === 0) break;
    const r = await prisma.landingEvent.deleteMany({ where: { id: { in: ids.map((i) => i.id) } } });
    deleted += r.count;
    if (ids.length < PURGE_BATCH) break;
  }
  return deleted;
}
