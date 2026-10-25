import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { TeamCard } from "@/components/agents/team-card";
import { AdsAgentCard } from "@/components/agents/ads/ads-agent-card";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  loadDailyReports,
  loadDayFigures,
  loadMonthUsage,
  loadPausedAll,
  loadPendingCounts,
  loadTeamConfigs,
  sumCents,
} from "@/lib/agents/queries";
import { loadAdsCardFigures } from "@/lib/agents/ads/queries";
import { AppliedSettings, AttentionStrip, PausedAllButton } from "@/components/agents/overview-sections";
import { loadAgentsOverview, loadAppliedDetails } from "@/lib/agents/overview";
import { TEAM_KEYS, type TeamKey } from "@/lib/agents/teams";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { fmtDayKey } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

/**
 * Tableau de bord du Grand Chef (phase 19, complété en phase 25) : ce qui vous attend (validations, demandes, alertes,
 * tests A/B), une carte par équipe (état, missions du jour, dépense du mois par poste avec plafond et projection,
 * résultats des posts sur 7 et 28 jours), la carte de l'Agent Ads, les réglages appliqués cette semaine par l'équipe
 * Algorithme (avec « Annuler »), puis les derniers rapports. Les chiffres viennent d'une seule source,
 * `agentsOverview` du moteur ; s'il ne répond pas, la page garde l'ancien résumé. Rien ici n'appelle une IA.
 */
export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const [configs, figures, usage, reports, pausedAll, pending, adsFigures] = await Promise.all([
    loadTeamConfigs(),
    loadDayFigures(now),
    loadMonthUsage(now),
    loadDailyReports(3),
    loadPausedAll(),
    loadPendingCounts(),
    loadAdsCardFigures(now),
  ]);
  const overviewResult = await loadAgentsOverview(now);
  const overview = overviewResult.ok ? overviewResult.overview : null;
  const applied = overview ? await loadAppliedDetails(overview.algoAppliedThisWeek).catch(() => []) : [];
  const teamOverview = (t: TeamKey) => overview?.teams.find((x) => x.teamKey === t) ?? null;
  const isAdmin = user.role === "ADMIN";
  const waiting = pending.validations + pending.requests;

  return (
    <>
      <AgentsNav current="dashboard" isAdmin={isAdmin} pending={waiting} />
      <PageHeader
        title="Agents"
        description="Le Grand Chef répartit chaque jour le travail entre quatre équipes d'agents ; chaque Chef d'équipe fait passer ses missions d'un agent à l'autre jusqu'à la publication."
        help="Pour essayer : « Créer une mission de test » sur l'équipe Rencontres. L'aperçu arrive sur Telegram et dans Validations ; après « Publier », le post part sur le canal Test."
        secondaryActions={isAdmin ? <PausedAllButton pausedAll={pausedAll} /> : undefined}
        meta={
          pausedAll ? (
            <StatusPill tone="danger">Pause générale</StatusPill>
          ) : waiting > 0 ? (
            <StatusPill tone="warning">{waiting} en attente de vous</StatusPill>
          ) : null
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        {pausedAll ? (
          <Alert variant="warning" role="status">
            <AlertTitle>Toutes les équipes sont en pause</AlertTitle>
            <AlertDescription>
              Aucune mission ne démarre ni ne continue. Un administrateur la lève par « Tout reprendre », en haut de
              cette page ou dans Agents → Réglages.
            </AlertDescription>
          </Alert>
        ) : null}

        {overview ? (
          <AttentionStrip overview={overview} isAdmin={isAdmin} />
        ) : (
          <Alert variant="warning" role="status">
            <AlertTitle>Résumé détaillé indisponible pour l&apos;instant</AlertTitle>
            <AlertDescription>
              Les chiffres ci-dessous sont ceux du jour seulement. Rechargez la page dans une minute ; si cela dure,
              regardez Réglages → État du système.
            </AlertDescription>
          </Alert>
        )}

        <section aria-label="Équipes" className="grid gap-4 lg:grid-cols-2">
          {TEAM_KEYS.map((t) => (
            <TeamCard
              key={t}
              team={t}
              config={configs[t]}
              figures={figures[t]}
              spentCents={sumCents(usage[t])}
              pausedAll={pausedAll}
              overview={teamOverview(t)}
            />
          ))}
          <AdsAgentCard figures={adsFigures} paused={overview?.ads.paused ?? false} />
        </section>

        {overview ? <AppliedSettings rows={applied} role={user.role} /> : null}

        <FormSection
          title="Derniers rapports"
          description="Chaque matin à 9 h, le Grand Chef envoie sur Telegram une ligne par équipe : publié, en attente, refusé, dépense du mois. Les trois derniers :"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/agents/algo#rapports" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
                Rapports de la semaine
              </Link>
              <Link href="/agents/ads" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
                Rapports pubs
              </Link>
              <Link href="/agents/boss" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
                Parler à Kevin
              </Link>
              <Link href="/agents/orders" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
                Ordres de Kevin
              </Link>
              <Link href="/agents/inspiration" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
                Canaux d&apos;inspiration
              </Link>
            </div>
          }
        >
          {reports.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title="Pas encore de rapport"
              description="Le premier rapport arrive le matin qui suit la première mission."
            />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {reports.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <p className="text-body font-medium text-foreground">{fmtDayKey(r.day)}</p>
                  {r.lines.length ? (
                    <ul className="space-y-0.5 text-body text-muted-foreground">
                      {r.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-note text-muted-foreground">Rapport vide.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      </div>
    </>
  );
}
