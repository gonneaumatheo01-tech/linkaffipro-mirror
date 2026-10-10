import Link from "next/link";
import { ScrollToCurrent } from "@/components/campaigns/scroll-to-current";
import { cn } from "@/components/ui/cn";
import { requestsTabLabel } from "@/lib/channels/requests";
import { CHANNEL_TABS, channelTabHref, type ChannelTabKey } from "@/lib/channels/tabs";
import { fmtNum } from "@/lib/format";

/**
 * Onglets de la fiche canal (liens `?tab=`), nombre de demandes en cours sur « Demandes ».
 * - Ordinateur : barre soulignée (onglet actif souligné d'orange) ; si la fenêtre est étroite, la barre défile et
 *   l'onglet ouvert est ramené au centre.
 * - Téléphone : deux rangées de deux boutons de 44 px, libellés courts, sans défilement : « Demandes » et son nombre
 *   sont visibles dès l'arrivée sur la fiche.
 */
export function ChannelTabs({
  channelId,
  current,
  pending,
}: {
  channelId: string;
  current: ChannelTabKey;
  pending: number;
}) {
  return (
    <nav aria-label="Onglets du canal" className="mb-6 md:border-b md:border-border">
      <ScrollToCurrent
        currentKey={current}
        className="grid grid-cols-2 gap-2 md:-mb-px md:flex md:gap-1 md:overflow-x-auto"
      >
        {CHANNEL_TABS.map((t) => {
          const active = t.key === current;
          const count = t.key === "requests" && pending > 0 ? pending : null;
          return (
            <li key={t.key} className="min-w-0 md:shrink-0">
              <Link
                href={channelTabHref(channelId, t.key)}
                aria-current={active ? "page" : undefined}
                aria-label={t.key === "requests" ? requestsTabLabel(pending) : undefined}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 text-body whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  // Téléphone : bouton bordé ; ordinateur : onglet souligné.
                  "h-11 rounded-lg border px-2 md:h-10 md:w-auto md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-3",
                  active
                    ? "border-brand bg-brand-soft font-semibold text-foreground md:bg-transparent"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground md:border-transparent md:bg-transparent md:hover:border-border",
                )}
              >
                <span className="truncate md:hidden">{t.short}</span>
                <span className="max-md:hidden">{t.label}</span>
                {count !== null ? (
                  <span
                    aria-hidden
                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft px-1.5 text-note font-semibold text-warning tabular-nums"
                  >
                    {fmtNum(count)}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ScrollToCurrent>
    </nav>
  );
}
