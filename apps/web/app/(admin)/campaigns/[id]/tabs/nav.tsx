import Link from "next/link";

export const TABS = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "ads", label: "Pubs" },
  { key: "links", label: "Liens" },
  { key: "channels", label: "Canaux" },
  { key: "messages", label: "Messages" },
  { key: "members", label: "Membres" },
  { key: "offers", label: "Offres" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const TAB_HELP: Record<TabKey, string> = {
  overview: "Ce que la campagne coûte et rapporte sur la période : changez la période ou cochez « Comparer ».",
  ads: "La campagne pub (structure TikTok / Meta : groupes et pubs précises) et ses coûts, importés, reçus par API ou saisis.",
  links: "Un lien d'entrée par pub : copiez l'adresse go.goolink.eu dans la pub ; chaque clic ouvre l'invitation Telegram du canal.",
  channels: "Les canaux Telegram alimentés par cette campagne : ils servent aux filtres et aux messages de la campagne.",
  messages: "Les messages publiés dans les canaux de la campagne, ou portant un bouton Offre vers une de ses offres.",
  members: "Les membres arrivés par les liens d'entrée de la campagne.",
  offers: "Les campagnes Link Affi promues : le bouton Offre des messages utilise ces liens (avec sub-ID).",
};

export function parseTab(v: unknown): TabKey {
  const s = Array.isArray(v) ? v[0] : v;
  return (TABS.find((t) => t.key === s)?.key ?? "overview") as TabKey;
}

/** Barre d'onglets de la fiche campagne (liens `?tab=`, période conservée). */
export function CampaignTabs({ id, current, extra }: { id: string; current: TabKey; extra: Record<string, string> }) {
  return (
    <nav aria-label="Onglets de la campagne" className="mb-4 flex flex-wrap gap-1 border-b">
      {TABS.map((t) => {
        const q = new URLSearchParams({ ...extra, tab: t.key }).toString();
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={`/campaigns/${id}?${q}`}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
