import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { DictionariesView } from "@/components/agents/prospection/dict-view";
import { OffersView } from "@/components/agents/prospection/offers-view";
import { PipelineView } from "@/components/agents/prospection/pipeline-view";
import { ProspectFiltersForm } from "@/components/agents/prospection/prospect-filters";
import { ProspectsTable } from "@/components/agents/prospection/prospects-table";
import { ProspectionSettingsView } from "@/components/agents/prospection/settings-view";
import { SourcesView } from "@/components/agents/prospection/sources-view";
import { FilterChips } from "@/components/admin/filter-chips";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { exportRedirect } from "@/lib/agents/prospection/export-link";
import {
  PROSPECTION_VIEWS,
  PROSPECTION_VIEW_LABELS,
  filterParams,
  parseProspectFilters,
  parseProspectionView,
  viewHref,
} from "@/lib/agents/prospection/filters";
import {
  loadDictionaries,
  loadOffers,
  loadPipeline,
  loadProspectTable,
  loadProspectionCounts,
  loadProspectionSettings,
  loadSources,
} from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Prospection" };
export const dynamic = "force-dynamic";

const ASK_HINT =
  "Écrivez à Kevin : « qui contacter ? », « prospects FR casino libres », « j'ai contacté @nom », « @nom a signé prime par joueur 100 », « cherche des canaux casino en Pologne », « export prospects ».";

/**
 * Agents → Prospection (phase 31) : les canaux Telegram publics casino et paris sportifs d'Europe que l'équipe trouve,
 * lit et note pour vous aider à recruter des affiliés. L'équipe ne contacte JAMAIS personne : vous contactez, puis vous
 * notez ici (ou par les boutons de Kevin) où en est chaque canal. Six vues : canaux trouvés, avancement, offres,
 * sources, marques et repères, réglages (administrateurs). `?export=csv` : export CSV des lignes filtrées.
 */
export default async function AgentsProspectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const toExport = exportRedirect(sp);
  if (toExport) redirect(toExport);
  const isAdmin = user.role === "ADMIN";
  const view = parseProspectionView(sp.vue);
  const filters = parseProspectFilters(sp);
  const now = new Date();
  const settings = await loadProspectionSettings();
  const scope = settings.countriesScope;
  const [pending, counts, table, pipeline, offers, sources, dicts] = await Promise.all([
    loadPendingCounts(),
    loadProspectionCounts(scope),
    view === "tableau" ? loadProspectTable(filters, scope) : Promise.resolve(null),
    view === "avancement" ? loadPipeline(filters, scope, now) : Promise.resolve(null),
    view === "offres" ? loadOffers() : Promise.resolve(null),
    view === "sources" ? loadSources(scope, now) : Promise.resolve(null),
    view === "dictionnaires" ? loadDictionaries() : Promise.resolve(null),
  ]);
  const views = PROSPECTION_VIEWS.filter((v) => v !== "reglages" || isAdmin);
  const chipCount: Partial<Record<(typeof PROSPECTION_VIEWS)[number], number>> = {
    tableau: counts.toContact || undefined,
    dictionnaires: counts.pendingProposals || undefined,
  };
  const back = viewHref(view, filterParams(filters));

  return (
    <>
      <AgentsNav current="prospection" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Prospection"
        description="Les canaux Telegram publics de casino et de paris sportifs en Europe, trouvés, lus et notés par l'équipe pour recruter des affiliés. Chaque matin, Kevin vous envoie les meilleurs à contacter. L'équipe ne contacte jamais personne : c'est vous qui écrivez."
        help={ASK_HINT}
        secondaryActions={
          <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Parler à Kevin
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="À contacter" value={fmtNum(counts.toContact)} />
        <StatCard label="Niveau A à contacter" value={fmtNum(counts.tiers.A ?? 0)} />
        <StatCard label="En cours avec vous" value={fmtNum(counts.inProgress)} />
        <StatCard label="Signés" value={fmtNum(counts.signed)} />
      </div>
      {counts.activeOffers === 0 ? (
        <p className="mb-4 text-note text-muted-foreground">
          Aucune offre enregistrée : les canaux sont notés sur l&apos;Europe et le marché seulement.{" "}
          <Link href={viewHref("offres")} className="text-info underline underline-offset-4">
            Ajouter une offre
          </Link>
        </p>
      ) : null}

      <FilterChips
        label="Vue"
        className="mb-6"
        chips={views.map((v) => ({ key: v, label: PROSPECTION_VIEW_LABELS[v], href: viewHref(v), selected: view === v, count: chipCount[v] }))}
      />

      {view === "tableau" || view === "avancement" ? <ProspectFiltersForm filters={filters} view={view} showExport={view === "tableau"} /> : null}
      {table ? <ProspectsTable rows={table.rows} total={table.total} back={back} now={now} /> : null}
      {pipeline ? <PipelineView summary={pipeline.summary} cards={pipeline.cards} /> : null}
      {offers ? <OffersView offers={offers} /> : null}
      {sources ? <SourcesView data={sources} isAdmin={isAdmin} /> : null}
      {dicts ? <DictionariesView view={dicts.view} proposals={dicts.proposals} isAdmin={isAdmin} /> : null}
      {view === "reglages" ? <ProspectionSettingsView settings={settings} isAdmin={isAdmin} /> : null}
    </>
  );
}
