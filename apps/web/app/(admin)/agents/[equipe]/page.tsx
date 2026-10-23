import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ChannelPlanForm } from "@/components/agents/channel-plan-form";
import { MissionFiltersForm, MissionsTable } from "@/components/agents/missions-table";
import { LevelPicker, PauseButton, SimulationSwitch } from "@/components/agents/team-controls";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTestMissionAction } from "../actions";
import { saveTeamSettingsAction } from "./actions";
import { centsToEurField, quietHoursText } from "@/lib/agents/config";
import { simulationSentence, teamPills } from "@/lib/agents/display";
import { parseMissionFilters } from "@/lib/agents/missions";
import {
  loadAgentsOfTeam,
  loadChannelPlans,
  loadMissions,
  loadMonthUsage,
  loadPausedAll,
  loadPendingCounts,
  loadPlanChoices,
  loadTeamConfig,
} from "@/lib/agents/queries";
import {
  PROVIDER_LABELS,
  TEAM_NAMES,
  TEAM_PROVIDERS,
  TEAM_PURPOSE,
  TEAM_VERTICAL,
  TEST_MISSION_TEAMS,
  agentAvailable,
  agentLabel,
  parseTeamParam,
} from "@/lib/agents/teams";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/agents/[equipe]">): Promise<Metadata> {
  const team = parseTeamParam((await params).equipe);
  return { title: team ? `Équipe ${TEAM_NAMES[team]}` : "Agents" };
}

/**
 * Fiche d'une équipe (phase 19) : pilotage (simulation, niveau, pause), réglages lus par la Rédaction et le Contrôle
 * qualité, plan par canal, agents de la chaîne avec leurs derniers passages, missions avec détail étape par étape.
 * Équipes : dating, casino, sports, algo (404 sinon). Les managers font tout sauf arrêter la simulation et le niveau 2.
 */
