import type { Metadata } from "next";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ProspectionNav } from "@/components/agents/prospection/prospection-nav";
import { SourcesAdvanced } from "@/components/agents/prospection/sources-advanced";
import { SourcesView } from "@/components/agents/prospection/sources-view";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { SOURCES_PATH } from "@/lib/agents/prospection/advanced";
import { loadAccountSearch, loadAttribution, loadOpenAlertsCount } from "@/lib/agents/prospection/advanced-queries";
import { loadScope, loadSources } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Sources" };
export const dynamic = "force-dynamic";

/**
 * Agents → Prospection → Sources : où l'équipe trouve les canaux (phase 31 : état, pauses, passages, ajout à la main),
 * plus, depuis la phase 32, ce que rapporte chaque source et chaque pays, et la recherche par compte réel (la couper).
 */
export default async function ProspectionSourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await loadScope();
  const now = new Date();
  const [pending, sources, attribution, account, open] = await Promise.all([loadPendingCounts(), loadSources(scope, now), loadAttribution(scope), loadAccountSearch(now), loadOpenAlertsCount(scope)]);
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <AgentsNav current="prospection" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Sources de la prospection"
        description="Où l'équipe trouve les canaux, ce que chaque source rapporte (niveaux A, signés, actifs) et la recherche par compte réel. L'équipe ne contacte jamais personne."
        help="Écrivez à Kevin : « ajoute t.me/nom », « mets les annuaires en pause une semaine », « active la recherche par compte », « coupe la recherche par compte »."
      />
      <ProspectionNav current="sources" openAlerts={open} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="space-y-6">
        <SourcesView data={sources} isAdmin={isAdmin} />
        <SourcesAdvanced attribution={attribution} account={account} back={SOURCES_PATH} />
      </div>
    </>
  );
}
