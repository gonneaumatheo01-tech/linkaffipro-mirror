import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ReportContent } from "@/components/agents/analyses/reports-view";
import { PageHeader } from "@/components/admin/page-header";
import { safeAnalysesId, viewHref } from "@/lib/agents/analyses";
import { loadReport } from "@/lib/agents/analyses-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Rapport d'analyse" };
export const dynamic = "force-dynamic";

/** Lecture en ligne d'un rapport de l'équipe Analystes (rapport du lundi ou briefing à la demande). */
export default async function AnalysesReportPage({ params }: PageProps<"/agents/analyses/rapports/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const safe = safeAnalysesId(id);
  if (!safe) notFound();
  const [report, pending] = await Promise.all([loadReport(safe), loadPendingCounts()]);
  if (!report) notFound();
  return (
    <>
      <AgentsNav current="analyses" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader title={report.title} backHref={viewHref("rapports")} backLabel="Tous les rapports" />
      <ReportContent report={report} />
    </>
  );
}
