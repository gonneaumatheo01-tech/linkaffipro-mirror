import { prisma, type Prisma, type TrackingLinkKind } from "@linkaffipro/db";
import { linkLabel } from "./label";

export const LINKS_PAGE_SIZE = 50;

const linkInclude = {
  inviteLink: { select: { name: true, requests: true, approved: true, joined: true, adPlatform: true, telegramInviteLink: true } },
  channel: { select: { title: true } },
  post: { select: { id: true, code: true, scheduledAt: true } },
  affiliateCampaign: { select: { name: true } },
} satisfies Prisma.TrackingLinkInclude;

export type LinkRow = Prisma.TrackingLinkGetPayload<{ include: typeof linkInclude }>;
export type LinkAgg = { registrations: number; ftds: number };
export type LinkPage = { rows: LinkRow[]; total: number; pages: number; page: number; agg: Map<string, LinkAgg> };

/**
 * Une page de liens traqués d'un ou plusieurs types (du plus récent au plus ancien), avec le nombre
 * d'inscriptions et de FTD rattachés à chaque lien de la page (joueurs reliés par clic).
 */
export async function listLinksPage(kinds: TrackingLinkKind[], page: number, size = LINKS_PAGE_SIZE): Promise<LinkPage> {
  const where: Prisma.TrackingLinkWhereInput = { kind: { in: kinds } };
  const current = Math.max(1, page);
  const [total, rows] = await Promise.all([
    prisma.trackingLink.count({ where }),
    prisma.trackingLink.findMany({ where, orderBy: { createdAt: "desc" }, skip: (current - 1) * size, take: size, include: linkInclude }),
  ]);
  const ids = rows.map((r) => r.id);
  const players = ids.length
    ? await prisma.player.findMany({ where: { click: { trackingLinkId: { in: ids } } }, select: { registeredAt: true, ftdAt: true, click: { select: { trackingLinkId: true } } } })
    : [];
  const agg = new Map<string, LinkAgg>();
  for (const p of players) {
    const id = p.click?.trackingLinkId;
    if (!id) continue;
    const a = agg.get(id) ?? { registrations: 0, ftds: 0 };
    if (p.registeredAt) a.registrations++;
    if (p.ftdAt) a.ftds++;
    agg.set(id, a);
  }
  // Nom affiché : l'ancien repère « (envoi groupé) » devient « (message à un groupe) » (voir ./label).
  const shown = rows.map((r) => ({ ...r, label: linkLabel(r.label) }));
  return { rows: shown, total, pages: Math.max(1, Math.ceil(total / size)), page: current, agg };
}
