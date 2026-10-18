/**
 * Lien d'offre envoyé par l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 5) :
 * `go.goolink.eu/a/<subId>` (réécrit en `/r/a/<subId>` par le proxy) → offre Link Affi avec le sub-ID de cet envoi.
 * - une seule requête en base avant la réponse 302, immédiate ; les écritures se font après la réponse ;
 * - première ouverture humaine : `Click` (sub-ID, membre, bot, conversation, adresse finale avec `tg` pour un membre
 *   d'affilié), compteurs du lien, événements `offer_opened` / `click.offer` / `conversation.offer_opened`, et
 *   `offer_clicked` vers Link Affi pour un membre d'affilié ; JAMAIS d'événement vers les relances automatiques (elles
 *   écriraient au membre par un autre bot) ;
 * - ouvertures suivantes : même adresse (celle du clic), `opens + 1`, `TrackingLink.clicks + 1` ;
 * - robots connus : même redirection, rien n'est compté ;
 * - sub-ID inconnu : null (l'appelant répond comme pour un lien inconnu).
 */
import {
  extractTrackingParams,
  hashIp,
  isAffiliateAttributionActive,
  isBotUserAgent,
  isSubId,
} from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { emitLinkaffiEvent } from "@linkaffipro/queue";
import { offerDestination } from "@linkaffipro/telegram";

/** sub-ID d'un chemin `/a/<subId>` (segments de la route `/r/[[...slug]]`), sinon null. */
export function assistantOfferSubIdOf(slugParts: readonly string[]): string | null {
  if (slugParts.length !== 2 || slugParts[0] !== "a") return null;
  const subId = slugParts[1] ?? "";
  return isSubId(subId) ? subId : null;
}

const offerSelect = {
  id: true,
  subId: true,
  botId: true,
  memberId: true,
  conversationId: true,
  trackingLinkId: true,
  clickId: true,
  click: { select: { id: true, destination: true } },
  trackingLink: {
    select: {
      id: true,
      isActive: true,
      destinationTemplate: true,
      affiliateCampaign: {
        select: {
          trackingUrlTemplate: true,
          campaignKey: true,
          program: { select: { source: true } },
        },
      },
    },
  },
  member: {
    select: { linkaffiCampaignKey: true, affiliateAttributionEndsAt: true, anonymizedAt: true },
  },
} as const;

/** Lien d'offre tel que lu en base (forme du `select` ci-dessus). */
export type AssistantOfferRow = {
  id: string;
  subId: string;
  botId: string;
  memberId: string | null;
  conversationId: string | null;
  trackingLinkId: string;
  clickId: string | null;
  click: { id: string; destination: string | null } | null;
  trackingLink: {
    id: string;
    isActive: boolean;
    destinationTemplate: string;
    affiliateCampaign: {
      trackingUrlTemplate: string | null;
      campaignKey: string | null;
      program: { source: string | null } | null;
    } | null;
  };
  member: {
    linkaffiCampaignKey: string | null;
    affiliateAttributionEndsAt: Date | null;
    anonymizedAt: Date | null;
  } | null;
};

export type AssistantOfferTarget = {
  /** Adresse finale (302). */
  target: string;
  /** Déjà ouvert : même adresse que le premier clic, seulement `opens + 1`. */
  reopened: boolean;
  /** Campagne Telegram d'affilié ajoutée au lien (`&tg=`), sinon null. */
  telegramCampaignKey: string | null;
  /** Clé Link Affi de l'offre (lien `…/go/<clé>`), sinon null. */
  offerCampaignKey: string | null;
  /** Membre d'affilié dont l'attribution est en cours : `offer_clicked` part vers Link Affi. */
  affiliateActive: boolean;
};

/**
 * Adresse d'un lien d'offre (fonction pure, testée) : celle du premier clic s'il existe ; sinon le modèle d'URL de
 * l'offre Link Affi du lien (à défaut celui du lien lui-même) rempli avec le sub-ID de cet envoi, et `tg` pour un
 * membre d'affilié (même règle que les boutons d'offre du bot). Null si le lien est désactivé ou sans adresse.
 */
