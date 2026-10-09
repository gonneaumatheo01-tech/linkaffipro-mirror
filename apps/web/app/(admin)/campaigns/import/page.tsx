import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { requireUser } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importer des coûts" };

export default async function ImportPage({ searchParams }: PageProps<"/campaigns/import">) {
  await requireUser();
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="Importer des coûts (CSV)"
        description="Exportez un rapport par jour depuis TikTok Ads Manager ou Meta Ads Manager : la plateforme et les colonnes sont reconnues, les pubs créées ou retrouvées par leur nom, les coûts enregistrés jour par jour."
        help="Étape 1 : choisissez le fichier et vérifiez les colonnes (mémorisées pour la prochaine fois). Étape 2 : contrôlez l'aperçu et les lignes ignorées. Étape 3 : confirmez. Un nouvel import du même jour remplace les coûts précédents ; un rapport s'affiche à la fin."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <ImportWizard />
    </>
  );
}
