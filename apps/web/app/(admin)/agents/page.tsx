import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { TeamCard } from "@/components/agents/team-card";
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
import { TEAM_KEYS } from "@/lib/agents/teams";
import { fmtDayKey } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

/**
 * Tableau de bord du Grand Chef (phase 19) : une carte par équipe (état, chiffres du jour, dépense du mois, pause,
 * mission de test), puis les trois derniers rapports du matin. Rien ici n'appelle une IA : le Grand Chef est de la
 * logique programmée, qui passe toutes les 30 minutes.
 */
export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const [configs, figures, usage, reports, pausedAll, pending] = await Promise.all([
    loadTeamConfigs(),
    loadDayFigures(now),
    loadMonthUsage(now),
    loadDailyReports(3),
    loadPausedAll(),
    loadPendingCounts(),
  ]);
  const waiting = pending.validations + pending.requests;

  return (
    <>
      <AgentsNav current="dashboard" isAdmin={user.role === "ADMIN"} pending={waiting} />
      <PageHeader
        title="Agents"
        description="Le Grand Chef répartit chaque jour le travail entre quatre équipes d'agents ; chaque Chef d'équipe fait passer ses missions d'un agent à l'autre jusqu'à la publication."
        help="Pour essayer : « Créer une mission de test » sur l'équipe Rencontres. L'aperçu arrive sur Telegram et dans Validations ; après « Publier », le post part sur le canal Test."
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
              Aucune mission ne démarre ni ne continue. Un administrateur la lève dans Agents → Réglages.
            </AlertDescription>
          </Alert>
        ) : null}

        <section aria-label="Équipes" className="grid gap-4 lg:grid-cols-2">
          {TEAM_KEYS.map((t) => (
            <TeamCard
              key={t}
              team={t}
              config={configs[t]}
              figures={figures[t]}
              spentCents={sumCents(usage[t])}
              pausedAll={pausedAll}
            />
          ))}
        </section>

        <FormSection
          title="Rapports du matin"
          description="Chaque matin à 9 h, le Grand Chef envoie sur Telegram une ligne par équipe : publié, en attente, refusé, dépense du mois. Les trois derniers :"
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
