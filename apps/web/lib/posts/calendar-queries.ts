import { prisma } from "@linkaffipro/db";
import { isAlgoSource, parseChannelBestHours, type ChannelBestHours } from "@/lib/besthours/types";

/**
 * Meilleurs horaires calculés par le worker (`Setting` `besthours.<channelId>`) pour les canaux donnés : lecture
 * seule, même format que la fiche canal. Les entrées illisibles sont ignorées.
 */
export async function loadChannelsBestHours(channelIds: string[]): Promise<ChannelBestHours[]> {
  if (channelIds.length === 0) return [];
  const rows = await prisma.setting.findMany({
    where: { key: { in: channelIds.map((id) => `besthours.${id}`) } },
    select: { value: true },
  });
  return rows
    .map((r) => parseChannelBestHours(r.value))
    .filter((d): d is ChannelBestHours => d !== null && channelIds.includes(d.channelId));
}

/**
 * Revenu net (NGR) rattaché à un message : somme des événements NGR datés des joueurs venus d'un clic sur ce
 * message (identifiant de suivi), jamais `Player.ngr`. Ces joueurs sont « nos joueurs » par définition (rattachés
 * à un de nos clics).
 */
export async function postNetRevenue(postId: string): Promise<number> {
  const r = await prisma.playerEvent.aggregate({
    _sum: { amount: true },
    where: { type: "NGR", player: { click: { postId } } },
  });
  return Number(r._sum.amount ?? 0);
}

/** Phase 21 : le réglage commun `besthours.source` dit-il que les meilleurs horaires viennent de l'équipe Algorithme ? */
export async function loadBestHoursFromAlgo(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: "besthours.source" }, select: { value: true } });
  return isAlgoSource(row?.value ?? null);
}
