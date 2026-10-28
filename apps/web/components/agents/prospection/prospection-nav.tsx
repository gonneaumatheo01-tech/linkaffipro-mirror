import { TabNav } from "@/components/admin/tab-nav";
import { AFFILIATES_PATH, ALERTS_PATH, NETWORKS_PATH, SOURCES_PATH, VALUE_PATH } from "@/lib/agents/prospection/advanced";
import { PROSPECTION_PATH } from "@/lib/agents/prospection/display";

export type ProspectionSection = "canaux" | "alertes" | "reseaux" | "valeur" | "affilies" | "sources";

/** Les six rubriques de la Prospection (phase 32 : alertes, réseaux, valeur, affiliés signés, sources étendues). */
export function prospectionSections(openAlerts = 0) {
  return [
    { key: "canaux", href: PROSPECTION_PATH, label: "Canaux" },
    {
      key: "alertes",
      href: ALERTS_PATH,
      label: "Alertes",
      count: openAlerts || undefined,
      ariaLabel: openAlerts ? `Alertes, ${openAlerts} à voir` : undefined,
    },
    { key: "reseaux", href: NETWORKS_PATH, label: "Réseaux" },
    { key: "valeur", href: VALUE_PATH, label: "Valeur estimée" },
    { key: "affilies", href: AFFILIATES_PATH, label: "Affiliés signés" },
    { key: "sources", href: SOURCES_PATH, label: "Sources" },
  ] satisfies Array<{ key: ProspectionSection; href: string; label: string; count?: number; ariaLabel?: string }>;
}

/**
 * Sous-navigation de la Prospection, sous la navigation des Agents : canaux trouvés, alertes de la veille, réseaux de
 * canaux, valeur estimée, affiliés signés, sources. La pastille des Alertes compte celles qui restent à voir.
 */
export function ProspectionNav({ current, openAlerts = 0 }: { current: ProspectionSection; openAlerts?: number }) {
  return <TabNav label="Rubriques de la prospection" current={current} items={prospectionSections(openAlerts)} />;
}
