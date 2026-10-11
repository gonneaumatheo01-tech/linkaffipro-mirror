import { TabNav } from "@/components/admin/tab-nav";

export type MembersSection = "list" | "broadcasts" | "automations";

/** Les trois rubriques de Membres. */
export const MEMBERS_SECTIONS: Array<{ key: MembersSection; href: string; label: string }> = [
  { key: "list", href: "/members", label: "Liste des membres" },
  { key: "broadcasts", href: "/members/broadcasts", label: "Écrire à un groupe" },
  { key: "automations", href: "/members/automations", label: "Relances automatiques" },
];

/**
 * Sous-navigation de la rubrique Membres, en haut des trois pages : Liste, Écrire à un groupe, Relances automatiques
 * (`TabNav`). Ordinateur : onglets soulignés ; téléphone : trois boutons d'au moins 44 px côte à côte, libellé
 * complet sur deux lignes, sans défilement. À placer avant le `PageHeader` : `<MembersNav current="broadcasts" />`.
 */
export function MembersNav({
  current,
  className,
}: {
  current: MembersSection;
  className?: string;
}) {
  return (
    <TabNav
      label="Rubriques Membres"
      current={current}
      items={MEMBERS_SECTIONS}
      phone="grid"
      columns={3}
      className={className}
    />
  );
}
