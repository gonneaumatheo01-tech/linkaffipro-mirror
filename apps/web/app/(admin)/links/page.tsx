import type { Metadata } from "next";
import { SoonPage } from "@/components/admin/soon";
export const metadata: Metadata = { title: "Liens" };
export default function LinksPage() {
  return <SoonPage title="Liens" description="Liens traqués goolink.eu et liens d'invitation Telegram par pub." items={["Création d'un lien goolink.eu + lien d'invitation avec demande d'adhésion pour chaque pub", "Compteurs de clics (humains / robots), sources, paramètres ttclid / fbclid", "Attribution pub → membre → clic → sub-ID → inscription / dépôt"]} />;
}
