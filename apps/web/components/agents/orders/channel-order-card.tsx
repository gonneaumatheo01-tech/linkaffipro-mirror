import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { channelOverrideTitle, orderHref, orderTeamName } from "@/lib/agents/orders";
import { loadChannelOrderOverrides } from "@/lib/agents/orders-queries";

/**
 * Encart de la fiche d'un canal (phase 33) : « Réglage temporaire en cours jusqu'au … (ordre n°…) » quand un ordre de
 * Kevin a posé un réglage temporaire (`ChannelPlanOverride`) qui couvre aujourd'hui. Rien n'est affiché sinon.
 */
export async function ChannelOrderCard({ channelId, now = new Date() }: { channelId: string; now?: Date }) {
  const rows = await loadChannelOrderOverrides(channelId, now).catch(() => []);
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="ordre-en-cours"
      className="mb-6 space-y-2 rounded-xl border border-border bg-card px-4 py-3 md:px-6 md:py-4"
    >
      <h2 id="ordre-en-cours" className="flex items-center gap-2 text-body font-semibold text-foreground">
        <CalendarRange aria-hidden className="size-4 shrink-0" />
        {channelOverrideTitle(rows[0]!.toDay, rows[0]!.orderNumber)}
      </h2>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="text-note text-muted-foreground">
            {r.isTest ? `Travaillé comme un canal ${orderTeamName(r.teamKey)}, pour de faux. ` : `Équipe ${orderTeamName(r.teamKey)}. `}
            Le plan habituel du canal reprend tout seul à la fin.{" "}
            <Link href={orderHref(r.orderId)} className="text-info underline">
              Voir l&apos;ordre n°{r.orderNumber}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
