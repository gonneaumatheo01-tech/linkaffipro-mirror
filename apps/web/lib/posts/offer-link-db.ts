/**
 * Offre ajoutée comme lien dans le texte d'un message de canal (phase 12, D10), côté serveur : création du lien traqué
 * et rattachement des liens du texte au message enregistré. Règles pures : ./offer-link.ts.
 */
import { shortId } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { resolveOfferButton } from "@/lib/campaigns/offer-button";
import {
  replaceTrackedSlug,
  textOfferDestination,
  textOfferLabelError,
  textOfferLinkHtml,
  trackedLinkSlugs,
  TEXT_OFFER_LINK_SUFFIX,
} from "./offer-link";

/**
 * Crée le lien traqué d'une offre de campagne à mettre dans un texte (campagne et offre vérifiées comme un bouton
 * Offre). Lève une erreur lisible si la campagne ou l'offre est refusée.
 */
export async function createTextOfferLink(input: {
  campaignId: string;
  affiliateCampaignId: string;
  label: string;
  userId: string;
  trackingBaseUrl: string;
}): Promise<{ id: string; slug: string; url: string; html: string }> {
  const label = input.label.trim();
  const labelError = textOfferLabelError(label);
  if (labelError) throw new Error(labelError);
  const { offer, campaignId } = await resolveOfferButton({
    text: label,
    type: "OFFER",
    campaignId: input.campaignId,
    affiliateCampaignId: input.affiliateCampaignId,
  });
  const link = await prisma.trackingLink.create({
    data: {
      slug: shortId(8),
      kind: "BUTTON",
      destinationTemplate: textOfferDestination(offer.trackingUrlTemplate),
      label: `${label}${TEXT_OFFER_LINK_SUFFIX}`,
      campaignId,
      affiliateCampaignId: offer.id,
      createdById: input.userId,
    },
    select: { id: true, slug: true },
  });
  const url = `${input.trackingBaseUrl.replace(/\/$/, "")}/${link.slug}`;
  return { id: link.id, slug: link.slug, url, html: textOfferLinkHtml(url, label) };
}

/**
 * Rattache au message les liens d'offre de son texte (liens BUTTON vers une offre Link Affi) et renvoie le texte à
 * enregistrer : lien libre → rattaché (message et canal) ; lien déjà à ce message → canal mis à jour ; lien d'un autre
 * message → copie pour celui-ci (adresse remplacée dans le texte). Les autres liens du texte ne sont pas touchés.
 * `claimed` : liens libres rattachés par cet appel (à détacher si l'enregistrement échoue ensuite).
 */
export async function attachTextOfferLinks(
  html: string,
  post: { id: string; channelId: string },
  ctx: { userId: string; trackingBaseUrl: string },
): Promise<{ html: string; linkIds: string[]; claimed: string[] }> {
  const slugs = trackedLinkSlugs(html, ctx.trackingBaseUrl);
  if (slugs.length === 0) return { html, linkIds: [], claimed: [] };
  const links = await prisma.trackingLink.findMany({
    where: { slug: { in: slugs }, kind: "BUTTON", affiliateCampaignId: { not: null } },
  });
  let out = html;
  const linkIds: string[] = [];
  const claimed: string[] = [];
  for (const link of links) {
    if (link.postId === post.id) {
      if (link.channelId !== post.channelId)
        await prisma.trackingLink.update({
          where: { id: link.id },
          data: { channelId: post.channelId },
        });
      linkIds.push(link.id);
      continue;
    }
    if (link.postId === null) {
      // Lien tout neuf : rattaché à ce message, sauf si un autre enregistrement l'a pris entre-temps.
      const took = await prisma.trackingLink.updateMany({
        where: { id: link.id, postId: null },
        data: { postId: post.id, channelId: post.channelId, isActive: true },
      });
      if (took.count === 1) {
        linkIds.push(link.id);
        claimed.push(link.id);
        continue;
      }
    }
    const copy = await prisma.trackingLink.create({
      data: {
        slug: shortId(8),
        kind: "BUTTON",
        destinationTemplate: link.destinationTemplate,
        label: link.label,
        campaignId: link.campaignId,
        affiliateCampaignId: link.affiliateCampaignId,
        channelId: post.channelId,
        postId: post.id,
        createdById: ctx.userId,
      },
      select: { id: true, slug: true },
    });
    out = replaceTrackedSlug(out, ctx.trackingBaseUrl, link.slug, copy.slug);
    linkIds.push(copy.id);
  }
  return { html: out, linkIds, claimed };
}
