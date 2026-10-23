import { TabNav, type TabNavItem } from "@/components/admin/tab-nav";

export type AgentsSection = "dashboard" | "validations" | "journal" | "settings";

/**
 * Rubriques de Agents (phase 19) : tableau de bord du Grand Chef (et fiches d'équipe), validations et demandes,
 * journal, réglages (administrateurs seulement). `pending` : validations à faire + demandes ouvertes (pastille).
 */
export function agentsSections(isAdmin: boolean, pending = 0): TabNavItem[] {
  const items: TabNavItem[] = [
    { key: "dashboard", href: "/agents", label: "Tableau de bord", short: "Équipes" },
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
      columns={isAdmin ? 2 : 3}
    />
  );
}
