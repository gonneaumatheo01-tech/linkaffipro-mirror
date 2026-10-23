import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { MISSION_RANGES, MISSION_STATUSES, type MissionFilters } from "@/lib/agents/missions";
import type { MissionView } from "@/lib/agents/queries";
import { TEAM_KEYS, agentLabel, teamName } from "@/lib/agents/teams";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { MissionDetail } from "./mission-detail";

/** Filtres GET des missions (statut, période ; équipe dans le journal). */
export function MissionFiltersForm({
  filters,
  team,
  showTeam = false,
  extra,
  idPrefix,
}: {
  filters: MissionFilters;
  team?: string;
  showTeam?: boolean;
  extra?: React.ReactNode;
  idPrefix: string;
}) {
  return (
    <form
      method="get"
      aria-label="Filtrer les missions"
      className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 md:p-4 lg:grid-cols-4 lg:items-end"
    >
      {extra}
      {showTeam ? (
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${idPrefix}-team`} className="text-note font-medium text-muted-foreground">
            Équipe
          </Label>
          <NativeSelect id={`${idPrefix}-team`} name="team" defaultValue={team ?? ""} wrapperClassName="w-full">
            <option value="">Toutes les équipes</option>
            {TEAM_KEYS.map((t) => (
              <option key={t} value={t}>
                {teamName(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-status`} className="text-note font-medium text-muted-foreground">
          Statut
        </Label>
        <NativeSelect id={`${idPrefix}-status`} name="status" defaultValue={filters.status} wrapperClassName="w-full">
          <option value="">Tous les statuts</option>
          {MISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel("agentMission", s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-range`} className="text-note font-medium text-muted-foreground">
          Période
        </Label>
        <NativeSelect id={`${idPrefix}-range`} name="range" defaultValue={filters.range} wrapperClassName="w-full">
          {MISSION_RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" className="max-md:h-10">
        Filtrer
      </Button>
    </form>
  );
}

/** Liste des missions ; un clic ouvre le détail étape par étape. */
export function MissionsTable({ missions, showTeam = false }: { missions: MissionView[]; showTeam?: boolean }) {
  const rows: DataTableRow[] = missions.map((m) => {
    const step = m.steps[m.currentStep];
    return {
      id: m.id,
      cells: {
        createdAt: fmtDate(m.createdAt),
        where: (
          <span className="flex flex-col items-start gap-0.5">
            <span>{m.channelTitle ?? "Sans canal"}</span>
            <span className="text-note text-muted-foreground">
              {showTeam ? `${teamName(m.teamKey)}${m.isTest ? " · test" : ""}` : m.isTest ? "Mission de test" : ""}
            </span>
          </span>
        ),
        status: <StatusBadge kind="agentMission" value={m.status} />,
        step: step ? agentLabel(step.agent) : "—",
        cost: fmtMoney(m.costCents / 100),
      },
      sortValues: { createdAt: m.createdAt.getTime(), status: m.status, where: m.channelTitle ?? "", cost: m.costCents },
      detail: <MissionDetail mission={m} />,
      detailTitle: `Mission du ${fmtDate(m.createdAt)}`,
    };
  });
  return (
    <DataTable
      label="Missions"
      panelSize="lg"
      columns={[
        { key: "createdAt", header: "Créée le" },
        { key: "where", header: "Canal", className: "whitespace-normal" },
        { key: "status", header: "Statut" },
        { key: "step", header: "Étape", hideOnMobile: true },
        { key: "cost", header: "Coût", align: "right", hideOnMobile: true },
      ]}
      rows={rows}
      empty={{
        title: "Aucune mission",
        description: "Aucune mission ne correspond à ces filtres.",
      }}
    />
  );
}