export function assistantOfferTarget(
  row: AssistantOfferRow,
  now: Date,
): AssistantOfferTarget | null {
  const member =
    row.member && !row.member.anonymizedAt && row.member.linkaffiCampaignKey ? row.member : null;
  const affiliateActive = member
    ? isAffiliateAttributionActive(
        {
          linkaffiCampaignKey: member.linkaffiCampaignKey,
          affiliateAttributionEndsAt: member.affiliateAttributionEndsAt,
        },
        now,
      )
    : false;
  const offer = row.trackingLink.affiliateCampaign;
  const usesOffer = Boolean(offer?.trackingUrlTemplate);
  const offerCampaignKey =
    usesOffer && offer?.campaignKey && offer.program?.source === "LINKAFFI"
      ? offer.campaignKey
      : null;
  if (row.click?.destination)
    return {
      target: row.click.destination,
      reopened: true,
      telegramCampaignKey: null,
      offerCampaignKey,
      affiliateActive,
    };
  if (!row.trackingLink.isActive) return null;
  const template =
    (usesOffer ? offer!.trackingUrlTemplate : row.trackingLink.destinationTemplate) ?? "";
  if (!template.trim()) return null;
  const { destination, telegramCampaignKey } = offerDestination({
    template,
    subId: row.subId,
    memberId: row.memberId ?? "",
    postId: null,
    offerCampaignKey,
    affiliate: member
      ? {
          campaignKey: member.linkaffiCampaignKey,
          attributionEndsAt: member.affiliateAttributionEndsAt,
        }
      : null,
    now,
  });
  return {
    target: destination,
    reopened: false,
    telegramCampaignKey,
    offerCampaignKey,
    affiliateActive,
  };
}

export type ResolvedAssistantOffer = {
  row: AssistantOfferRow;
  offer: AssistantOfferTarget;
  at: Date;
};

/** Une seule requête : lien d'offre par sub-ID et adresse finale ; null si inconnu, désactivé ou sans adresse. */
export async function resolveAssistantOffer(
  subId: string,
  now: Date = new Date(),
): Promise<ResolvedAssistantOffer | null> {
  const row: AssistantOfferRow | null = await prisma.assistantOfferLink.findUnique({
    where: { subId },
    select: offerSelect,
  });
  if (!row) return null;
  const offer = assistantOfferTarget(row, now);
  return offer ? { row, offer, at: now } : null;
}

/** Ce que la requête dit de l'ouverture (comme les autres clics : IP hachée, navigateur, provenance, paramètres pub). */
export type OfferOpenRequest = {
  isBot: boolean;
  ipHash: string | null;
  userAgent: string | null;
  referer: string | null;
  clickIds: Record<string, string>;
  utm: Record<string, string>;
};

export function offerOpenRequest(req: Request): OfferOpenRequest {
  const userAgent = req.headers.get("user-agent");
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  let search = new URLSearchParams();
  try {
    search = new URL(req.url).searchParams;
  } catch {
    // Adresse illisible : aucun paramètre.
  }
  const { clickIds, utm } = extractTrackingParams(search);
  return {
    isBot: isBotUserAgent(userAgent),
    ipHash: ip && process.env.IP_HASH_SALT ? hashIp(ip) : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    referer: req.headers.get("referer")?.slice(0, 1024) ?? null,
    clickIds: clickIds as Record<string, string>,
    utm,
  };
}

/** Violation d'unicité Prisma (P2002) : le premier clic vient d'être créé par une ouverture simultanée. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

class AlreadyOpened extends Error {}

/** Ouverture suivante : même adresse, `opens + 1` et un clic de plus sur le lien. */
async function recordReopen(row: AssistantOfferRow): Promise<"reopened"> {
  await prisma.$transaction([
    prisma.assistantOfferLink.update({
      where: { id: row.id },
      data: { opens: { increment: 1 } },
      select: { id: true },
    }),
    prisma.trackingLink.update({
      where: { id: row.trackingLinkId },
      data: { clicks: { increment: 1 } },
      select: { id: true },
    }),
  ]);
  return "reopened";
}

