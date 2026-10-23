/**
 * Offre du moment d'un canal casino : la campagne liée au plan du canal (bouton Offre). Ce que le texte peut en dire :
 * le nom de l'offre (première offre Link Affi active de la campagne, sinon le nom de la campagne) et la fiche de l'offre
 * quand l'équipe en a écrit une (`Persona.offerPitch` d'un profil rattaché à cette campagne ou à son offre, même
 * source que l'assistante de conversation). Sans fiche : le nom seulement, aucun chiffre.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { jsonIds } from "@linkaffipro/core";

export type CasinoOffer = {
  campaignId: string;
  campaignName: string;
  /** Nom affichable de l'offre. */
  name: string;
  /** Fiche de l'offre (seule source des chiffres et promesses), ou null. */
  facts: string | null;
  /** Une offre Link Affi active avec un lien : le bouton Offre peut partir. */
  buttonReady: boolean;
};

export async function loadCasinoOffer(prisma: PrismaClient, campaignId: string | null | undefined): Promise<CasinoOffer | null> {
  if (!campaignId) return null;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true, affiliateCampaignIds: true } });
  if (!campaign) return null;
  const ids = jsonIds(campaign.affiliateCampaignIds);
  const offers = ids.length
    ? await prisma.affiliateCampaign.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true, trackingUrlTemplate: true } })
    : [];
  const byId = new Map(offers.map((o) => [o.id, o]));
  const active = ids.map((id) => byId.get(id)).find((o) => o && o.isActive && o.trackingUrlTemplate) ?? null;
  const personas = await prisma.persona.findMany({
    where: { OR: [{ campaignId: campaign.id }, ...(ids.length ? [{ affiliateCampaignId: { in: ids } }] : [])] },
    orderBy: { createdAt: "asc" },
    select: { offerPitch: true },
  });
  const facts = personas.map((p) => p.offerPitch?.trim()).find((t): t is string => !!t) ?? null;
  return { campaignId: campaign.id, campaignName: campaign.name, name: active?.name ?? campaign.name, facts: facts ? facts.slice(0, 1500) : null, buttonReady: !!active };
}
