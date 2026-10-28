import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ChannelPlanForm } from "@/components/agents/channel-plan-form";
import {
  CasinoProduction,
  CasinoRequests,
  CasinoStock,
  CasinoThemes,
  CasinoToClassify,
} from "@/components/agents/casino/casino-production";
import { DatingConversationCard, DatingProduction } from "@/components/agents/dating-production";
import { MissionFiltersForm, MissionsTable } from "@/components/agents/missions-table";
import { BetCategories } from "@/components/agents/sports/bet-categories";
import { BetPicks } from "@/components/agents/sports/bet-picks";
import { BetSummary } from "@/components/agents/sports/bet-summary";
import { SportsSettingsFields } from "@/components/agents/sports/sports-settings-fields";
import { LevelPicker, PauseButton, SimulationSwitch } from "@/components/agents/team-controls";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createTestMissionAction } from "../actions";
import { saveTeamSettingsAction } from "./actions";
import { AlgoView } from "./algo-view";
import { centsToEurField, quietHoursText } from "@/lib/agents/config";
import {
  DATING_DEFAULT_BUDGETS,
  VIDEO_PROVIDERS,
  VIDEO_RESOLUTIONS,
  parseDatingSettings,
} from "@/lib/agents/dating";
import { loadDatingPersonas, loadDatingSettings, loadMediaKeys } from "@/lib/agents/dating-queries";
import { parseCasinoSettings } from "@/lib/agents/casino";
import {
  loadCasinoRecentUsages,
  loadCasinoRequests,
  loadCasinoSettings,
  loadCasinoStock,
  loadThemeMediaCounts,
  loadToClassify,
} from "@/lib/agents/casino-queries";
import { simulationSentence, teamPills } from "@/lib/agents/display";
import { SPORTS_DEFAULT_FORBIDDEN_WORDS, parseSportsSettings, parseSummaryBy } from "@/lib/agents/sports";
import { loadBetCategories, loadBetSummary, loadOddsCallsThisMonth, loadPicksSince, loadSportsSettings } from "@/lib/agents/sports-queries";
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
import { periodDates, periodStart, resolvePeriod } from "@/lib/periods";
import { StatusBadge } from "@/lib/status-badges";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/agents/[equipe]">): Promise<Metadata> {
  const team = parseTeamParam((await params).equipe);
  if (team === "algo") return { title: "Ce qui marche" };
  return { title: team ? `Équipe ${TEAM_NAMES[team]}` : "Agents" };
}

/**
 * Fiche d'une équipe (phase 19) : pilotage (simulation, niveau, pause), réglages lus par la Rédaction et le Contrôle
 * qualité, plan par canal, agents de la chaîne avec leurs derniers passages, missions avec détail étape par étape.
 * Équipes : dating, casino, sports, algo (404 sinon). Les managers font tout sauf arrêter la simulation et le niveau 2.
 * L'équipe Algorithme (phase 21) a sa propre page, « Ce qui marche » (`./algo-view.tsx`).
 */
