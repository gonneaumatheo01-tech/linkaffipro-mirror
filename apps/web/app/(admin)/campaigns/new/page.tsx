import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import {
  listActiveConnections,
  listImportedShells,
  listOfferCandidates,
} from "@/lib/campaigns/queries";
import { isRequestId, stepIndex, type WizardPayload } from "@/lib/campaigns/wizard";
import { CampaignWizard } from "./wizard";
import { createCampaignWizardAction } from "./actions";

export const metadata: Metadata = { title: "Nouvelle campagne" };

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  await requireUser();
  const sp = await searchParams;
  const [channels, offers, connections, importedCampaigns] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true, language: true },
    }),
    listOfferCandidates(),
    listActiveConnections(),
    listImportedShells(),
  ]);
  let draft: Partial<WizardPayload> | null = null;
  if (typeof sp.draft === "string") {
    try {
      const v = JSON.parse(sp.draft);
      if (v && typeof v === "object") draft = v as Partial<WizardPayload>;
    } catch {
      draft = null;
    }
  }
  return (
    <>
      <PageHeader
        backHref="/campaigns"
        backLabel="Campagnes"
        title="Nouvelle campagne"
        description="Quatre étapes ; à la fin, chaque pub reçoit son lien d'entrée. Tout reste modifiable ensuite."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <CampaignWizard
        action={createCampaignWizardAction}
        channels={channels}
        offers={offers}
        connections={connections}
        importedCampaigns={importedCampaigns}
        trackingHost={env.trackingBaseUrl.replace(/^https?:\/\//, "")}
        initialStep={stepIndex(typeof sp.step === "string" ? sp.step : null)}
        requestId={draft && isRequestId(draft.requestId) ? draft.requestId : randomUUID()}
        draft={draft}
      />
    </>
  );
}
