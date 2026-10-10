/**
 * Bouton « Offre » d'un message de canal ou d'un envoi groupé (côté serveur) : on choisit une de nos campagnes
 * (page Campagnes) et l'une de ses offres Link Affi ; la campagne est conservée dans le bouton stocké
 * (`Post.buttons[].campaignId`) et sur le lien traqué (`TrackingLink.campaignId`), ce qui rattache ses clics et
 * ses joueurs à la campagne et permet au bot de suivre la campagne si son offre change (voir
 * `packages/telegram/src/offers/prisma-deps.ts`).
 *
 * Règles :
 * - tout NOUVEAU bouton Offre exige une campagne qui contient l'offre choisie ;
 * - un ANCIEN bouton (créé avant la phase 8, sans campagne) reste accepté tant qu'il garde son offre ;
 * - une campagne supprimée, ou qui ne contient plus l'offre, est refusée avec un message clair ;
 * - une COPIE faite par le serveur (envoi au reste d'un test A/B) reprend le bouton d'origine tel quel : ancien
 *   bouton sans campagne accepté, et si l'offre a quitté la campagne, on prend une autre offre active de la campagne
 *   (comme le bot) au lieu de bloquer l'envoi.
 *
 * Les vérifications (`resolveOfferButton`, `assertButtonRows`) n'écrivent rien : les actions les lancent AVANT de
 * créer le moindre message, pour qu'un bouton refusé ne laisse jamais un message programmé sans ses boutons.
 */
import { shortId } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { buttonUrlError, type PostButton } from "@/lib/posts/buttons";
import { jsonIds } from "./attribution";

type OfferInput = Pick<PostButton, "text" | "campaignId" | "affiliateCampaignId">;
type OfferButtonInput = Pick<
  PostButton,
  "text" | "type" | "trackingLinkId" | "campaignId" | "affiliateCampaignId"
>;
type LinkRow = {
  id: string;
  kind: string;
  affiliateCampaignId: string | null;
  campaignId: string | null;
};
type CampaignRow = { id: string; name: string; affiliateCampaignIds: unknown };
type OfferRow = { id: string; isActive: boolean; trackingUrlTemplate: string };

/** Message d'erreur commun : la campagne détermine le lien Link Affi. */
export function chooseCampaignMessage(text: string): string {
  return `Bouton « ${text} » : choisissez une campagne (menu Campagnes) ; c'est elle qui donne le lien de l'offre.`;
}

/**
 * Vérifie un bouton Offre (règle pure). `existingLink` : lien traqué déjà enregistré pour ce bouton (null pour un
 * nouveau bouton) ; `campaign` : la campagne choisie, chargée (null si aucune ou introuvable).
 * Retourne le message d'erreur à afficher, ou null si le bouton est valable.
 */
export function offerButtonError(
  b: OfferInput,
  ctx: {
    existingLink: { affiliateCampaignId: string | null; campaignId?: string | null } | null;
    campaign: { id: string; name?: string; affiliateCampaignIds: unknown } | null;
  },
): string | null {
  if (!b.affiliateCampaignId) return chooseCampaignMessage(b.text);
  if (b.campaignId) {
    if (!ctx.campaign) return chooseCampaignMessage(b.text);
    if (!jsonIds(ctx.campaign.affiliateCampaignIds).includes(b.affiliateCampaignId))
      return `Bouton « ${b.text} » : cette offre n'est plus dans la campagne${ctx.campaign.name ? ` « ${ctx.campaign.name} »` : ""} ; choisissez à nouveau l'offre (ou une autre campagne).`;
    return null;
  }
  // Sans campagne : seulement un ancien bouton qui garde son lien Link Affi d'origine.
  if (ctx.existingLink && ctx.existingLink.affiliateCampaignId === b.affiliateCampaignId)
    return null;
  return chooseCampaignMessage(b.text);
}

