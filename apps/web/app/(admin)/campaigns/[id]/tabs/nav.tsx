import Link from "next/link";
import { ScrollToCurrent } from "@/components/admin/scroll-to-current";
import { cn } from "@/components/ui/cn";
import { CAMPAIGN_TABS, campaignTabHref, type CampaignTabKey } from "@/lib/campaigns/display";

/**
 * Barre d'onglets de la fiche campagne (liens, période conservée) ; chaque onglet commence par un titre et sa ligne
 * d'aide. Même présentation que les onglets de la fiche canal :
 * - ordinateur : barre soulignée (onglet actif souligné d'orange) ; si la fenêtre est étroite, la barre défile et
 *   l'onglet ouvert est ramené au centre ;
 * - téléphone : deux rangées de trois boutons de 44 px, libellés courts, sans défilement : les six onglets sont
 *   visibles d'un coup (aucun onglet caché hors de l'écran).
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
    <nav aria-label="Onglets de la campagne" className="mb-6 md:border-b md:border-border">
      <ScrollToCurrent
        currentKey={current}
        className="grid grid-cols-3 gap-2 md:-mb-px md:flex md:gap-1 md:overflow-x-auto"
      >
        {CAMPAIGN_TABS.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key} className="min-w-0 md:shrink-0">
              <Link
                href={campaignTabHref(id, t.key, keep)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex w-full items-center justify-center text-body whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  // Téléphone : bouton bordé ; ordinateur : onglet souligné.
                  "h-11 rounded-lg border px-2 md:h-10 md:w-auto md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-3",
                  active
                    ? "border-brand bg-brand-soft font-semibold text-foreground md:bg-transparent"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground md:border-transparent md:bg-transparent md:hover:border-border",
                )}
              >
                {t.short !== t.label ? (
                  <>
                    <span className="truncate md:hidden">{t.short}</span>
                    <span className="max-md:hidden">{t.label}</span>
                  </>
                ) : (
                  <span className="truncate">{t.label}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ScrollToCurrent>
    </nav>
  );
}
