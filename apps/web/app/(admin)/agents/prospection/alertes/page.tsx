import type { Metadata } from "next";
import { AgentsNav } from "@/components/agents/agents-nav";
import { AlertsView } from "@/components/agents/prospection/alerts-view";
import { ProspectionNav } from "@/components/agents/prospection/prospection-nav";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { alertFilterParams, alertsHref, parseAlertFilters } from "@/lib/agents/prospection/advanced";
import { loadAlerts } from "@/lib/agents/prospection/advanced-queries";
import { loadScope } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Alertes" };
export const dynamic = "force-dynamic";

/**
 * Agents → Prospection → Alertes (phase 32) : ce que la veille remarque chez les canaux suivis et les affiliés signés,
 * filtrable par type, genre et statut ; « Vu », « Plus pour ce canal », « Couper ce type ».
 */
export default async function ProspectionAlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseAlertFilters(sp);
  const scope = await loadScope();
  const [pending, data] = await Promise.all([loadPendingCounts(), loadAlerts(filters, scope)]);
  const open = (data.counts.NEW ?? 0) + (data.counts.SENT ?? 0);
  return (
    <>
      <AgentsNav current="prospection" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Alertes de la prospection"
        description="La veille relit régulièrement les canaux suivis et vos affiliés signés, et vous prévient d'un changement utile : une marque lâchée, une forte hausse, un concurrent, un silence, un contact qui change. Personne n'est contacté."
        help="Écrivez à Kevin : « alertes du jour », « qui a lâché son bookmaker ? », « canaux en hausse », « plus d'alertes de ce type »."
      />
      <ProspectionNav current="alertes" openAlerts={open} />
      <Flash ok={sp.ok} error={sp.error} />
      <AlertsView data={data} filters={filters} back={alertsHref(alertFilterParams(filters))} />
    </>
  );
}