export default async function TeamPage({ params, searchParams }: PageProps<"/agents/[equipe]">) {
  const user = await requireUser();
  const team = parseTeamParam((await params).equipe);
  if (!team) notFound();
  const sp = await searchParams;
  const now = new Date();
  const filters = parseMissionFilters(sp);
  const from = `/agents/${team}`;
  const [config, pausedAll, pending, usage, plans, choices, agents, missions] = await Promise.all([
    loadTeamConfig(team),
    loadPausedAll(),
    loadPendingCounts(),
    loadMonthUsage(now),
    loadChannelPlans(team),
    loadPlanChoices(team),
    loadAgentsOfTeam(team),
    loadMissions(filters, now, { teamKey: team, take: 50 }),
  ]);
  const spent = usage[team] ?? {};

  return (
    <>
      <AgentsNav current="dashboard" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        backHref="/agents"
        backLabel="Agents"
        title={`Équipe ${TEAM_NAMES[team]}`}
        description={TEAM_PURPOSE[team]}
        meta={teamPills(config, pausedAll).map((p) => (
          <StatusPill key={p.label} tone={p.tone} title={p.title}>
            {p.label}
          </StatusPill>
        ))}
        secondaryActions={
          <>
            <PauseButton team={team} config={config} from={from} />
            {TEST_MISSION_TEAMS.includes(team) ? (
              <form action={createTestMissionAction}>
                <input type="hidden" name="team" value={team} />
                <input type="hidden" name="from" value={from} />
                <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                  Créer une mission de test
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {config.paused && config.pausedReason ? (
        <p className="mb-4 text-body text-danger">En pause : {config.pausedReason}</p>
      ) : null}

      <div className="space-y-10">
        <FormSection title="Pilotage" description={simulationSentence(config)} actions={<SimulationSwitch team={team} config={config} role={user.role} from={from} />}>
          <LevelPicker team={team} config={config} role={user.role} from={from} />
        </FormSection>

        <form action={saveTeamSettingsAction} id="reglages" className="space-y-6 scroll-mt-24">
          <input type="hidden" name="team" value={team} />
          <FormSection
            title="Réglages de l'équipe"
            description="Lus par la Rédaction et le Contrôle qualité. Ils s'appliquent au prochain passage du Grand Chef, sans aucun appel à l'IA."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="styleGuidelines">Consignes de style</Label>
                <Textarea
                  id="styleGuidelines"
                  name="styleGuidelines"
                  maxLength={4000}
                  defaultValue={config.styleGuidelines}
                  placeholder="Exemple : phrases très courtes, tutoiement, un emoji au plus, jamais de point d'exclamation en série."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="forbiddenWords">Mots interdits</Label>
                <Textarea
                  id="forbiddenWords"
                  name="forbiddenWords"
                  defaultValue={config.forbiddenWords.join("\n")}
                  aria-describedby="forbiddenWords-aide"
                />
                <p id="forbiddenWords-aide" className="text-note text-muted-foreground">
                  Un mot ou une expression par ligne. Un post qui en contient un est refusé par le Contrôle qualité.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quietHours">Heures calmes</Label>
                <Textarea
                  id="quietHours"
                  name="quietHours"
                  defaultValue={quietHoursText(config.quietHours)}
                  placeholder="23:00-08:00"
                  aria-describedby="quietHours-aide"
                />
                <p id="quietHours-aide" className="text-note text-muted-foreground">
                  Une plage par ligne, heure de Paris : rien ne part pendant ces heures.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxTextLength">Longueur maximale d&apos;un post (caractères)</Label>
                <Input
                  id="maxTextLength"
                  name="maxTextLength"
                  type="number"
                  min={50}
                  max={4000}
                  defaultValue={config.maxTextLength}
                />
              </div>
            </div>
          </FormSection>
          <FormSection
            title="Plafonds du mois"
            description="Au-delà, les missions sont refusées proprement et vous êtes prévenu à 80 % et à 100 %. Champ vide : aucun plafond saisi."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {TEAM_PROVIDERS[team].map((p) => (
                <div key={p} className="space-y-1.5">
                  <Label htmlFor={`budget_${p}`}>{PROVIDER_LABELS[p]} (€ par mois)</Label>
                  <Input
                    id={`budget_${p}`}
                    name={`budget_${p}`}
                    inputMode="decimal"
                    defaultValue={centsToEurField(config.budgets[p])}
                    aria-describedby={`budget_${p}-aide`}
                  />
                  <p id={`budget_${p}-aide`} className="text-note text-muted-foreground">
                    Dépensé ce mois : {fmtMoney((spent[p] ?? 0) / 100)}
                  </p>
                </div>
              ))}
            </div>
          </FormSection>
          <div className="border-t border-border pt-6">
            <Button type="submit" className="max-md:h-10">
              Enregistrer
            </Button>
          </div>
        </form>

        {TEAM_VERTICAL[team] ? (
          <FormSection
            id="plan"
            title="Plan par canal"
            description="Combien de posts par jour, dans quelle fenêtre (heure de Paris), avec quel espacement et quel mélange. Le canal Test reçoit les posts tant que la simulation est active."
          >
            {plans.length === 0 ? (
              <EmptyState
                title="Aucun canal dans cet univers"
                description="Ajoutez d'abord un canal de cet univers dans Canaux."
                action={{ href: "/channels", label: "Ouvrir Canaux", variant: "outline" }}
              />
            ) : (
              <div className="space-y-3">
                {plans.map((c) => (
                  <ChannelPlanForm
                    key={c.id}
                    team={team}
                    channel={c}
                    personas={choices.personas}
                    campaigns={choices.campaigns}
                  />
                ))}
              </div>
            )}
          </FormSection>
        ) : null}

        <FormSection
          title="Agents de l'équipe"
          description="Dans l'ordre où le Chef d'équipe leur passe chaque mission, avec leurs trois derniers passages."
        >
          <ol className="space-y-3">
            {agents.map((a, i) => (
              <li key={a.agentKey} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-note text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="font-medium text-foreground">{agentLabel(a.agentKey)}</span>
                  {agentAvailable(a.agentKey as Parameters<typeof agentAvailable>[0]) ? null : (
                    <StatusPill tone="muted">Arrive dans une prochaine étape</StatusPill>
                  )}
                </div>
                {a.runs.length === 0 ? (
                  <p className="text-note text-muted-foreground">Aucun passage pour l&apos;instant.</p>
                ) : (
                  <ul className="space-y-1">
                    {a.runs.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 text-note">
                        <StatusBadge kind="agentRun" value={r.status} />
                        <span className="text-muted-foreground">{fmtDate(r.startedAt)}</span>
                        {r.error ? (
                          <span className="text-danger">{r.error}</span>
                        ) : r.outputSummary ? (
                          <span className="text-foreground">{r.outputSummary}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </FormSection>

        <FormSection
          id="missions"
          title="Missions"
          description="Une mission = un post à produire. Cliquez sur une ligne pour voir chaque étape."
        >
          <MissionFiltersForm filters={filters} idPrefix="team-missions" />
          <MissionsTable missions={missions.rows} />
          {missions.total > missions.rows.length ? (
            <p className="text-note text-muted-foreground">
              Les 50 plus récentes sur {missions.total}. Toutes les missions sont dans le Journal.
            </p>
          ) : null}
        </FormSection>
      </div>
    </>
  );
}
