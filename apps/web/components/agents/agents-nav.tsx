import { TabNav, type TabNavItem } from "@/components/admin/tab-nav";

export type AgentsSection =
  | "dashboard"
  | "ads"
  | "boss"
  | "orders"
  | "inspiration"
  | "bookmakers"
  | "montage"
  | "analyses"
  | "validations"
  | "journal"
  | "settings";

/**
 * Rubriques de Agents (phase 19) : tableau de bord du Grand Chef (et fiches d'équipe), validations et demandes,
 * journal, réglages (administrateurs seulement). Phase 24 : « Agent Ads » (`/agents/ads`), rattaché au Grand Chef,
 * n'est pas une équipe : il a son entrée à lui. Phase 26 : « Kevin » (`/agents/boss`), le bot à qui l'on parle.
 * Phase 27 : « Inspiration » (`/agents/inspiration`), les canaux exemples que Kevin lit.
 * Phase 33 : « Ordres » (`/agents/orders`), les ordres donnés aux équipes par Kevin.
 * Phase 35 : « Bookmakers » (`/agents/bookmakers`), les sites des bookmakers que le système lit lui-même.
 * Phase 28 : « Montage » (`/agents/montage`), les vidéos longues découpées en shorts et leur médiathèque.
 * Phase 29 : « Analyses » (`/agents/analyses`), la veille du marché, les règles publicitaires, les rapports et sources.
 * `pending` : validations à faire + demandes ouvertes (pastille).
 */
export function agentsSections(isAdmin: boolean, pending = 0): TabNavItem[] {
  const items: TabNavItem[] = [
    { key: "dashboard", href: "/agents", label: "Tableau de bord", short: "Équipes" },
    { key: "ads", href: "/agents/ads", label: "Agent Ads", short: "Pubs" },
    { key: "boss", href: "/agents/boss", label: "Kevin" },
    { key: "orders", href: "/agents/orders", label: "Ordres" },
    { key: "inspiration", href: "/agents/inspiration", label: "Inspiration" },
    { key: "bookmakers", href: "/agents/bookmakers", label: "Bookmakers" },
    { key: "montage", href: "/agents/montage", label: "Montage" },
    { key: "analyses", href: "/agents/analyses", label: "Analyses" },
    {
      key: "validations",
      href: "/agents/validations",
      label: "Validations",
      count: pending,
      ariaLabel: pending > 0 ? `Validations, ${pending} en attente` : undefined,
    },
    { key: "journal", href: "/agents/journal", label: "Journal" },
  ];
  if (isAdmin) items.push({ key: "settings", href: "/agents/settings", label: "Réglages" });
  return items;
}

export function AgentsNav({
  current,
  isAdmin,
  pending = 0,
}: {
  current: AgentsSection;
  isAdmin: boolean;
  pending?: number;
}) {
  return (
    <TabNav
      label="Rubriques Agents"
      current={current}
      items={agentsSections(isAdmin, pending)}
      phone="grid"
      columns={isAdmin ? 3 : 2}
    />
  );
}
