import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, audit } from "@linkaffipro/db";
import { Button } from "@/components/ui/button";
import { suggestAffiliateCampaign } from "@/lib/campaigns/match";
import { listOfferCandidates } from "@/lib/campaigns/queries";
import { visibleOffers } from "@/lib/campaigns/wizard";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import { requireUser } from "@/lib/session";

/**
 * Encart « Liaison suggérée » d'une fiche campagne : propose la campagne Link Affi (parmi nos offres) dont le nom
 * ressemble le plus au nom de la campagne, avec un bouton « Lier » qui ajoute son identifiant dans `Campaign.affiliateCampaignIds`.
 * Rien n'est affiché si la campagne est déjà liée ou si aucun nom ne ressemble.
 * Usage dans `campaigns/[id]/page.tsx` : `<LinkSuggestion campaignId={campaign.id} name={campaign.name} linkedIds={campaign.affiliateCampaignIds} />`
 */
export async function LinkSuggestion({
  campaignId,
  name,
  linkedIds,
}: {
  campaignId: string;
  name: string;
  linkedIds: unknown;
}) {
  const linked = Array.isArray(linkedIds)
    ? linkedIds.filter((x): x is string => typeof x === "string")
    : [];
  if (linked.length > 0) return null;
  // Seulement nos offres (même affilié que celles qui portent nos clics), quand on sait déjà les reconnaître.
  const candidates = visibleOffers(await listOfferCandidates(), false);
  const suggestion = suggestAffiliateCampaign(name, candidates);
  if (!suggestion) return null;
  const { candidate, score } = suggestion;

  async function linkAction(): Promise<void> {
    "use server";
    const user = await requireUser();
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { affiliateCampaignIds: true },
    });
    if (!campaign) redirect("/campaigns");
    const current = Array.isArray(campaign.affiliateCampaignIds)
      ? campaign.affiliateCampaignIds.filter((x): x is string => typeof x === "string")
      : [];
    if (!current.includes(candidate.id)) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { affiliateCampaignIds: [...current, candidate.id] },
      });
      await audit({
        userId: user.id,
        action: "campaign.affiliate_linked",
        entityType: "Campaign",
        entityId: campaignId,
        metadata: {
          affiliateCampaignId: candidate.id,
          affiliateCampaignName: candidate.name,
          score,
          suggested: true,
        },
      });
    }
    // Les joueurs de l'offre entrent dans la campagne : listes à jour et statistiques recalculées depuis le début.
    await refreshCampaignStats();
    revalidatePath(`/campaigns/${campaignId}`);
    redirect(
      `/campaigns/${campaignId}?ok=${encodeURIComponent(`Campagne liée à l'offre Link Affi « ${candidate.name} ».`)}`,
    );
  }

  return (
    <form
      action={linkAction}
      className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm"
    >
      <span>
        Liaison suggérée : <span className="font-medium">{candidate.name}</span>
        <span className="text-muted-foreground">
          {" "}
          ({candidate.programName}, ressemblance {Math.round(score * 100)} %)
        </span>
      </span>
      <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
        Lier
      </Button>
    </form>
  );
}
