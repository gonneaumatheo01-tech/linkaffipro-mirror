import { prisma } from "@linkaffipro/db";
import type { VariantStats } from "./ab";

export type AbComparison = {
  groupId: string;
  name: string;
  botUsername: string;
  segment: unknown;
  variants: Array<VariantStats & { name: string; status: string; text: string; abSplit: number | null; createdAt: Date; finishedAt: Date | null }>;
  rest: (VariantStats & { name: string; status: string }) | null;
};

/** Statistiques comparées des variantes d'un test A/B (A, B et éventuel envoi au reste). */
export async function loadAbComparison(groupId: string): Promise<AbComparison | null> {
  const rows = await prisma.broadcast.findMany({ where: { abGroupId: groupId }, orderBy: { createdAt: "asc" }, include: { bot: { select: { username: true } } } });
  if (rows.length === 0) return null;
  const stats = await Promise.all(
    rows.map(async (b) => {
      const [links, registrations, ftds] = await Promise.all([
        prisma.trackingLink.findMany({ where: { post: { templateName: `broadcast:${b.id}` } }, select: { kind: true, clicks: true, uniqueClicks: true } }),
        prisma.player.count({ where: { click: { trackingLink: { post: { templateName: `broadcast:${b.id}` } } } } }),
        prisma.player.count({ where: { ftdAt: { not: null }, click: { trackingLink: { post: { templateName: `broadcast:${b.id}` } } } } }),
      ]);
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        text: b.text,
        variant: b.abVariant ?? "?",
        abSplit: b.abSplit,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
        targeted: b.targeted,
        sent: b.sent,
        failed: b.failed,
        blocked: b.blocked,
        clicks: links.reduce((n, l) => n + l.clicks, 0),
        uniqueClicks: links.reduce((n, l) => n + l.uniqueClicks, 0),
        offerClicks: links.filter((l) => l.kind === "OFFER").reduce((n, l) => n + l.clicks, 0),
        registrations,
        ftds,
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
