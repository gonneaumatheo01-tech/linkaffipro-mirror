import { TabNav } from "@/components/admin/tab-nav";

const JOURNAL_TABS = [
  { key: "actions", label: "Actions de l'équipe", href: "/settings/journal" },
  { key: "events", label: "Bots et membres", href: "/settings/journal/events" },
];

/**
 * Onglets du Journal (`TabNav`) : actions de l'équipe (AuditLog) ou activité des bots et des membres (Event). Liens
 * (chaque vue a son adresse) ; l'onglet ouvert est souligné d'orange ; sur téléphone, une rangée qui défile si besoin.
 */
export function ViewTabs({ view }: { view: "actions" | "events" }) {
  return <TabNav label="Vues du journal" current={view} items={JOURNAL_TABS} />;
}
