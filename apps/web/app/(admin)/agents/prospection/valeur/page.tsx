import type { Metadata } from "next";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ProspectionNav } from "@/components/agents/prospection/prospection-nav";
import { ValueView } from "@/components/agents/prospection/value-view";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { VALUE_PATH } from "@/lib/agents/prospection/advanced";
import { loadOpenAlertsCount, loadValues } from "@/lib/agents/prospection/advanced-queries";
import { loadScope } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Valeur estimée" };
export const dynamic = "force-dynamic";

/** Agents → Prospection → Valeur estimée (phase 32) : fourchettes par canal et par étape, calibrage proposé. */
export default async function ProspectionValuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await loadScope();
  const [pending, data, open] = await Promise.all([loadPendingCounts(), loadValues(scope), loadOpenAlertsCount(scope)]);
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <AgentsNav current="prospection" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Valeur estimée"
        description="Ce que chaque canal pourrait rapporter par mois avec votre offre, toujours en fourchette (basse, probable, haute) avec sa confiance et ses hypothèses. Une estimation, jamais une promesse."
        help="Écrivez à Kevin : « combien vaut @nom ? », « valeur du pipeline », « calibrage », « applique 1 et 3 », « annule le calibrage »."
      />
      <ProspectionNav current="valeur" openAlerts={open} />
      <Flash ok={sp.ok} error={sp.error} />
      <ValueView data={data} isAdmin={isAdmin} back={VALUE_PATH} />
    </>
  );
}
