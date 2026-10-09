import { prisma } from "@linkaffipro/db";
import type { PostVariantStats } from "@linkaffipro/core";

export type PostVariantRow = PostVariantStats & {
  id: string;
  status: string;
  channelTitle: string;
  channelId: string;
  categoryName: string | null;
  scheduledAt: Date | null;
  sentAt: Date | null;
  text: string;
  buttons: unknown;
  mediaCount: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  deposits: number;
  depositAmount: number;
};

export type PostAbComparison = {
  groupId: string;
  variants: PostVariantRow[];
  sameChannel: boolean;
};

/**
 * Variantes d'un test A/B de canal avec leurs chiffres : `PostStats` (vues, réactions, clics, cliqueurs uniques,
 * clics offres, inscriptions, FTD, dépôts) recalculés par le worker. Null si le groupe n'existe pas.
 */
export async function loadPostAbComparison(groupId: string): Promise<PostAbComparison | null> {
  const posts = await prisma.post.findMany({
    where: { abGroupId: groupId },
    orderBy: { abVariant: "asc" },
    include: {
      channel: { select: { id: true, title: true } },
      category: { select: { name: true } },
      stats: true,
    },
  });
  if (posts.length === 0) return null;
  const variants: PostVariantRow[] = posts.map((p) => ({
    id: p.id,
    variant: p.abVariant ?? "?",
    status: p.status,
    sent: p.status === "SENT",
    channelId: p.channel.id,
    channelTitle: p.channel.title,
    categoryName: p.category?.name ?? null,
    scheduledAt: p.scheduledAt,
    sentAt: p.sentAt,
    text: p.text,
    buttons: p.buttons,
    mediaCount: Array.isArray(p.mediaAssetIds) ? (p.mediaAssetIds as unknown[]).length : 0,
    views: p.stats?.views ?? 0,
    clicks: p.stats?.clicks ?? 0,
    uniqueClickers: p.stats?.uniqueClickers ?? 0,
    reactionsTotal: p.stats?.reactionsTotal ?? 0,
    offerClicks: p.stats?.offerClicks ?? 0,
    registrations: p.stats?.registrations ?? 0,
    ftds: p.stats?.ftds ?? 0,
    deposits: p.stats?.deposits ?? 0,
    depositAmount: Number(p.stats?.depositAmount ?? 0),
  }));
  return {
    groupId,
    variants,
    sameChannel: new Set(variants.map((v) => v.channelId)).size === 1,
  };
}
