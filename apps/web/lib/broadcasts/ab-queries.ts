import { prisma } from "@linkaffipro/db";
import type { VariantStats } from "./ab";
import { loadBroadcastResults } from "./results";

export type AbComparison = {
  groupId: string;
  name: string;
  botUsername: string;
  segment: unknown;
  variants: Array<VariantStats & { name: string; status: string; text: string; buttons: unknown; mediaAssetId: string | null; abSplit: number | null; createdAt: Date; finishedAt: Date | null }>;
  rest: (VariantStats & { name: string; status: string }) | null;
};

/** Statistiques comparées des variantes d'un test A/B (A, B et éventuel envoi au reste). */
export async function loadAbComparison(groupId: string): Promise<AbComparison | null> {
  const rows = await prisma.broadcast.findMany({ where: { abGroupId: groupId }, orderBy: { createdAt: "asc" }, include: { bot: { select: { username: true } } } });
  if (rows.length === 0) return null;
  const stats = await Promise.all(
    rows.map(async (b) => {
      // Clics, inscriptions et premiers dépôts : même lecture que la fiche d'un envoi (lib/broadcasts/results.ts).
      const r = await loadBroadcastResults(b.id);
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        text: b.text,
        buttons: b.buttons,
        mediaAssetId: b.mediaAssetId,
        variant: b.abVariant ?? "?",
        abSplit: b.abSplit,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
        targeted: b.targeted,
        sent: b.sent,
        failed: b.failed,
        blocked: b.blocked,
        clicks: r.clicks,
        uniqueClicks: r.uniqueClicks,
        offerClicks: r.offerClicks,
        registrations: r.registrations,
        ftds: r.ftds,
      };
    }),
  );
  const first = rows[0]!;
  return {
    groupId,
    name: first.name.replace(/ — [AB]$/, ""),
    botUsername: first.bot.username,
    segment: first.segment,
    variants: stats.filter((s) => s.variant === "A" || s.variant === "B"),
    rest: stats.find((s) => s.variant === "REST") ?? null,
  };
}
