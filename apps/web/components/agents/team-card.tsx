import Link from "next/link";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { createTestMissionAction } from "@/app/(admin)/agents/actions";
import type { TeamConfigView } from "@/lib/agents/config";
import { spendView, teamPills } from "@/lib/agents/display";
import type { TeamDayFigures } from "@/lib/agents/queries";
import {
  TEAM_NAMES,
  TEAM_PURPOSE,
  TEAM_VERTICAL,
  TEST_MISSION_TEAMS,
  levelLabel,
  type TeamKey,
} from "@/lib/agents/teams";
import { fmtNum } from "@/lib/format";
import { PauseButton } from "./team-controls";

const BAR_TONES = { brand: "bg-brand-ink", warning: "bg-warning", danger: "bg-danger" } as const;

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-note text-muted-foreground">{label}</dt>
      <dd className="text-title font-semibold tabular-nums text-foreground">{fmtNum(value)}</dd>
    </div>
  );
}

/**
 * Carte d'une équipe sur le tableau de bord du Grand Chef : état (active ou en pause, simulation, niveau), chiffres du
 * jour, dépense du mois face au plafond, et les gestes rapides (ouvrir, pause, mission de test).
 */
export function TeamCard({
  team,
  config,
  figures,
  spentCents,
  pausedAll,
}: {
  team: TeamKey;
  config: TeamConfigView;
  figures: TeamDayFigures;
  spentCents: number;
  pausedAll: boolean;
}) {
  const spend = spendView(spentCents, config.budgets);
  const vertical = TEAM_VERTICAL[team];
  return (
    <article
      data-slot="team-card"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {teamPills(config, pausedAll).map((p) => (
            <StatusPill key={p.label} tone={p.tone} title={p.title}>
              {p.label}
            </StatusPill>
          ))}
        </div>
        <h2 className="flex items-center gap-2 text-body font-semibold text-foreground">
          {vertical ? <UniverseDot universe={vertical} /> : null}
          <Link href={`/agents/${team}`} className="hover:underline">
            Équipe {TEAM_NAMES[team]}
          </Link>
        </h2>
        <p className="text-note text-muted-foreground">{TEAM_PURPOSE[team]}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Missions du jour" value={figures.missionsToday} />
        <Figure label="En attente" value={figures.waiting} />
        <Figure label="Publiées aujourd'hui" value={figures.publishedToday} />
        <Figure label="Refusées aujourd'hui" value={figures.refusedToday} />
      </dl>
      <div className="space-y-1.5">
        <p className="text-note text-muted-foreground">
          Dépense : <span className="text-foreground">{spend.text}</span>
        </p>
        {spend.capCents !== null ? (
          <span
            className="block h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`Part du plafond du mois utilisée, équipe ${TEAM_NAMES[team]}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={spend.pct}
          >
            <span className={cn("block h-full rounded-full", BAR_TONES[spend.tone])} style={{ width: `${spend.pct}%` }} />
          </span>
        ) : null}
        <p className="text-note text-muted-foreground">{levelLabel(config.autonomyLevel)}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Link href={`/agents/${team}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
          Ouvrir l&apos;équipe
        </Link>
        <PauseButton team={team} config={config} from="/agents" />
        {TEST_MISSION_TEAMS.includes(team) ? (
          <form action={createTestMissionAction}>
            <input type="hidden" name="team" value={team} />
            <input type="hidden" name="from" value="/agents" />
            <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
              Créer une mission de test
            </Button>
          </form>
        ) : null}
      </div>
    </article>
  );
}
