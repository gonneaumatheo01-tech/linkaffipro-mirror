import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/session";
import { CampaignForm } from "../campaign-form";
import { createCampaignAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle pub" };

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  await requireUser();
  const sp = await searchParams;
  const channels = await prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } });
  return (
    <>
      <PageHeader title="Nouvelle pub" description="Une pub regroupe des groupes et des pubs précises ; chaque pub précise se rattache à un lien d'entrée." />
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <CampaignForm action={createCampaignAction} values={{}} channels={channels} submitLabel="Créer la pub" />
        </CardContent>
      </Card>
    </>
  );
}
