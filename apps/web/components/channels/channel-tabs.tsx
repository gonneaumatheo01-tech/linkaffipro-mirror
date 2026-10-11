import { TabNav } from "@/components/admin/tab-nav";
import { requestsTabLabel } from "@/lib/channels/requests";
import { CHANNEL_TABS, channelTabHref, type ChannelTabKey } from "@/lib/channels/tabs";

/**
 * Onglets de la fiche canal (`TabNav`, liens `?tab=`), nombre de demandes en cours sur « Demandes ».
 * - Ordinateur : barre soulignée ; si la fenêtre est étroite, la barre défile et l'onglet ouvert est ramené au centre.
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
    <TabNav
      label="Onglets du canal"
      current={current}
      items={CHANNEL_TABS.map((t) => ({
        key: t.key,
        href: channelTabHref(channelId, t.key),
        label: t.label,
        short: t.short,
        ...(t.key === "requests" ? { count: pending, ariaLabel: requestsTabLabel(pending) } : {}),
      }))}
      phone="grid"
      columns={2}
    />
  );
}
