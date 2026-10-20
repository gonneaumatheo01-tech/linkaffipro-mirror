/**
 * Lien d'offre envoye par un compte reel (phase 18, tache 05). Meme logique que
 * apps/worker/src/assistant/offer-link.ts (le worker ne traite pas ces conversations) :
 * - lien suivi OFFER de la persona (meme nom court que le worker : un seul lien par persona et par offre, quel que
 *   soit le process qui l'a cree) ;
 * - `AssistantOfferLink` : un sub-ID neuf par envoi ;
 * - adresse envoyee `<adresse des liens>/a/<sub-ID>` : le site cree le `Click` a la premiere ouverture et redirige
 *   vers `trackingUrlTemplate` de l'offre avec ce sub-ID.
 */
import { createHash } from "node:crypto";
import { newSubId } from "@linkaffipro/core";
import { prisma, Prisma } from "@linkaffipro/db";
import { logger } from "./logger";

export type OfferLinkContext = {
  conversationId: string;
  personaId: string;
  botId: string;
  memberId: string;
  source: string | null;
};

export type CreatedOfferLink = { url: string; subId: string };

type NoOfferReason =
  | "persona_sans_offre"
  | "offre_introuvable"
  | "offre_inactive"
  | "offre_sans_modele_url"
  | "lien_suivi_desactive";

// ------------------------------------------------------------------
// Regles (copie de apps/worker/src/assistant/rules.ts : le nom court doit rester identique)
// ------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OFFER_SLUG_LENGTH = 10;

export function offerSlug(personaId: string, affiliateCampaignId: string): string {
  const digest = createHash("sha256")
    .update(`assistant-offer:${personaId}:${affiliateCampaignId}`)
    .digest();
  let out = "";
  for (let i = 0; i < OFFER_SLUG_LENGTH; i++) out += BASE62[digest[i]! % 62];
  return out;
}

export function offerLabel(personaName: string): string {
  return `Assistant « ${personaName} »`;
}

export function offerUrl(
  subId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.TRACKING_BASE_URL?.trim();
  const host = env.TRACKING_HOST?.trim();
  const root = base
    ? base.replace(/\/+$/, "")
    : host
      ? `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
      : "https://go.goolink.eu";
  return `${root}/a/${subId}`;
}

/** Offre exploitable : campagne active ET modele d'URL non vide (meme regle que `offerUsable` du worker). */
export function offerUsable(
  offer: { isActive: boolean; trackingUrlTemplate: string } | null | undefined,
): boolean {
  return Boolean(offer?.isActive && offer.trackingUrlTemplate.trim());
}

// ------------------------------------------------------------------
// Journal : une raison par persona n'est ecrite qu'une fois (sinon une ligne a chaque tour)
// ------------------------------------------------------------------

const loggedReasons = new Set<string>();

function noOffer(personaId: string, reason: NoOfferReason): null {
  const key = `${personaId}:${reason}`;
  if (!loggedReasons.has(key)) {
    loggedReasons.add(key);
    logger.warn({ persona: personaId, reason }, "lien d'offre impossible : aucun lien ne partira");
  }
  return null;
}

// ------------------------------------------------------------------
// Base
// ------------------------------------------------------------------

/** Lien OFFER de la persona (cree au premier envoi, reutilise ensuite), ou null avec la raison journalisee. */
async function personaOfferTrackingLink(personaId: string): Promise<{ id: string } | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { name: true, affiliateCampaignId: true, campaignId: true },
  });
  if (!persona?.affiliateCampaignId) return noOffer(personaId, "persona_sans_offre");
  const offer = await prisma.affiliateCampaign.findUnique({
    where: { id: persona.affiliateCampaignId },
    select: { id: true, isActive: true, trackingUrlTemplate: true },
  });
  if (!offer) return noOffer(personaId, "offre_introuvable");
  if (!offer.isActive) return noOffer(personaId, "offre_inactive");
  if (!offer.trackingUrlTemplate.trim()) return noOffer(personaId, "offre_sans_modele_url");

  const slug = offerSlug(personaId, offer.id);
  const label = offerLabel(persona.name);
  // Creation idempotente sur le nom court (le worker peut aussi l'avoir cree pour la meme persona).
  const link = await prisma.trackingLink.upsert({
    where: { slug },
    create: {
      slug,
      kind: "OFFER",
      destinationTemplate: offer.trackingUrlTemplate,
      label,
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
  // Lien desactive par l'equipe dans Campagnes → Liens : respecte.
  if (!link.isActive) return noOffer(personaId, "lien_suivi_desactive");
  // Adresse de l'offre, campagne ou prenom changes depuis : le lien les suit.
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

/** Cree le lien de CET envoi (sub-ID neuf), ou null si l'offre n'est pas exploitable. */
export async function createOfferLink(
  ctx: OfferLinkContext,
  env: Record<string, string | undefined> = process.env,
): Promise<CreatedOfferLink | null> {
  const tracking = await personaOfferTrackingLink(ctx.personaId);
  if (!tracking) return null;
  for (let attempt = 1; ; attempt++) {
    const subId = newSubId();
    try {
      await prisma.assistantOfferLink.create({
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
      return { url: offerUrl(subId, env), subId };
    } catch (err) {
      // Sub-ID deja pris (hasard) : un autre, une seule fois.
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

/** Lien cree mais jamais parti : retire, aucun clic ne peut arriver. Ne jette jamais. */
export async function dropUnsentOfferLink(subId: string): Promise<void> {
  await prisma.assistantOfferLink
    .deleteMany({ where: { subId, clickId: null, opens: 0 } })
    .catch((err: Error) =>
      logger.warn({ err: err.message }, "lien d'offre non envoye impossible a retirer"),
    );
}
