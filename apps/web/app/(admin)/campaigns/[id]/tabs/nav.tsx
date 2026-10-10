import Link from "next/link";
import { ScrollToCurrent } from "@/components/campaigns/scroll-to-current";
import { cn } from "@/components/ui/cn";
import { CAMPAIGN_TABS, campaignTabHref, type CampaignTabKey } from "@/lib/campaigns/display";

/**
 * Barre d'onglets de la fiche campagne (liens, période conservée) : onglet actif souligné d'orange ; chaque onglet
 * commence par un titre et sa ligne d'aide. Sur téléphone, la barre défile horizontalement (onglets de 40 px) et
 * l'onglet ouvert y est ramené au centre : il reste toujours visible.
 */
export function CampaignTabs({
  id,
  current,
  keep,
}: {
  id: string;
  current: CampaignTabKey;
  /** Paramètres à conserver (période, comparaison). */
  keep: Record<string, string | undefined>;
}) {
  return (
    <div className="mb-6">
      <nav aria-label="Onglets de la campagne" className="border-b border-border">
        <ScrollToCurrent currentKey={current} className="-mb-px flex gap-1 overflow-x-auto">
          {CAMPAIGN_TABS.map((t) => {
            const active = t.key === current;
            return (
              <li key={t.key} className="shrink-0">
                <Link
                  href={campaignTabHref(id, t.key, keep)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center border-b-2 px-3 text-body whitespace-nowrap transition-colors",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "border-brand font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ScrollToCurrent>
      </nav>
    </div>
  );
}
