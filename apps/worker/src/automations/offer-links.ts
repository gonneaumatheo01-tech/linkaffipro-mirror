/**
 * Boutons d'un message de relance au moment de l'envoi (phase 10) : un lien simple part tel quel ; un bouton
 * « Offre (campagne) » devient le lien du bot propre à la relance, exactement comme un bouton Offre d'un message de
 * canal ou d'un message à un groupe :
 * - un lien traqué `TrackingLink` (kind OFFER) par relance et par bouton Offre, rattaché à la relance
 *   (`automationRuleId`), à notre campagne (`campaignId`) et à l'offre Link Affi (`affiliateCampaignId`) ; son nom
 *   court est calculé à partir de (relance, campagne, offre) : le même lien sert à tous les envois de la relance,
 *   sans doublon même si deux membres sont servis en même temps, et une copie de la relance a le sien ;
 * - le bouton ouvre le bot qui écrit (`https://t.me/<bot>?start=o<slug>`) ; au clic, le bot crée un identifiant de
 *   suivi neuf (sub-ID) pour CE membre, enregistre le clic (`Click.memberId`, `Click.trackingLinkId`) et répond avec
 *   le lien Link Affi portant ce sub-ID (`packages/telegram/src/handlers/offers.ts`). Les inscriptions, premiers
 *   dépôts et commissions qui reviennent par ce sub-ID sont ainsi attribués à la relance.
 */
import { createHash } from "node:crypto";
import {
  isOfferButton,
  jsonIds,
  type AutomationButton,
  type AutomationOfferButton,
} from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import type { DmButton } from "@linkaffipro/queue";
import { offerDeepLink } from "@linkaffipro/telegram";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 10 caractères : jamais confondu avec les noms courts tirés au hasard (8 caractères), accepté par le bot (6 à 10). */
export const AUTOMATION_OFFER_SLUG_LENGTH = 10;

/** Nom court du lien Offre d'une relance : stable pour (relance, campagne, offre du bouton). */
export function automationOfferSlug(
  ruleId: string,
  campaignId: string,
  affiliateCampaignId: string,
): string {
  const digest = createHash("sha256")
    .update(`automation-offer:${ruleId}:${campaignId}:${affiliateCampaignId}`)
    .digest();
  let out = "";
  for (let i = 0; i < AUTOMATION_OFFER_SLUG_LENGTH; i++) out += BASE62[digest[i]! % 62];
  return out;
}

/** Nom du lien dans Campagnes → Liens (« Voir l'offre (relance « Bienvenue ») »). */
export function automationLinkLabel(text: string, ruleName: string): string {
  return `${text} (relance « ${ruleName} »)`;
}

type OfferRow = { id: string; isActive: boolean; trackingUrlTemplate: string };

/**
 * Offre Link Affi du lien à créer : celle du bouton si elle est toujours dans la campagne et active, sinon la première
 * offre active de la campagne (même règle que le bot au clic, `pickCampaignOffer` de packages/telegram/src/offers).
 */
export function offerForLink(
  buttonOfferId: string,
  campaignOfferIds: readonly string[],
  offers: readonly OfferRow[],
): OfferRow | null {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const own = byId.get(buttonOfferId);
  if (own && own.isActive && own.trackingUrlTemplate && campaignOfferIds.includes(own.id))
    return own;
  for (const id of campaignOfferIds) {
    const o = byId.get(id);
    if (o && o.isActive && o.trackingUrlTemplate) return o;
  }
  return null;
}

export type AutomationLinkContext = { ruleId: string; ruleName: string; botUsername: string };

/**
 * Lien du bot d'un bouton Offre de la relance (lien traqué créé au premier envoi, puis réutilisé). Renvoie null si le
 * lien a été désactivé par l'équipe (Campagnes → Liens) : le bouton n'est pas envoyé. À CHAQUE envoi (lien neuf ou
 * déjà créé), la campagne est relue : si elle a été supprimée (le lien reste mais n'est plus rattaché à une campagne)
 * ou n'a plus d'offre active, une erreur en français est levée (l'exécution passe en erreur, visible dans le journal).
 * L'offre du lien suit la campagne : celle du bouton dès qu'elle y est (de nouveau) active, sinon l'offre de repli.
 */