/**
 * Offre à utiliser dans une campagne : celle du bouton si elle en fait toujours partie et reste active, sinon la
 * première offre active de la campagne (ordre de la campagne). Même règle que `pickCampaignOffer`
 * (`packages/telegram/src/offers/logic.ts`, appliquée par le bot au clic).
 */
export function pickCampaignOfferId(
  linkOfferId: string | null,
  campaignOfferIds: readonly string[],
  offers: ReadonlyArray<OfferRow>,
): string | null {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const current = linkOfferId ? byId.get(linkOfferId) : undefined;
  if (current && current.isActive && campaignOfferIds.includes(current.id)) return current.id;
  for (const id of campaignOfferIds) {
    const o = byId.get(id);
    if (o && o.isActive && o.trackingUrlTemplate) return o.id;
  }
  return null;
}

/**
 * Copie d'un bouton déjà enregistré, faite par le serveur (règle pure) : bouton d'une campagne → l'offre du bouton
 * si elle est toujours dans la campagne, sinon une autre offre active de la campagne ; ancien bouton sans campagne
 * (ou campagne supprimée) → son offre d'origine, sans campagne.
 */
export function copiedOfferChoice(
  b: OfferInput,
  ctx: {
    sourceLink: { affiliateCampaignId: string | null } | null;
    campaign: CampaignRow | null;
    offers: ReadonlyArray<OfferRow>;
  },
): { offerId: string; campaignId: string | null } | { error: string } {
  const original = b.affiliateCampaignId ?? ctx.sourceLink?.affiliateCampaignId ?? null;
  if (b.campaignId && ctx.campaign) {
    const picked = pickCampaignOfferId(
      original,
      jsonIds(ctx.campaign.affiliateCampaignIds),
      ctx.offers,
    );
    if (picked) return { offerId: picked, campaignId: ctx.campaign.id };
    return {
      error: `Bouton « ${b.text} » : la campagne « ${ctx.campaign.name} » n'a plus d'offre active ; ajoutez-lui une offre (fiche de la campagne, Vue d'ensemble, « Offres Link Affi ») puis réessayez.`,
    };
  }
  if (original) return { offerId: original, campaignId: null };
  return { error: chooseCampaignMessage(b.text) };
}

export type OfferButtonPlan = {
  /** Lien OFFER à mettre à jour (null : un nouveau lien sera créé). */
  existingLink: LinkRow | null;
  offer: OfferRow;
  campaignId: string | null;
};

/**
 * Charge et vérifie un bouton Offre, sans rien écrire. `copy` : copie faite par le serveur (voir l'en-tête) ;
 * `b.trackingLinkId` désigne alors le lien d'origine, qui n'est jamais modifié (un nouveau lien sera créé).
 * Lève une erreur lisible si le bouton est refusé.
 */
export async function resolveOfferButton(
  b: OfferButtonInput,
  opts: { copy?: boolean } = {},
): Promise<OfferButtonPlan> {
  const [existing, campaign] = await Promise.all([
    b.trackingLinkId
      ? prisma.trackingLink.findUnique({
          where: { id: b.trackingLinkId },
          select: { id: true, kind: true, affiliateCampaignId: true, campaignId: true },
        })
      : Promise.resolve(null),
    b.campaignId
      ? prisma.campaign.findUnique({
          where: { id: b.campaignId },
          select: { id: true, name: true, affiliateCampaignIds: true },
        })
      : Promise.resolve(null),
  ]);
  // Un lien d'un autre type (ex. ancien « Lien traqué ») n'est jamais réutilisé : le bot n'ouvre que les liens OFFER.
  const existingLink = existing && existing.kind === "OFFER" ? existing : null;
  let offerId: string;
  let campaignId: string | null;
  if (opts.copy) {
    const ids = campaign ? jsonIds(campaign.affiliateCampaignIds) : [];
    const offers = ids.length
      ? await prisma.affiliateCampaign.findMany({
          where: { id: { in: ids } },
          select: { id: true, isActive: true, trackingUrlTemplate: true },
        })
      : [];
    const choice = copiedOfferChoice(b, { sourceLink: existingLink, campaign, offers });
    if ("error" in choice) throw new Error(choice.error);
    offerId = choice.offerId;
    campaignId = choice.campaignId;
  } else {
    const error = offerButtonError(b, { existingLink, campaign });
    if (error) throw new Error(error);
    offerId = b.affiliateCampaignId!;
    campaignId = campaign?.id ?? null;
  }
  const offer = await prisma.affiliateCampaign.findUnique({
    where: { id: offerId },
    select: { id: true, isActive: true, trackingUrlTemplate: true },
  });
  if (!offer || !offer.isActive)
    throw new Error(
      `Bouton « ${b.text} » : l'offre Link Affi de cette campagne est introuvable ou inactive ; choisissez une autre offre de la campagne.`,
    );
  return { existingLink: opts.copy ? null : existingLink, offer, campaignId };
}