export default async function TeamPage({ params, searchParams }: PageProps<"/agents/[equipe]">) {
  const user = await requireUser();
  const team = parseTeamParam((await params).equipe);
  if (!team) notFound();
  const sp = await searchParams;
  if (team === "algo") return AlgoView({ user, sp });
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
  const isAdmin = user.role === "ADMIN";
  const isDating = team === "dating";
  const [datingPersonas, datingSettings, mediaKeys] = isDating
    ? await Promise.all([loadDatingPersonas(now), loadDatingSettings(), loadMediaKeys()])
    : [[], parseDatingSettings(null), { fal: false, magichour: false }];
  // Équipe Casino (phase 22) : thèmes, stock, médias à classer, demandes, dernières publications.
  const isCasino = team === "casino";
  const casinoSettings = isCasino ? await loadCasinoSettings() : parseCasinoSettings(null);
  const [casinoStock, toClassify, casinoRequests, casinoUsages, themeCounts] = isCasino
    ? await Promise.all([
        loadCasinoStock(now),
        loadToClassify(),
        loadCasinoRequests(),
        loadCasinoRecentUsages(),
        loadThemeMediaCounts(casinoSettings.themes.map((t) => t.key)),
      ])
    : [null, { rows: [], total: 0 }, [], [], {}];
  // Équipe Paris sportifs (phase 23) : catégories, paris du jour, bilan sur la période, réglages.
  const isSports = team === "sports";
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const betPeriod = resolvePeriod(
    { range: one(sp.range) ?? (one(sp.from) && one(sp.to) ? undefined : "30d"), from: sp.from, to: sp.to },
    now,
  );
  const summaryBy = parseSummaryBy(one(sp.bilan));
  const sportsData = isSports
    ? await (async () => {
        const categories = await loadBetCategories();
        const { dateFrom, dateTo } = periodDates(betPeriod);
        const [picks, settings, summary, calls] = await Promise.all([
          loadPicksSince(periodStart(resolvePeriod({ range: "today" }, now))),
          loadSportsSettings(),
          loadBetSummary({ from: dateFrom, to: dateTo, by: summaryBy }),
          loadOddsCallsThisMonth(now),
        ]);
        return { categories, picks, settings, summary, calls };
      })()
    : null;
  const sportsSettings = sportsData?.settings ?? parseSportsSettings(null);
  const forbiddenDefault =
    isSports && config.forbiddenWords.length === 0 ? [...SPORTS_DEFAULT_FORBIDDEN_WORDS] : config.forbiddenWords;
  const channelTitles = Object.fromEntries(plans.map((c) => [c.id, c.title]));
  // Plafonds affichés : ceux de l'équipe, sinon (Rencontres) les valeurs par défaut du moteur.
  const shownBudgets: Partial<Record<string, number>> = isDating
    ? { video: DATING_DEFAULT_BUDGETS.video, image: DATING_DEFAULT_BUDGETS.image, ...config.budgets }
    : config.budgets;

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
            {TEST_MISSION_TEAMS.includes(team) && !isDating && !isCasino ? (
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
                  defaultValue={forbiddenDefault.join("\n")}
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
          {isDating ? (
            <FormSection
              title="Vidéos"
              description="Qui fabrique les vidéos et en quelle qualité. Le prix d'une vidéo dépend de sa durée et de sa résolution."
            >
              {isAdmin ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="videoProvider">Fournisseur des vidéos</Label>
                    <NativeSelect
                      id="videoProvider"
                      name="videoProvider"
                      defaultValue={datingSettings.videoProvider}
                      wrapperClassName="w-full"
                      aria-describedby="videoProvider-aide"
                    >
                      {VIDEO_PROVIDERS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <p id="videoProvider-aide" className="text-note text-muted-foreground">
                      Magic Hour sert aussi de secours si fal.ai échoue deux fois de suite.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="videoResolution">Résolution des vidéos</Label>
                    <NativeSelect
                      id="videoResolution"
                      name="videoResolution"
                      defaultValue={datingSettings.videoResolution}
                      wrapperClassName="w-full"
                    >
                      {VIDEO_RESOLUTIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              ) : (
                <p className="text-body text-foreground">
                  {VIDEO_PROVIDERS.find((v) => v.value === datingSettings.videoProvider)?.label},{" "}
                  {datingSettings.videoResolution}.{" "}
                  <span className="text-note text-muted-foreground">Réservé aux administrateurs.</span>
                </p>
              )}
            </FormSection>
          ) : null}
          {isCasino ? (
            <FormSection
              title="Stock et rotation"
              description="Quand l'équipe redemande des vidéos, et combien de temps une vidéo attend avant de revenir sur le même canal."
            >
              {isAdmin ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="casinoLowStock">Seuil de manque (vidéos non utilisées par thème)</Label>
                    <Input
                      id="casinoLowStock"
                      name="casinoLowStock"
                      type="number"
                      min={1}
                      max={50}
                      required
                      defaultValue={casinoSettings.lowStock}
                      aria-describedby="casinoLowStock-aide"
                    />
                    <p id="casinoLowStock-aide" className="text-note text-muted-foreground">
                      Sous ce nombre, le thème passe en orange et l&apos;équipe vous en redemande (3 conseillé).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="casinoRotationDays">Rotation (jours)</Label>
                    <Input
                      id="casinoRotationDays"
                      name="casinoRotationDays"
                      type="number"
                      min={1}
                      max={365}
                      required
                      defaultValue={casinoSettings.rotationDays}
                      aria-describedby="casinoRotationDays-aide"
                    />
                    <p id="casinoRotationDays-aide" className="text-note text-muted-foreground">
                      Une vidéo ne revient jamais sur le même canal avant ce délai, ni le même jour sur deux canaux
                      Casino (30 conseillé).
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-body text-foreground">
                  Seuil de manque : {casinoSettings.lowStock} vidéos, rotation : {casinoSettings.rotationDays} jours.{" "}
                  <span className="text-note text-muted-foreground">Réservé aux administrateurs.</span>
                </p>
              )}
            </FormSection>
          ) : null}
          {isSports ? (
            <SportsSettingsFields settings={sportsSettings} callsThisMonth={sportsData?.calls ?? 0} isAdmin={isAdmin} />
          ) : null}
          <FormSection
            title="Plafonds du mois"
            description={
              isAdmin
                ? "Au-delà, les missions sont refusées proprement et vous êtes prévenu à 80 % et à 100 %. Champ vide : aucun plafond saisi."
                : "Au-delà, les missions sont refusées proprement. Les plafonds sont réservés aux administrateurs."
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {TEAM_PROVIDERS[team].map((p) => (
                <div key={p} className="space-y-1.5">
                  <Label htmlFor={`budget_${p}`}>{PROVIDER_LABELS[p]} (€ par mois)</Label>
                  <Input
                    id={`budget_${p}`}
                    name={`budget_${p}`}
                    inputMode="decimal"
                    defaultValue={centsToEurField(shownBudgets[p])}
                    disabled={!isAdmin}
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

        {isDating ? (
          <DatingProduction
            personas={datingPersonas}
            spent={{ video: spent.video ?? 0, image: spent.image ?? 0 }}
            budgets={{ video: shownBudgets.video, image: shownBudgets.image }}
            keys={mediaKeys}
            isAdmin={isAdmin}
            simulation={config.simulation}
            now={now}
          />
        ) : null}

        {isCasino ? (
          <>
            <CasinoStock rows={casinoStock} settings={casinoSettings} />
            <CasinoToClassify items={toClassify.rows} total={toClassify.total} settings={casinoSettings} now={now} />
            <CasinoRequests
              requests={casinoRequests}
              settings={casinoSettings}
              channelTitles={channelTitles}
              now={now}
            />
            <CasinoProduction usages={casinoUsages} settings={casinoSettings} simulation={config.simulation} now={now} />
          </>
        ) : null}

        {sportsData ? (
          <>
            <BetPicks picks={sportsData.picks} categories={sportsData.categories} simulation={config.simulation} now={now} />
            <BetCategories
              categories={sportsData.categories}
              channels={plans.map((c) => ({ id: c.id, title: c.title, isTest: c.isTest }))}
              campaigns={choices.campaigns}
              isAdmin={isAdmin}
            />
            <BetSummary rows={sportsData.summary} by={summaryBy} period={betPeriod} />
          </>
        ) : null}

        {TEAM_VERTICAL[team] && !isSports ? (
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
                    personaRequired={isDating}
                    casinoThemes={isCasino ? casinoSettings.themes : undefined}
                  />
                ))}
              </div>
            )}
          </FormSection>
        ) : null}

        {isCasino ? <CasinoThemes settings={casinoSettings} counts={themeCounts} isAdmin={isAdmin} /> : null}

        {isDating ? <DatingConversationCard /> : null}

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
