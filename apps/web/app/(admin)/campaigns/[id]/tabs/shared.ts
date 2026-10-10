import type { Prisma } from "@linkaffipro/db";
import type { CampaignScope } from "@/lib/campaigns/attribution";
import type { Period } from "@/lib/periods";

/** Relations chargées une fois par la fiche, partagées par tous les onglets. */
export const campaignInclude = {
  connection: { select: { id: true, name: true, platform: true, status: true } },
  inviteLinks: { select: { id: true } },
  trackingLinks: { select: { id: true } },
  adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
} satisfies Prisma.CampaignInclude;

export type CampaignWithScope = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

export type TabProps = {
  id: string;
  campaign: CampaignWithScope;
  scope: CampaignScope;
  period: Period;
  compare: boolean;
  sp: Record<string, string | string[] | undefined>;
  /** Rôle ADMIN : boutons de suppression affichés (les MANAGER ne suppriment pas). */
  isAdmin: boolean;
};

export const selectCls = "h-10 rounded-md border bg-background px-3 text-sm md:h-9";
