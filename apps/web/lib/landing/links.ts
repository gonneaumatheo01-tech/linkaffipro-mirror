/**
 * Liens d'invitation des sources d'une page d'atterrissage, côté site (phase 15, rubrique « Pages ») : fonctions
 * appelées par les actions serveur de la rubrique et par le script de la page de test. Le moteur est partagé avec le
 * worker (`packages/telegram/src/landing/`) : un lien `LANDING` par source (la source "" est le lien par défaut), créé
 * AVEC demande d'adhésion par le bot de l'univers du canal, sinon par un autre de nos bots administrateurs, nommé
 * « <page>-<source> » (32 caractères au plus) ; refus de Telegram gardé en français sur la source
 * (`LandingSource.linkError`), nouvel essai automatique par le worker toutes les 10 minutes ; source retirée ou page
 * supprimée : liens révoqués chez Telegram. Chaque création publie l'invalidation du HTML gardé en mémoire. Pub figée
 * (D9) : un lien garde pour toujours la pub (et la campagne) pour laquelle il a été créé ; la pub d'une source change :
 * un nouveau lien la remplace sur la source et l'ancien, détaché, reste valable 15 minutes (visiteurs qui ont encore la
 * page à l'écran ou dans le cache du navigateur), puis le worker le révoque (il garde ses demandes et sa pub).
 *
 * À l'enregistrement d'une page : `syncLandingPageLinks(pageId, { userId })` (une seule fonction). Avant de supprimer
 * une page : `revokeLandingSourceLinks({ pageId, userId })` (la suppression détache ses liens).
 *
 * Journal de l'équipe (`AuditLog`, seulement avec un utilisateur) : `invite_link.landing_created`,
 * `invite_link.landing_revoked` ; journal des événements (`Event`, toujours) écrit par le moteur.
 */
import { audit, prisma } from "@linkaffipro/db";
import {
  ensureLandingLinksWithDb,
  refreshLandingChannelWithDb,
  revokeDetachedLandingLinksWithDb,
  revokeLandingPageLinksWithDb,
  syncLandingAdLinksWithDb,
  type EnsureLandingLinksReport,
  type LandingChatOutcome,
  type RevokeLandingLinksReport,
} from "@linkaffipro/telegram";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";

export type { EnsureLandingLinksReport, RevokeLandingLinksReport };

/** État du lien d'une source, pour la rubrique Pages (bouton « Copier le lien », message d'attente). */
export type LandingSourceLinkView = {
  sourceId: string;
  /** Clé de la source ("" = source par défaut, sans `?src=`). */
  key: string;
  /** ready : lien prêt ; pending : en cours de création ; error : refus de Telegram (`error`) ; inactive : source retirée. */
  status: "ready" | "pending" | "error" | "inactive";
  /** Lien Telegram de la source (https://t.me/+…), seulement s'il est prêt. */
  inviteUrl: string | null;
  /** Refus de Telegram en français (nouvel essai automatique), sinon null. */
  error: string | null;
};

export type SyncLandingPageLinksResult = {
  found: boolean;
  /** Liens créés maintenant. */
  created: number;
  /** Sources restées sans lien (refus ou Telegram injoignable : nouvel essai automatique). */
  failed: number;
  /** Liens détachés révoqués : source retirée, ou ancien lien d'une source dont la pub a changé il y a plus de
   * 15 minutes (ou désactivés ici quand Telegram refuse). Un lien remplacé à l'instant n'est jamais compté ici. */
  revoked: number;
  /** Campagne d'un lien actuel corrigée : recalcul complet des statistiques demandé. */
  recomputeRequested: boolean;
  /** Message court pour l'écran après l'enregistrement (null : rien à dire). */
  message: string | null;
  sources: LandingSourceLinkView[];
};

/** Message après l'enregistrement : « 3 liens Telegram créés. », « 1 lien en attente : … ». */
export function landingLinksMessage(r: {
  created: number;
  failed: number;
  firstError: string | null;
}): string | null {
  const parts: string[] = [];
  if (r.created === 1) parts.push(r.failed > 0 ? "1 lien Telegram créé." : "Lien Telegram créé.");
  else if (r.created > 1) parts.push(`${r.created} liens Telegram créés.`);
  if (r.failed > 0) {
    const what = r.failed === 1 ? "1 lien en attente" : `${r.failed} liens en attente`;
    parts.push(r.firstError ? `${what} : ${r.firstError}` : `${what}.`);
  }
  return parts.length ? parts.join(" ") : null;
}

function firstErrorOf(report: EnsureLandingLinksReport): string | null {
  for (const s of report.sources) if (s.status === "error") return s.error;
  return null;
}

/** État des liens des sources d'une page (sources actives d'abord, puis par clé ; la source par défaut en tête). */
export async function loadLandingSourceLinks(pageId: string): Promise<LandingSourceLinkView[]> {
  const rows = await prisma.landingSource.findMany({
    where: { landingPageId: pageId },
    orderBy: [{ isActive: "desc" }, { key: "asc" }, { id: "asc" }],
    select: {
      id: true,
      key: true,
      isActive: true,
      linkError: true,
      inviteLink: { select: { telegramInviteLink: true, isActive: true } },
    },
  });
  return rows.map((s): LandingSourceLinkView => {
    const ready = s.inviteLink?.isActive === true;
    if (!s.isActive)
      return { sourceId: s.id, key: s.key, status: "inactive", inviteUrl: null, error: null };
    if (ready)
      return {
        sourceId: s.id,
        key: s.key,
        status: "ready",
        inviteUrl: s.inviteLink!.telegramInviteLink,
        error: null,
      };
    return {
      sourceId: s.id,
      key: s.key,
      status: s.linkError ? "error" : "pending",
      inviteUrl: null,
      error: s.linkError,
    };
  });
}

