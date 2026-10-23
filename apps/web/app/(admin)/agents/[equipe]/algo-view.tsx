import { AlgoLevelPicker, AlgoSettingsForm } from "@/components/agents/algo/algo-settings";
import { ConversationProfiles } from "@/components/agents/algo/conversation-profiles";
import { ExperimentsList } from "@/components/agents/algo/experiments-list";
import { RecommendationsList } from "@/components/agents/algo/recommendations-list";
import { ReportsList } from "@/components/agents/algo/reports-list";
import {
  DoesNotWork,
  RankingBlock,
  WindowsCharts,
  formatLabel,
  hourLabel,
  lengthLabel,
  weekdayLabel,
  type Labeler,
} from "@/components/agents/algo/what-works";
import { AgentsNav } from "@/components/agents/agents-nav";
import { PauseButton } from "@/components/agents/team-controls";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { PeriodSelect } from "@/components/admin/period-select";
import { StatusPill } from "@/components/admin/status-pill";
import { TabNav } from "@/components/admin/tab-nav";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { runAlgoReportNowAction } from "./algo-actions";
import { summarize, type GroupStats, type Ranking } from "@/lib/agents/algo/insights";
import {
  loadAlgoSettings,
  loadConversationProfiles,
  loadExperiments,
  loadInsightRows,
  loadPersonaNames,
  loadRecommendations,
  loadReports,
  loadSuggestedWindows,
  loadTeamChannels,
} from "@/lib/agents/algo/queries";
import { valueText } from "@/lib/agents/algo/recommendations";
import { teamPills } from "@/lib/agents/display";
import { loadAgentsOfTeam, loadPausedAll, loadPendingCounts, loadTeamConfig } from "@/lib/agents/queries";
import { TEAM_NAMES, agentLabel, type TeamKey } from "@/lib/agents/teams";
import { fmtDate, fmtNum } from "@/lib/format";
import { periodLabelWithDates, periodParams, resolvePeriod } from "@/lib/periods";
import { StatusBadge } from "@/lib/status-badges";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const ALGO_UNIVERSES = ["dating", "casino", "sports"] as const satisfies readonly TeamKey[];
type Universe = (typeof ALGO_UNIVERSES)[number];

export function parseUniverse(v: unknown): Universe {
  return ALGO_UNIVERSES.includes(v as Universe) ? (v as Universe) : "dating";
}

/** Période par défaut de la page : 30 jours (assez de posts pour comparer). */
export function algoPeriod(sp: SP, now = new Date()) {
  const range = one(sp.range);
  const hasCustom = Boolean(one(sp.from) && one(sp.to));
  return resolvePeriod({ range: range ?? (hasCustom ? undefined : "30d"), from: sp.from, to: sp.to }, now);
}

/**
 * Page « Ce qui marche » de l'équipe Algorithme (`/agents/algo`, phase 21) : par univers puis par canal, les
 * classements lus dans les fiches de résultats, les heures et les jours, ce qui ne marche pas, les tests A/B, les
 * propositions de réglages (Appliquer / Annuler / Refuser), les chiffres des conversations par profil, les rapports
 * archivés, puis le niveau et les réglages de l'équipe. Remplace la fiche d'équipe générique pour `algo`.
 */