/**
 * Vérifie tous les boutons d'un message (adresses des liens, règle des boutons Offre) sans rien écrire. À appeler
 * avant de créer le message : lève la première erreur lisible.
 */
export async function assertButtonRows(
  rows: ReadonlyArray<ReadonlyArray<OfferButtonInput & { url?: string }>>,
  opts: { copy?: boolean } = {},
): Promise<void> {
  for (const row of rows)
    for (const b of row) {
      if (b.type === "OFFER") await resolveOfferButton(b, opts);
      else {
        const error = buttonUrlError(b);
        if (error) throw new Error(error);
      }
    }
}

export type MaterializedOfferButton = {
  button: PostButton;
  /**
   * Vrai si un lien déjà enregistré (qui a peut-être des clics et des joueurs) change de campagne ou d'offre : ses
   * statistiques passées changent de campagne, l'appelant doit demander un recalcul complet (`refreshCampaignStats`).
   */
  relinked: boolean;
};

/**
 * Crée ou met à jour le lien traqué (kind OFFER) d'un bouton Offre et renvoie le bouton à stocker.
 * `labelSuffix` : ajouté au libellé d'un lien créé (ex. « (envoi groupé) ») ; `copy` : voir `resolveOfferButton`.
 * Lève une erreur lisible si le bouton est refusé (voir `offerButtonError`).
 */
export async function materializeOfferButton(
  b: OfferButtonInput,
  ctx: { channelId: string; postId: string; userId: string; labelSuffix?: string; copy?: boolean },
): Promise<MaterializedOfferButton> {
  const { existingLink, offer, campaignId } = await resolveOfferButton(b, { copy: ctx.copy });
  const link = existingLink
    ? await prisma.trackingLink.update({
        where: { id: existingLink.id },
        data: {
          destinationTemplate: offer.trackingUrlTemplate,
          affiliateCampaignId: offer.id,
          // Ancien bouton sans campagne : on ne touche pas au rattachement existant.
          ...(campaignId ? { campaignId } : {}),
          label: b.text,
          isActive: true,
        },
      })
    : await prisma.trackingLink.create({
        data: {
          slug: shortId(8),
          kind: "OFFER",
          destinationTemplate: offer.trackingUrlTemplate,
          label: `${b.text}${ctx.labelSuffix ?? ""}`,
          channelId: ctx.channelId,
          postId: ctx.postId,
          affiliateCampaignId: offer.id,
          campaignId,
          createdById: ctx.userId,
        },
      });
  const relinked =
    !!existingLink &&
    ((!!campaignId && existingLink.campaignId !== campaignId) ||
      existingLink.affiliateCampaignId !== offer.id);
  return {
    button: {
      text: b.text,
      type: "OFFER",
      trackingLinkId: link.id,
      slug: link.slug,
      affiliateCampaignId: offer.id,
      ...(campaignId ? { campaignId } : {}),
    },
    relinked,
  };
}
