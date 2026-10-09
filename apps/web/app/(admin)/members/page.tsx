import type { Metadata } from "next";
import { SoonPage } from "@/components/admin/soon";
export const metadata: Metadata = { title: "Membres" };
export default function MembersPage() {
  return <SoonPage title="Membres" description="Fiches des membres Telegram et leur parcours." items={["Liste des membres avec canal d'origine, pub d'origine et bots joignables", "Fiche membre : demandes d'adhésion, messages reçus, clics, sub-ID, joueurs rattachés", "Suppression d'un membre sur demande (RGPD)"]} />;
}
