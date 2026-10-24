import { TabNav, type TabNavItem } from "@/components/admin/tab-nav";

export type AgentsSection = "dashboard" | "ads" | "validations" | "journal" | "settings";

/**
 * Rubriques de Agents (phase 19) : tableau de bord du Grand Chef (et fiches d'équipe), validations et demandes,
 * journal, réglages (administrateurs seulement). Phase 24 : « Agent Ads » (`/agents/ads`), rattaché au Grand Chef,
 * n'est pas une équipe : il a son entrée à lui. `pending` : validations à faire + demandes ouvertes (pastille).
 */
export function agentsSections(isAdmin: boolean, pending = 0): TabNavItem[] {
  const items: TabNavItem[] = [
    { key: "dashboard", href: "/agents", label: "Tableau de bord", short: "Équipes" },
    { key: "ads", href: "/agents/ads", label: "Agent Ads", short: "Pubs" },
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
