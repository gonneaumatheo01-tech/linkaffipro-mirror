import { prisma } from "@linkaffipro/db";
import { eventLabel } from "@/lib/journal/event-labels";
import { VISIBLE_EVENT_WHERE } from "@/lib/journal/events";

export type LastEvent = {
  id: string;
  type: string;
  label: string;
  occurredAt: Date;
  bot: { username: string } | null;
  channel: { title: string } | null;
  member: { id: string; firstName: string | null; username: string | null } | null;
};

/**
 * Derniers événements du tableau de bord (les plus récents d'abord), avec leur libellé en français. Les événements
 * joueurs sans membre (activité Link Affi d'autres affiliés) en sont exclus (voir `VISIBLE_EVENT_WHERE`).
 */
export async function loadLastEvents(take = 12): Promise<LastEvent[]> {
  const rows = await prisma.event.findMany({
    where: VISIBLE_EVENT_WHERE,
    orderBy: { occurredAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      bot: { select: { username: true } },
      channel: { select: { title: true } },
      member: { select: { id: true, firstName: true, username: true } },
    },
  });
  return rows.map((e) => ({ ...e, label: eventLabel(e.type) }));
}
