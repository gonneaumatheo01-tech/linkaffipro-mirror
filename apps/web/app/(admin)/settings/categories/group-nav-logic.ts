/**
 * Pages de Réglages regroupées sous une même carte (docs/REFONTE-UX.md) : « Catégories et étiquettes » et
 * « Alertes et rapports ». Chaque page du groupe montre des onglets vers l'autre (lien croisé), dans l'ordre
 * des liens de la carte (`app/(admin)/settings/nav.ts`).
 */
export type SettingsGroupKey = "content" | "alerts";

export type SettingsGroupPage = {
  key: string;
  href: string;
  /** Libellé court de l'onglet (le titre complet est dans le `PageHeader`). */
  label: string;
};

export const SETTINGS_GROUPS: Record<
  SettingsGroupKey,
  { label: string; pages: SettingsGroupPage[] }
> = {
  content: {
    label: "Catégories et étiquettes",
    pages: [
      { key: "categories", href: "/settings/categories", label: "Catégories de messages" },
      { key: "tags", href: "/settings/tags", label: "Étiquettes de membres" },
    ],
  },
  alerts: {
    label: "Alertes et rapports",
    pages: [
      { key: "alerts", href: "/settings/alerts", label: "Alertes" },
      { key: "reports", href: "/settings/reports", label: "Rapports automatiques" },
    ],
  },
};

export type SettingsGroupTab = SettingsGroupPage & { active: boolean };

/** Onglets d'un groupe, la page ouverte marquée active (une seule ; aucune si `current` est inconnu). */
export function groupTabs(group: SettingsGroupKey, current: string): SettingsGroupTab[] {
  return SETTINGS_GROUPS[group].pages.map((p) => ({ ...p, active: p.key === current }));
}