export async function automationOfferUrl(
  b: AutomationOfferButton,
  ctx: AutomationLinkContext,
): Promise<string | null> {
  const slug = automationOfferSlug(ctx.ruleId, b.campaignId, b.affiliateCampaignId);
  const existing = await prisma.trackingLink.findUnique({
    where: { slug },
    select: {
      slug: true,
      isActive: true,
      campaignId: true,
      affiliateCampaignId: true,
      destinationTemplate: true,
    },
  });
  if (existing && !existing.isActive) return null;
  const deleted = new Error(
    `Bouton « ${b.text} » : la campagne de l'offre a été supprimée ; choisissez-en une autre dans la relance.`,
  );
  if (existing && !existing.campaignId) throw deleted;
  const campaign = await prisma.campaign.findUnique({
    where: { id: b.campaignId },
    select: { name: true, affiliateCampaignIds: true },
  });
  if (!campaign) throw deleted;
  const ids = jsonIds(campaign.affiliateCampaignIds);
  const offers = await prisma.affiliateCampaign.findMany({
    where: { id: { in: [...new Set([b.affiliateCampaignId, ...ids])] } },
    select: { id: true, isActive: true, trackingUrlTemplate: true },
  });
  const offer = offerForLink(b.affiliateCampaignId, ids, offers);
  if (!offer)
    throw new Error(
      `Bouton « ${b.text} » : la campagne « ${campaign.name} » n'a plus d'offre active ; ajoutez-lui une offre (fiche de la campagne).`,
    );
  if (!existing) {
    // Création idempotente sur le nom court (deux envois simultanés ne créent qu'un lien).
    const link = await prisma.trackingLink.upsert({
      where: { slug },
      create: {
        slug,
        kind: "OFFER",
        destinationTemplate: offer.trackingUrlTemplate,
        label: automationLinkLabel(b.text, ctx.ruleName),
        affiliateCampaignId: offer.id,
        campaignId: b.campaignId,
        automationRuleId: ctx.ruleId,
      },
      update: {},
      select: { slug: true, isActive: true },
    });
    return link.isActive ? offerDeepLink(ctx.botUsername, link.slug) : null;
  }
  // Offre retenue changée (offre du bouton revenue dans la campagne, ou remplacée) : le lien la suit.
  if (
    existing.affiliateCampaignId !== offer.id ||
    existing.destinationTemplate !== offer.trackingUrlTemplate
  )
    await prisma.trackingLink.update({
      where: { slug },
      data: { affiliateCampaignId: offer.id, destinationTemplate: offer.trackingUrlTemplate },
    });
  return offerDeepLink(ctx.botUsername, existing.slug);
}

/**
 * Boutons d'un message de relance → lignes `{ text, url }` du message privé. `dropped` : libellés des boutons Offre
 * non envoyés (lien désactivé), pour le journal de l'exécution.
 */
export async function resolveAutomationButtons(
  rows: readonly (readonly AutomationButton[])[] | undefined,
  ctx: AutomationLinkContext,
): Promise<{ rows: DmButton[][]; dropped: string[] }> {
  const out: DmButton[][] = [];
  const dropped: string[] = [];
  for (const row of rows ?? []) {
    const line: DmButton[] = [];
    for (const b of row) {
      if (!isOfferButton(b)) {
        line.push({ text: b.text, url: b.url });
        continue;
      }
      const url = await automationOfferUrl(b, ctx);
      if (url) line.push({ text: b.text, url });
      else dropped.push(b.text);
    }
    if (line.length > 0) out.push(line);
  }
  return { rows: out, dropped };
}