/**
 * Enregistre l'ouverture (après la réponse 302). Retourne ce qui a été fait (pour les tests). Ne lève pas pour un
 * événement Link Affi impossible à enregistrer.
 */
export async function recordAssistantOfferOpen(
  resolved: ResolvedAssistantOffer,
  request: OfferOpenRequest,
): Promise<"bot" | "first" | "reopened"> {
  if (request.isBot) return "bot";
  const { row, offer, at } = resolved;
  if (offer.reopened || row.clickId) return recordReopen(row);

  let clickId: string;
  try {
    clickId = await prisma.$transaction(async (tx) => {
      const click = await tx.click.create({
        data: {
          trackingLinkId: row.trackingLinkId,
          subId: row.subId,
          memberId: row.memberId,
          botId: row.botId,
          conversationId: row.conversationId,
          ipHash: request.ipHash,
          userAgent: request.userAgent,
          referer: request.referer,
          isBot: false,
          ttclid: request.clickIds.ttclid ?? null,
          fbclid: request.clickIds.fbclid ?? null,
          gclid: request.clickIds.gclid ?? null,
          utm: Object.keys(request.utm).length > 0 ? request.utm : undefined,
          destination: offer.target,
          linkaffiTelegramCampaignKey: offer.telegramCampaignKey,
          createdAt: at,
        },
        select: { id: true },
      });
      // Une seule première ouverture, même si deux ouvertures arrivent ensemble.
      const { count } = await tx.assistantOfferLink.updateMany({
        where: { id: row.id, clickId: null },
        data: { clickId: click.id, firstOpenedAt: at, opens: { increment: 1 } },
      });
      if (count === 0) throw new AlreadyOpened();
      const previous = row.memberId
        ? await tx.click.count({
            where: {
              trackingLinkId: row.trackingLinkId,
              memberId: row.memberId,
              isBot: false,
              id: { not: click.id },
            },
          })
        : 0;
      await tx.trackingLink.update({
        where: { id: row.trackingLinkId },
        data: {
          clicks: { increment: 1 },
          uniqueClicks: previous === 0 ? { increment: 1 } : undefined,
        },
        select: { id: true },
      });
      if (row.conversationId)
        await tx.conversationEvent.create({
          data: {
            conversationId: row.conversationId,
            type: "offer_opened",
            payload: toJsonValue({ subId: row.subId, clickId: click.id, offerLinkId: row.id }),
            createdAt: at,
          },
        });
      return click.id;
    });
  } catch (err) {
    if (err instanceof AlreadyOpened || isUniqueViolation(err)) return recordReopen(row);
    throw err;
  }

  // Journal (aucun texte de conversation) : clic d'offre et ouverture du lien de la conversation.
  await recordEvent({
    type: "click.offer",
    memberId: row.memberId,
    botId: row.botId,
    occurredAt: at,
    payload: toJsonValue({
      clickId,
      subId: row.subId,
      trackingLinkId: row.trackingLinkId,
      postId: null,
      conversationId: row.conversationId,
      via: "assistant",
      ...(offer.telegramCampaignKey
        ? { linkaffiTelegramCampaignKey: offer.telegramCampaignKey }
        : {}),
    }),
  });
  if (row.conversationId)
    await recordEvent({
      type: "conversation.offer_opened",
      memberId: row.memberId,
      botId: row.botId,
      occurredAt: at,
      payload: toJsonValue({ conversationId: row.conversationId, subId: row.subId, clickId }),
    });
  // Membre d'un affilié Link Affi (attribution en cours) : le clic part aussi à Link Affi (comme les boutons d'offre).
  if (row.memberId && offer.affiliateActive)
    await emitLinkaffiEvent({
      type: "offer_clicked",
      sourceId: clickId,
      memberId: row.memberId,
      channelId: null,
      occurredAt: at,
      data: { subId: row.subId, offerCampaignKey: offer.offerCampaignKey },
    }).catch((err: unknown) =>
      console.warn("[assistant] événement Link Affi non enregistré", {
        clickId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  return "first";
}
