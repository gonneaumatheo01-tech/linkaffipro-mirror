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
      <PageHeader title="Importer des coûts (CSV)" description="Export quotidien de TikTok Ads Manager ou Meta Ads Manager : les colonnes sont détectées, les pubs créées ou rattachées par nom, les coûts enregistrés par jour." />
      <Flash ok={sp.ok} error={sp.error} />
      <ImportWizard />
    </>
  );
}
