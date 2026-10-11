import { TabNav } from "@/components/admin/tab-nav";
import { CAMPAIGN_TABS, campaignTabHref, type CampaignTabKey } from "@/lib/campaigns/display";

/**
 * Barre d'onglets de la fiche campagne (`TabNav` : liens, période conservée) ; chaque onglet commence par un titre
 * et sa ligne d'aide. Même présentation que les onglets de la fiche canal :
 * - ordinateur : barre soulignée ; si la fenêtre est étroite, la barre défile et l'onglet ouvert est ramené au centre ;
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
    <TabNav
      label="Onglets de la campagne"
      current={current}
      items={CAMPAIGN_TABS.map((t) => ({
        key: t.key,
        href: campaignTabHref(id, t.key, keep),
        label: t.label,
        short: t.short,
      }))}
      phone="grid"
      columns={3}
    />
  );
}
