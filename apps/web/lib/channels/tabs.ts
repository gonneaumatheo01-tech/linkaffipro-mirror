/** Onglets de la fiche canal (`?tab=`). Les clés restent celles des anciennes adresses (liens de l'accueil). */
/**
 * `short` : libellé sur téléphone, où les quatre onglets tiennent en deux rangées de deux, sans défilement (l'onglet
 * « Demandes » et son nombre restent toujours visibles).
 */
export const CHANNEL_TABS = [
  { key: "rules", label: "Qui peut entrer et quand", short: "Qui peut entrer" },
  { key: "sequences", label: "Ce que dit le bot", short: "Ce que dit le bot" },
  { key: "requests", label: "Demandes", short: "Demandes" },
  { key: "members", label: "Membres", short: "Membres" },
] as const;

export type ChannelTabKey = (typeof CHANNEL_TABS)[number]["key"];

/** Onglet demandé, « Qui peut entrer et quand » par défaut (l'ancien `besthours` aussi : il est retiré). */
export function parseChannelTab(value: unknown): ChannelTabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return CHANNEL_TABS.some((t) => t.key === v) ? (v as ChannelTabKey) : "rules";
}

export function channelTabHref(channelId: string, tab: ChannelTabKey): string {
  return `/channels/${encodeURIComponent(channelId)}?tab=${tab}`;
}

/** Calendrier des messages du canal, où sont montrés les meilleurs créneaux (ex-onglet « Meilleurs horaires »). */
export function bestSlotsHref(channelId: string): string {
  return `/messages?${new URLSearchParams({ channelId }).toString()}`;
}
