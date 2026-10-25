import type { Metadata } from "next";
import Link from "next/link";
import { AgentsNav } from "@/components/agents/agents-nav";
import { RecommendationsView } from "@/components/agents/analyses/recommendations-view";
import { ReportsView } from "@/components/agents/analyses/reports-view";
import { RulesView } from "@/components/agents/analyses/rules-view";
import { SourcesView } from "@/components/agents/analyses/sources-view";
import { TrendsView } from "@/components/agents/analyses/trends-view";
import { FilterChips } from "@/components/admin/filter-chips";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ANALYSES_VIEWS, ANALYSES_VIEW_LABELS, parseAnalysesView, parseRuleFilters, parseTrendFilters, viewHref } from "@/lib/agents/analyses";
import {
  loadAnalysesCounts,
  loadMarketRecommendations,
  loadReports,
  loadRules,
  loadSources,
  loadTrends,
} from "@/lib/agents/analyses-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Analyses" };
export const dynamic = "force-dynamic";

const ASK_HINT =
  "Posez vos questions à Kevin en une phrase : « qu'est-ce qui marche en casino en France ? », « comment faire des pubs rencontres sans se faire bannir sur TikTok ? », « briefing paris sportifs Allemagne ».";

/**
 * Agents → Analyses (phase 29) : la veille du marché de l'équipe Analystes. Cinq vues : Tendances (par défaut),
 * Règles publicitaires, Rapports, Sources, Recommandations. Tout le monde lit ; les sources se gèrent par les
 * administrateurs ; accepter ou refuser une recommandation est ouvert aux responsables (aucune action externe).
 */
export default async function AgentsAnalysesPage({ searchParams }: PageProps<"/agents/analyses">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const view = parseAnalysesView(sp.vue);
  const trendFilters = parseTrendFilters(sp);
  const ruleFilters = parseRuleFilters(sp);
  const now = new Date();
  const [pending, counts, trends, rules, reports, sources, recs] = await Promise.all([
    loadPendingCounts(),
    loadAnalysesCounts(),
    view === "tendances" ? loadTrends(trendFilters, now) : Promise.resolve(null),
    view === "regles" ? loadRules(ruleFilters) : Promise.resolve(null),
    view === "rapports" ? loadReports() : Promise.resolve(null),
    view === "sources" ? loadSources() : Promise.resolve(null),
    view === "recommandations" ? loadMarketRecommendations() : Promise.resolve(null),
  ]);
  const chipCount: Partial<Record<(typeof ANALYSES_VIEWS)[number], number>> = {
    sources: counts.sourcesInError + counts.sourcesProposed || undefined,
    recommandations: counts.recsOpen || undefined,
  };

  return (
    <>
      <AgentsNav current="analyses" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Analyses"
        description="La veille du marché : ce qui marche ailleurs en casino, paris sportifs et rencontres, pays par pays, ce qui fait bannir chez Meta et TikTok, et les recommandations de l'équipe. Chaque information porte sa source. L'équipe recommande, vous décidez."
        help={ASK_HINT}
        secondaryActions={
          <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Parler à Kevin
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <FilterChips
        label="Vue"
        className="mb-6"
        chips={ANALYSES_VIEWS.map((v) => ({
          key: v,
          label: ANALYSES_VIEW_LABELS[v],
          href: viewHref(v),
          selected: view === v,
          count: chipCount[v],
        }))}
      />

      {trends ? <TrendsView filters={trendFilters} rows={trends.rows} total={trends.total} weekDates={trends.weekDates} now={now} /> : null}
      {rules ? <RulesView filters={ruleFilters} rows={rules} /> : null}
      {reports ? <ReportsView rows={reports} /> : null}
      {sources ? <SourcesView rows={sources} isAdmin={isAdmin} /> : null}
      {recs ? <RecommendationsView recs={recs} /> : null}
    </>
  );
}