export async function AlgoView({ user, sp }: { user: { id: string; role: string }; sp: SP }) {
  const now = new Date();
  const isAdmin = user.role === "ADMIN";
  const universe = parseUniverse(one(sp.univers));
  const period = algoPeriod(sp, now);
  const pp = periodParams(period);
  const [config, pausedAll, pending, settings, channels, reports, conv, agents] = await Promise.all([
    loadTeamConfig("algo"),
    loadPausedAll(),
    loadPendingCounts(),
    loadAlgoSettings(),
    loadTeamChannels(universe),
    loadReports(),
    loadConversationProfiles(),
    loadAgentsOfTeam("algo"),
  ]);
  const channelIds = channels.map((c) => c.id);
  const canalParam = one(sp.canal);
  const channelId = canalParam && channelIds.includes(canalParam) ? canalParam : null;
  const [rows, experiments, recs, windows] = await Promise.all([
    loadInsightRows(period, channelIds, channelId),
    loadExperiments(universe, channelId ? [channelId] : channelIds),
    loadRecommendations(universe, channelIds),
    channelId ? loadSuggestedWindows(channelId) : Promise.resolve(null),
  ]);
  const personaNames = await loadPersonaNames(rows.map((r) => r.personaId ?? ""));
  const thresholds = { minPosts: settings.minPosts, minViews: settings.minViews };
  const summary = summarize(rows, thresholds);
  const channelTitle = new Map(channels.map((c) => [c.id, c.title]));
  const personaLabel: Labeler = (k) => personaNames[k] ?? "Persona supprimée";
  const channelLabel: Labeler = (k) => channelTitle.get(k) ?? "Canal";
  const themeLabel: Labeler = (k) => k;

  const query: Record<string, string> = { univers: universe, ...pp, ...(channelId ? { canal: channelId } : {}) };
  const from = `/agents/algo?${new URLSearchParams(query).toString()}`;
  const universeName = TEAM_NAMES[universe];
  const channelName = channelId ? channelTitle.get(channelId) : null;

  const blocks: Array<{ title: string; ranking: Ranking; label: Labeler; dimension: string }> = [
    { title: "Types de posts", ranking: summary.format, label: formatLabel, dimension: "Type" },
    ...(universe === "dating"
      ? [{ title: "Personas", ranking: summary.persona, label: personaLabel, dimension: "Persona" }]
      : []),
    ...(channelId ? [] : [{ title: "Canaux", ranking: summary.channel, label: channelLabel, dimension: "Canal" }]),
    { title: "Thèmes", ranking: summary.theme, label: themeLabel, dimension: "Thème" },
    { title: "Longueur du texte", ranking: summary.length, label: lengthLabel, dimension: "Longueur" },
  ];
  const bad: Array<{ dimension: string; label: string; group: GroupStats }> = [
    ...blocks.flatMap((b) => b.ranking.doesNotWork.map((g) => ({ dimension: b.dimension, label: b.label(g.key), group: g }))),
    ...summary.hour.doesNotWork.map((g) => ({ dimension: "Heure", label: hourLabel(g.key), group: g })),
    ...summary.weekday.doesNotWork.map((g) => ({ dimension: "Jour", label: weekdayLabel(g.key), group: g })),
  ]
    .sort((a, b) => (a.group.offerCtr ?? 0) - (b.group.offerCtr ?? 0))
    .slice(0, 10);

  return (
    <>
      <AgentsNav current="dashboard" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        backHref="/agents"
        backLabel="Agents"
        title="Ce qui marche"
        description="Équipe Algorithme : elle ne publie rien, elle mesure ce qui marche (types de posts, heures, personas, conversations) et règle les trois autres équipes, dans des bornes et annulable en un clic."
        meta={teamPills(config, pausedAll)
          .filter((p) => !/simulation|vrais canaux/i.test(p.label))
          .map((p) => (
            <StatusPill key={p.label} tone={p.tone} title={p.title}>
              {p.label}
            </StatusPill>
          ))}
        secondaryActions={
          <>
            <PauseButton team="algo" config={config} from="/agents/algo" />
            {isAdmin ? (
              <form action={runAlgoReportNowAction}>
                <input type="hidden" name="from" value={from} />
                <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                  Rapport maintenant
                </Button>
              </form>
            ) : null}
          </>
        }
      />
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <TabNav
        label="Univers"
        current={universe}
        items={ALGO_UNIVERSES.map((u) => ({
          key: u,
          href: `/agents/algo?${new URLSearchParams({ univers: u, ...pp }).toString()}`,
          label: TEAM_NAMES[u],
        }))}
      />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <form method="get" action="/agents/algo" className="flex flex-wrap items-end gap-2" aria-label="Canal">
          <input type="hidden" name="univers" value={universe} />
          {Object.entries(pp).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="space-y-1">
            <Label htmlFor="algo-canal">Canal</Label>
            <NativeSelect id="algo-canal" name="canal" defaultValue={channelId ?? ""}>
              <option value="">Tous les canaux {universeName}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.isTest ? " (test)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" className="max-md:h-10">
            Afficher
          </Button>
        </form>
        <PeriodSelect period={period} compare={false} action="/agents/algo" extra={{ univers: universe, canal: channelId ?? undefined }} />
      </div>

      <div className="space-y-10">
        <FormSection
          id="ce-qui-marche"
          title={`Ce qui marche : ${channelName ?? `canaux ${universeName}`}`}
          description={`${periodLabelWithDates(period)} · ${fmtNum(summary.posts)} posts, ${fmtNum(summary.views)} vues, ${fmtNum(summary.offerClicks)} clics sur l'offre, ${fmtNum(summary.registrations)} inscriptions. Classement par taux de clic sur l'offre (clics ÷ vues) ; en orange, ce qui passe au-dessus de la valeur du milieu.`}
        >
          {summary.posts === 0 ? (
            <EmptyState
              title="Pas encore de fiche de résultats sur cette période"
              description="L'équipe Algorithme fait une fiche pour chaque post envoyé, chaque nuit. Choisissez une période plus longue, ou revenez demain."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {blocks.map((b) => (
                  <RankingBlock key={b.title} title={b.title} ranking={b.ranking} label={b.label} thresholds={thresholds} />
                ))}
              </div>
              <WindowsCharts summary={summary} thresholds={thresholds} />
            </div>
          )}
          {windows ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              <h3 className="text-body font-semibold text-foreground">Fenêtres conseillées pour ce canal</h3>
              {windows.windows.length ? (
                <p className="text-body text-foreground">{valueText("suggestedWindows", windows.windows)}</p>
              ) : (
                <p className="text-note text-muted-foreground">Pas encore de fenêtre calculée pour ce canal.</p>
              )}
              {windows.styleNotes ? (
                <p className="text-note text-muted-foreground">Ce qui marche ici : {windows.styleNotes}</p>
              ) : null}
            </div>
          ) : null}
        </FormSection>

        {summary.posts > 0 ? (
          <FormSection
            id="ne-marche-pas"
            title="Ce qui ne marche pas"
            description="Les cas avec assez de données qui passent sous la valeur du milieu, du plus faible au moins faible."
          >
            <DoesNotWork items={bad} />
          </FormSection>
        ) : null}

        <FormSection id="tests" title="Tests A/B" description="Deux versions comparées sur un même canal (une légende, une heure, un mélange), un seul test à la fois par canal et par type.">
          <ExperimentsList experiments={experiments} />
        </FormSection>

        <FormSection
          id="recommandations"
          title="Propositions de réglages"
          description="Chaque proposition dit ce qui change, pourquoi (les chiffres) et ce qu'elle doit rapporter. « Annuler » remet la valeur d'avant. Les réglages de persona et les quotas sont réservés aux administrateurs."
        >
          <RecommendationsList recs={recs} role={user.role} from={from} />
        </FormSection>

        <FormSection
          id="conversations"
          title="Conversations par profil"
          description="Pour chaque bot ou compte réel et chaque persona : qui répond, quand on décroche, ce que ça rapporte. Les propositions de réglage de persona arrivent dans la fiche de la persona."
        >
          <ConversationProfiles
            profiles={conv.profiles}
            review={conv.review}
            weekStart={conv.weekStart}
            minConversations={settings.minConversations}
          />
        </FormSection>

        <FormSection id="rapports" title="Rapports de la semaine" description="Le rapport « Ce qui marche » part chaque lundi sur Telegram (5 lignes par équipe) et s'archive ici.">
          <ReportsList reports={reports} />
        </FormSection>

        <FormSection id="pilotage" title="Niveau de l'équipe" description="Quels réglages partent seuls. Le rapport de la semaine part dans tous les cas.">
          <AlgoLevelPicker level={config.autonomyLevel} role={user.role} />
        </FormSection>

        <div className="space-y-2">
          <h2 className="text-title text-foreground">Réglages de l&apos;équipe Algorithme</h2>
          <AlgoSettingsForm settings={settings} isAdmin={isAdmin} from={from} />
        </div>

        <FormSection title="Agents de l'équipe" description="Dans l'ordre où le Chef Algorithme les fait tourner, avec leurs trois derniers passages.">
          <ol className="space-y-3">
            {agents.map((a, i) => (
              <li key={a.agentKey} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-note text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="font-medium text-foreground">{agentLabel(a.agentKey)}</span>
                </p>
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
      </div>
    </>
  );
}
