import type { Metadata } from "next";
import Link from "next/link";
import { AgentsNav } from "@/components/agents/agents-nav";
import { QualiteDashboardView } from "@/components/agents/qualite/dashboard-view";
import { QualiteHistoryView } from "@/components/agents/qualite/history-view";
import { QualiteTrendsView } from "@/components/agents/qualite/trends-view";
import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  QUALITE_VIEWS,
  QUALITE_VIEW_LABELS,
  parseQualiteFilters,
  parseQualiteStep,
  parseQualiteView,
  qaPaused,
  qualiteHref,
  safeCheckId,
} from "@/lib/agents/qualite";
import { loadCheck, loadHistory, loadQaRows, loadQaState, loadQaTeams } from "@/lib/agents/qualite-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Qualité" };
export const dynamic = "force-dynamic";

const ASK_HINT =
  "Demandez à Kevin : « comment va le contrôle qualité ? », « montre-moi les refus de cette semaine », « pourquoi le post 42 a été refusé ? ».";

/**
 * Agents → Qualité (phase 30) : le contrôle qualité global, dernier verrou avant toute sortie. Trois vues : Tableau de
 * bord (par défaut), Historique (filtres et détail d'une vérification, contenu masqué), Tendances. LECTURE SEULE pour
 * les responsables et les administrateurs : aucun geste n'accepte un contenu à la place du contrôle.
 */
export default async function AgentsQualitePage({ searchParams }: PageProps<"/agents/qualite">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const view = parseQualiteView(sp.vue);
  const filters = parseQualiteFilters(sp);
  const step = parseQualiteStep(sp.pas);
  const detailId = view === "historique" ? safeCheckId(sp.voir) : null;
  const now = new Date();
  const [pending, state, week, history, teams, detail, month] = await Promise.all([
    loadPendingCounts(),
    loadQaState(),
    view === "tableau" ? loadQaRows(7, now) : Promise.resolve(null),
    view === "historique" ? loadHistory(filters) : Promise.resolve(null),
    view === "historique" ? loadQaTeams() : Promise.resolve([] as string[]),
    detailId ? loadCheck(detailId) : Promise.resolve(null),
    view === "tendances" ? loadQaRows(28, now) : Promise.resolve(null),
  ]);
  const paused = qaPaused(state.latest, now);

  return (
    <>
      <AgentsNav current="qualite" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Qualité"
        description="Le contrôle qualité global relit tout ce que produisent les agents avant que ça sorte : posts, shorts, rapports, recommandations, alertes et réponses de Kevin. Il accepte ou il bloque, sans jamais rien modifier ; l'équipe corrige."
        help={ASK_HINT}
        secondaryActions={
          <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Parler à Kevin
          </Link>
        }
      />

      {!state.enabled ? (
        <p role="status" className="mb-6 rounded-xl border border-border bg-muted px-4 py-3 text-body text-foreground">
          Le contrôle qualité global est coupé dans les réglages : les contenus des agents ne sortent pas sans lui.
        </p>
      ) : paused ? (
        <p role="status" className="mb-6 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-body text-foreground">
          <span className="font-semibold">En pause</span> : le modèle du contrôle ne répond plus. Rien ne sort en attendant ;
          les contenus repassent au contrôle dès son retour, jamais acceptés par défaut.
        </p>
      ) : null}

      <FilterChips
        label="Vue"
        className="mb-6"
        chips={QUALITE_VIEWS.map((v) => ({ key: v, label: QUALITE_VIEW_LABELS[v], href: qualiteHref(v), selected: view === v }))}
      />

      {week ? <QualiteDashboardView rows={week} now={now} step={step} /> : null}
      {history ? <QualiteHistoryView filters={filters} rows={history.rows} total={history.total} teams={teams} detail={detail} /> : null}
      {month ? <QualiteTrendsView rows={month} now={now} /> : null}
    </>
  );
}
