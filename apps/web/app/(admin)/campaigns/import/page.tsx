import type { Metadata } from "next";
import Link from "next/link";
import { FileClock } from "lucide-react";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { requireUser } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importer des dépenses" };

export default async function ImportPage({ searchParams }: PageProps<"/campaigns/import">) {
  await requireUser();
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        backHref="/campaigns"
        backLabel="Campagnes"
        title="Importer des dépenses (CSV)"
        description="Le rapport par jour de TikTok ou Meta : colonnes reconnues, campagnes pub retrouvées par leur nom, dépenses enregistrées jour par jour."
        secondaryActions={
          <Link
            href="/campaigns/imports"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <FileClock aria-hidden />
            Historique des imports
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <ImportWizard />
    </>
  );
}
