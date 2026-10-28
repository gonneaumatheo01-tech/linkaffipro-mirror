import type { Metadata } from "next";
import { AgentsNav } from "@/components/agents/agents-nav";
import { AffiliatesView } from "@/components/agents/prospection/affiliates-view";
import { ProspectionNav } from "@/components/agents/prospection/prospection-nav";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { AFFILIATES_PATH } from "@/lib/agents/prospection/advanced";
import { loadAffiliates, loadOpenAlertsCount } from "@/lib/agents/prospection/advanced-queries";
import { loadScope } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Affiliés signés" };
export const dynamic = "force-dynamic";

/** Agents → Prospection → Affiliés signés (phase 32) : rattachement Link Affi, vrais résultats, estimé contre réel, suivi. */
export default async function ProspectionAffiliatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await loadScope();
  const [pending, rows, open] = await Promise.all([loadPendingCounts(), loadAffiliates(scope), loadOpenAlertsCount(scope)]);
  const active = rows.filter((r) => r.status === "ACTIVE").length;
  const unlinked = rows.filter((r) => !r.linkAffiAffiliateId && r.status !== "CHURNED").length;
  return (
    <>
      <AgentsNav current="prospection" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Affiliés signés"
        description="Les canaux qui ont signé, leurs vrais résultats lus chaque mois dans Link Affi (lecture seule) et la veille de leurs posts : nos liens, un concurrent, une phrase à risque. Information, jamais sanction : l'équipe n'écrit à personne."
        help="Écrivez à Kevin : « mes affiliés », « performance de @nom », « @nom = affilié 1234 », « estimé vs réel »."
      />
      <ProspectionNav current="affilies" openAlerts={open} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Signés" value={fmtNum(rows.length)} />
        <StatCard label="Actifs" value={fmtNum(active)} />
        <StatCard label="À rattacher à Link Affi" value={fmtNum(unlinked)} />
      </div>
      <AffiliatesView rows={rows} back={AFFILIATES_PATH} />
    </>
  );
}
