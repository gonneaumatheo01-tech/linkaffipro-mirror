import { prisma, type Vertical } from "@linkaffipro/db";

export type StatsOptions = {
  campaigns: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; title: string; vertical: Vertical | null }>;
};

/** Listes du sélecteur des statistiques : nos campagnes et les canaux actifs (lecture seule, ordre alphabétique). */
export async function loadStatsOptions(): Promise<StatsOptions> {
  const [campaigns, channels] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true },
    }),
  ]);
  return { campaigns, channels };
}
