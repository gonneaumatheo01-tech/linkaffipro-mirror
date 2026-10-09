import type { Metadata } from "next";
import { SoonPage } from "@/components/admin/soon";
export const metadata: Metadata = { title: "Messages" };
export default function MessagesPage() {
  return <SoonPage title="Messages" description="Messages programmés et envois ciblés." items={["Calendrier de publication par canal sur plusieurs semaines", "Boutons personnalisés avec sub-ID par membre et par message", "Modèles multilingues et catégories", "Statistiques par message (vues, clics, inscriptions, dépôts)"]} />;
}
