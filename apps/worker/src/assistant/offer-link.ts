/**
 * Lien d'offre envoyé par l'assistant de conversation (contrat §5) : un sub-ID unique par conversation et par envoi.
 * - Lien suivi OFFER de la persona (`TrackingLink`, un par persona et par offre, nom court stable de 10 caractères) :
 *   rattache les clics à la persona, à l'offre Link Affi et à notre campagne (statistiques, Campagnes → Liens).
 * - `AssistantOfferLink` : le sub-ID de CET envoi (`newSubId()`), la conversation, la persona, le bot, le membre et la
 *   source du /start (copie, pour les statistiques après suppression de la conversation).
 * - Adresse envoyée : `<adresse des liens>/a/<sub-ID>` ; à la première ouverture humaine, le site crée le `Click` et
 *   redirige vers l'offre Link Affi avec ce sub-ID (les inscriptions et dépôts remontent ensuite par ce sub-ID).
 * Persona sans offre, offre inactive ou lien désactivé par l'équipe : aucun lien (null), le moteur n'envoie pas de bouton.
 */
import { newSubId } from "@linkaffipro/core";
import { prisma, Prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { assistantOfferLabel, assistantOfferSlug, assistantOfferUrl } from "./rules";

export type OfferLinkContext = {
  conversationId: string;
  personaId: string;
  botId: string;
  memberId: string;
  source: string | null;
};

export type CreatedOfferLink = {
  url: string;
  subId: string;
  trackingLinkId: string;
  offerLinkId: string;
};

/** Lien OFFER de la persona pour son offre (créé au premier envoi, réutilisé ensuite), ou null. */
export async function personaOfferTrackingLink(personaId: string): Promise<{ id: string } | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { name: true, affiliateCampaignId: true, campaignId: true },
  });
  if (!persona?.affiliateCampaignId) return null;
  const offer = await prisma.affiliateCampaign.findUnique({
    where: { id: persona.affiliateCampaignId },
    select: { id: true, isActive: true, trackingUrlTemplate: true },
  });
  if (!offer || !offer.isActive || !offer.trackingUrlTemplate.trim()) return null;
  const slug = assistantOfferSlug(personaId, offer.id);
  // Création idempotente sur le nom court (deux conversations servies en même temps ne créent qu'un lien).
  const link = await prisma.trackingLink.upsert({
    where: { slug },
    create: {
      slug,
      kind: "OFFER",
      destinationTemplate: offer.trackingUrlTemplate,
      label: assistantOfferLabel(persona.name),
      affiliateCampaignId: offer.id,
      campaignId: persona.campaignId,
      personaId,
    },
    update: {},
    select: {
      id: true,
      isActive: true,
      destinationTemplate: true,
      campaignId: true,
      personaId: true,
      label: true,
    },
  });
  if (!link.isActive) return null;
  // Adresse de l'offre, campagne ou prénom changés depuis : le lien les suit.
  const label = assistantOfferLabel(persona.name);
  if (
    link.destinationTemplate !== offer.trackingUrlTemplate ||
    link.campaignId !== persona.campaignId ||
    link.personaId !== personaId ||
    link.label !== label
  )
    await prisma.trackingLink.update({
      where: { id: link.id },
      data: {
        destinationTemplate: offer.trackingUrlTemplate,
        campaignId: persona.campaignId,
        personaId,
        label,
      },
    });
  return { id: link.id };
}

/**
 * Lien OFFER via PersonaBookmaker (phase 25 bis, paris sportifs) : la persona a plusieurs bookmakers, chacun avec sa
 * propre AffiliateCampaign. Le modèle choisit lequel proposer (`selected_book`) ; on cherche le lien suivi correspondant.
 * Retourne null si le bookmaker n'est pas configuré, si l'offre est inactive ou si la campagne n'a pas de lien.
 */
export async function personaBookmakerOfferTrackingLink(
  personaId: string,
  bookmakerKey: string,
): Promise<{ id: string } | null> {
  const pb = await prisma.personaBookmaker.findUnique({
    where: { personaId_bookmakerKey: { personaId, bookmakerKey } },
    select: {
      affiliateCampaignId: true,
      label: true,
      persona: { select: { name: true, campaignId: true } },
    },
  });
  if (!pb?.affiliateCampaignId) return null;
  const offer = await prisma.affiliateCampaign.findUnique({
    where: { id: pb.affiliateCampaignId },
    select: { id: true, isActive: true, trackingUrlTemplate: true },
  });
  if (!offer || !offer.isActive || !offer.trackingUrlTemplate.trim()) return null;
  // Slug déterministe : persona + affiliateCampaign (le même qu'un lien simple, mais ici l'offer.id vient du
  // PersonaBookmaker et non de la persona directement).
  const slug = assistantOfferSlug(personaId, offer.id);
  const label = assistantOfferLabel(pb.persona.name, pb.label);
  const link = await prisma.trackingLink.upsert({
    where: { slug },
    create: {
      slug,
      kind: "OFFER",
      destinationTemplate: offer.trackingUrlTemplate,
      label,
      affiliateCampaignId: offer.id,
      campaignId: pb.persona.campaignId,
      personaId,
    },
    update: {},
    select: {
      id: true,
      isActive: true,
      destinationTemplate: true,
      campaignId: true,
      personaId: true,
      label: true,
    },
  });
  if (!link.isActive) return null;
  if (
    link.destinationTemplate !== offer.trackingUrlTemplate ||
    link.campaignId !== pb.persona.campaignId ||
    link.personaId !== personaId ||
    link.label !== label
  )
    await prisma.trackingLink.update({
      where: { id: link.id },
      data: {
        destinationTemplate: offer.trackingUrlTemplate,
        campaignId: pb.persona.campaignId,
        personaId,
        label,
      },
    });
  return { id: link.id };
}

/**
 * Crée le lien de CET envoi (un sub-ID neuf), ou null si aucune offre utilisable.
 * `bookmakerKey` (phase 25 bis) : si fourni, le lien passe par la table PersonaBookmaker au lieu de persona.affiliateCampaignId.
 */
export async function createAssistantOfferLink(
  ctx: OfferLinkContext & { bookmakerKey?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<CreatedOfferLink | null> {
  const tracking = ctx.bookmakerKey
    ? await personaBookmakerOfferTrackingLink(ctx.personaId, ctx.bookmakerKey)
    : await personaOfferTrackingLink(ctx.personaId);
  if (!tracking) return null;
  for (let attempt = 1; ; attempt++) {
    const subId = newSubId();
    try {
      const row = await prisma.assistantOfferLink.create({
        data: {
          subId,
          conversationId: ctx.conversationId,
          personaId: ctx.personaId,
          botId: ctx.botId,
          memberId: ctx.memberId,
          trackingLinkId: tracking.id,
          source: ctx.source,
        },
        select: { id: true },
      });
      return {
        url: assistantOfferUrl(subId, env),
        subId,
        trackingLinkId: tracking.id,
        offerLinkId: row.id,
      };
    } catch (err) {
      // Sub-ID déjà pris (hasard) : un autre, une seule fois.
      if (
        attempt < 2 &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      )
        continue;
      throw err;
    }
  }
}

/** Lien créé mais jamais parti (envoi du message en échec) : supprimé, aucun clic ne peut arriver. */
export async function dropUnsentOfferLink(subId: string): Promise<void> {
  await prisma.assistantOfferLink
    .deleteMany({ where: { subId, clickId: null, opens: 0 } })
    .catch((err: Error) =>
      logger.warn({ err: err.message }, "assistant : lien d'offre non envoyé impossible à retirer"),
    );
}
