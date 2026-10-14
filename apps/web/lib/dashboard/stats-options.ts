import { prisma, type Vertical } from "@linkaffipro/db";
import { loadAffiliateOptions } from "@/lib/affiliates/campaigns";
import type { AffiliateOption } from "@/lib/affiliates/scope";

export type StatsOptions = {
  campaigns: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; title: string; vertical: Vertical | null }>;
  /** Affiliés Link Affi connus par leurs campagnes Telegram (phase 13) ; vide sans campagne d'affilié. */
  affiliates?: AffiliateOption[];
};

/**
 * Listes du sélecteur des statistiques : nos campagnes, les canaux actifs et les affiliés Link Affi (lecture seule,
 * ordre alphabétique).
 */
export async function loadStatsOptions(): Promise<StatsOptions> {
  const [campaigns, channels, affiliates] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true },
    }),
    loadAffiliateOptions().catch(() => []),
  ]);
  return { campaigns, channels, affiliates };
}
