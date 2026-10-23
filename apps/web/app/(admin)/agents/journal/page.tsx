import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { MissionFiltersForm, MissionsTable } from "@/components/agents/missions-table";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/admin/page-header";
import { PAGE_SIZE, Pagination, pageCount, pageHref, pageOf, pageSkip } from "@/components/admin/pagination";
import { TabNav } from "@/components/admin/tab-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { journalParams, parseJournalFilters } from "@/lib/agents/journal";
import { loadMissions, loadPendingCounts, loadRuns } from "@/lib/agents/queries";
import { agentLabel, teamName } from "@/lib/agents/teams";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Journal" };
export const dynamic = "force-dynamic";

/**
 * Journal des agents (phase 19) : toutes les missions (détail étape par étape) ou tous les passages des agents, avec
 * filtres et export CSV. Les événements bruts des agents sont aussi dans Réglages → Journal, famille « Agents ».
 */
export default async function AgentsJournalPage({ searchParams }: PageProps<"/agents/journal">) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = parseJournalFilters(sp);
  const now = new Date();
  const page = pageOf(sp);
  const opts = { teamKey: f.team, take: PAGE_SIZE, skip: pageSkip(page) };
  const [pending, missions, runs] = await Promise.all([
    loadPendingCounts(),
    f.view === "missions" ? loadMissions(f, now, opts) : null,
    f.view === "runs" ? loadRuns(f, now, opts) : null,
  ]);
  const total = missions?.total ?? runs?.total ?? 0;
  const activeFilters = [f.team, f.status, f.range !== "7d" ? f.range : ""].filter(Boolean).length;

  return (
    <>
      <AgentsNav current="journal" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Journal des agents"
        description="Tout ce que les agents ont fait : chaque mission avec ses étapes, et chaque passage d'un agent avec son résultat et son coût."
        secondaryActions={
          <Link
            href={`/agents/journal/export${journalParams(f)}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Download aria-hidden />
            Exporter
          </Link>
        }
      />
      <TabNav
        label="Missions ou passages"
        current={f.view}
        items={[
          { key: "missions", href: `/agents/journal${journalParams(f, { view: "missions" })}`, label: "Missions" },
          { key: "runs", href: `/agents/journal${journalParams(f, { view: "runs" })}`, label: "Passages des agents" },
        ]}
        phone="grid"
        columns={2}
        className="mb-6"
      />
      <div className="space-y-4">
        <CollapsibleFilters activeCount={activeFilters}>
          <MissionFiltersForm
            filters={f}
            team={f.team ?? ""}
            showTeam
            idPrefix="journal"
            extra={f.view === "runs" ? <input type="hidden" name="view" value="runs" /> : null}
          />
        </CollapsibleFilters>
        {missions ? <MissionsTable missions={missions.rows} showTeam /> : null}
        {runs ? (
          <DataTable
            label="Passages des agents"
            columns={[
              { key: "startedAt", header: "Début" },
              { key: "agent", header: "Agent", className: "whitespace-normal" },
              { key: "status", header: "Statut" },
              { key: "result", header: "Résultat", hideOnMobile: true, className: "whitespace-normal" },
              { key: "cost", header: "Coût", align: "right", hideOnMobile: true },
            ]}
            rows={runs.rows.map((r) => ({
              id: r.id,
              cells: {
                startedAt: fmtDate(r.startedAt),
                agent: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{agentLabel(r.agentKey)}</span>
                    <span className="text-note text-muted-foreground">Équipe {teamName(r.teamKey)}</span>
                  </span>
                ),
                status: <StatusBadge kind="agentRun" value={r.status} />,
                result: r.error ? <span className="text-danger">{r.error}</span> : (r.outputSummary ?? "—"),
                cost: fmtMoney(r.costCents / 100),
              },
              sortValues: { startedAt: r.startedAt.getTime(), agent: r.agentKey, status: r.status, cost: r.costCents },
            }))}
            empty={{ title: "Aucun passage", description: "Aucun passage d'agent ne correspond à ces filtres." }}
          />
        ) : null}
        <Pagination
          page={page}
          pages={pageCount(total)}
          total={total}
          noun={f.view === "runs" ? "passage" : "mission"}
          hrefFor={(n) => pageHref("/agents/journal", sp, n)}
        />
      </div>
    </>
  );
}