/**
 * Crée les liens manquants des sources actives d'une page (sans doublon, relançable). Journal de l'équipe pour chaque
 * lien créé si `userId`. Ne lève pas pour un refus de Telegram (gardé sur la source, rendu dans le rapport).
 */
export async function ensureLandingSourceLinks(
  pageId: string,
  opts: { userId?: string | null } = {},
): Promise<EnsureLandingLinksReport> {
  const report = await ensureLandingLinksWithDb(pageId, { userId: opts.userId ?? null });
  if (opts.userId)
    for (const s of report.sources)
      if (s.status === "ok" && s.created)
        await audit({
          userId: opts.userId,
          action: "invite_link.landing_created",
          entityType: "InviteLink",
          entityId: s.inviteLinkId,
          metadata: { landingPageId: pageId, sourceKey: s.key, bot: s.bot ?? null },
        });
  return report;
}

/**
 * Révoque chez Telegram les liens d'une page : tous (page à supprimer : appeler AVANT la suppression), ou ceux de
 * certaines sources (`sourceIds`). Telegram injoignable : `retryLater` (le worker reprend les liens orphelins).
 */
export async function revokeLandingSourceLinks(input: {
  pageId: string;
  sourceIds?: string[];
  userId?: string | null;
}): Promise<RevokeLandingLinksReport> {
  const report = await revokeLandingPageLinksWithDb(input.pageId, {
    ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
    userId: input.userId ?? null,
  });
  if (input.userId && report.revoked + report.disabledOnly + report.retryLater > 0)
    await audit({
      userId: input.userId,
      action: "invite_link.landing_revoked",
      entityType: "LandingPage",
      entityId: input.pageId,
      metadata: { sourceIds: input.sourceIds ?? null, ...report },
    });
  return report;
}

/**
 * Tout ce qu'il faut après l'enregistrement d'une page ou de ses sources (une seule fonction pour l'interface) :
 * 1. liens manquants créés (un par source active), y compris pour une source dont la pub a changé (le nouveau lien,
 *    créé pour la nouvelle pub, remplace l'ancien sur la source) ;
 * 2. liens détachés révoqués chez Telegram : sources retirées ou désactivées, tout de suite (après la création, pour
 *    que le bouton de la page ait toujours un lien qui fonctionne) ; un ancien lien remplacé à l'instant reste valable
 *    15 minutes (page déjà affichée, cache du navigateur, retour arrière), le worker le révoque ensuite ;
 * 3. pub figée (D9) : campagne des liens actuels vérifiée, recalcul complet des statistiques seulement si elle a dû
 *    être corrigée (un changement de pub ne change aucun chiffre passé) ;
 * 4. titre (et petite photo si la page l'affiche) relus tout de suite si le canal n'a jamais été relu ou si la photo
 *    manque.
 * Ne lève pas pour Telegram ni pour la file des recalculs (journalisé) ; une erreur de base remonte.
 */
export async function syncLandingPageLinks(
  pageId: string,
  opts: { userId?: string | null } = {},
): Promise<SyncLandingPageLinksResult> {
  const page = await prisma.landingPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      showPhoto: true,
      channelId: true,
      channel: { select: { photoFileUniqueId: true, chatCheckedAt: true } },
    },
  });
  if (!page)
    return {
      found: false,
      created: 0,
      failed: 0,
      revoked: 0,
      recomputeRequested: false,
      message: null,
      sources: [],
    };
  const userId = opts.userId ?? null;

  const ensured = await ensureLandingSourceLinks(pageId, { userId });

  const detached = await revokeDetachedLandingLinksWithDb({ pageId, userId });
  if (userId && detached.revoked + detached.disabledOnly + detached.retryLater > 0)
    await audit({
      userId,
      action: "invite_link.landing_revoked",
      entityType: "LandingPage",
      entityId: pageId,
      metadata: {
        // Un lien remplacé maintenant n'est jamais révoqué ici (délai des liens remplacés) : seulement une source
        // retirée, ou un ancien lien remplacé depuis plus de 15 minutes que le worker n'a pas encore repris.
        reason: "source retirée ou ancien lien remplacé",
        ...detached,
      },
    });

  const ads = await syncLandingAdLinksWithDb({ pageId });
  if (ads.recomputeNeeded)
    await refreshCampaignStats().catch((err: unknown) =>
      console.error("[landing] recalcul des statistiques non demandé", err),
    );

  if (!page.channel.chatCheckedAt || (page.showPhoto && !page.channel.photoFileUniqueId))
    await refreshLandingChannel(page.channelId, { wantsPhoto: page.showPhoto });

  return {
    found: true,
    created: ensured.created,
    failed: ensured.failed,
    revoked: detached.revoked + detached.disabledOnly,
    recomputeRequested: ads.recomputeNeeded,
    message: landingLinksMessage({
      created: ensured.created,
      failed: ensured.failed,
      firstError: firstErrorOf(ensured),
    }),
    sources: await loadLandingSourceLinks(pageId),
  };
}

/**
 * Relit tout de suite le titre d'un canal chez Telegram (et sa petite photo si une page active l'affiche, ou si
 * `wantsPhoto`), puis invalide ses pages si quelque chose a changé. Ne lève jamais (null en cas d'échec).
 */
export async function refreshLandingChannel(
  channelId: string,
  opts: { wantsPhoto?: boolean } = {},
): Promise<LandingChatOutcome | null> {
  try {
    return await refreshLandingChannelWithDb(channelId, { wantsPhoto: opts.wantsPhoto });
  } catch (err) {
    console.error("[landing] relecture du canal impossible", channelId, err);
    return null;
  }
}
