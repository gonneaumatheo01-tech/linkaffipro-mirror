import { TabNav } from "@/components/admin/tab-nav";

export type ConversationsSection = "inbox" | "personas" | "stats";

/** Les trois rubriques de Conversations (assistant de conversation, phase 17). */
export const CONVERSATIONS_SECTIONS: Array<{
  key: ConversationsSection;
  href: string;
  label: string;
}> = [
  { key: "inbox", href: "/conversations", label: "Boîte de réception" },
  { key: "personas", href: "/conversations/personas", label: "Personas" },
  { key: "stats", href: "/conversations/stats", label: "Chiffres" },
];

/**
 * Sous-navigation de la rubrique Conversations, en haut de ses pages : Boîte de réception, Personas, Chiffres
 * (`TabNav`). Ordinateur : onglets soulignés ; téléphone : trois boutons d'au moins 44 px côte à côte, sans
 * défilement. À placer avant le `PageHeader` : `<ConversationsNav current="personas" />` (fiche d'une conversation
 * ou d'une persona comprise : l'onglet de sa rubrique reste allumé).
 */
export function ConversationsNav({
  current,
  className,
}: {
  current: ConversationsSection;
  className?: string;
}) {
  return (
    <TabNav
      label="Rubriques Conversations"
      current={current}
      items={CONVERSATIONS_SECTIONS}
      phone="grid"
      columns={3}
      className={className}
    />
  );
}
