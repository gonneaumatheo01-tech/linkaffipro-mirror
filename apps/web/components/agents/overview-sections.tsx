import Link from "next/link";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recommendationAction } from "@/app/(admin)/agents/[equipe]/algo-actions";
import { setPausedAllAction } from "@/app/(admin)/agents/settings/actions";
import { ACTION_WORDS, canActOnRecommendation, fieldLabel, isBigRecommendation } from "@/lib/agents/algo/recommendations";
import type { AppliedRecommendation } from "@/lib/agents/overview";
import { sortApplied, type AgentsOverview } from "@/lib/agents/overview-view";
import { teamName } from "@/lib/agents/teams";
import { fmtDate, fmtNum } from "@/lib/format";
import { Undo2 } from "lucide-react";

/** Bouton « Tout mettre en pause » / « Tout reprendre » du tableau de bord (administrateurs). */
export function PausedAllButton({ pausedAll }: { pausedAll: boolean }) {
  return (
    <form action={setPausedAllAction}>
      <input type="hidden" name="paused" value={pausedAll ? "0" : "1"} />
      <input type="hidden" name="from" value="/agents" />
      {pausedAll ? (
        <Button type="submit" variant="outline" className="max-md:h-10 max-md:w-full">
          Tout reprendre
        </Button>
      ) : (
        <ConfirmSubmit
          variant="outline"
          className="max-md:h-10 max-md:w-full"
          destructive
          confirmTitle="Mettre toutes les équipes en pause ?"
          confirmLabel="Tout mettre en pause"
          message="Plus aucune équipe ne crée ni ne poursuit de mission, jusqu'à ce que vous cliquiez sur « Tout reprendre »."
        >
          Pause générale
        </ConfirmSubmit>
      )}
    </form>
  );
}

type Tile = { key: string; label: string; value: number; href: string | null; hint: string; tone: "warning" | "neutral" };

/** Bandeau « ce qui vous attend » : validations, demandes, alertes, tests A/B. */
export function AttentionStrip({ overview, isAdmin }: { overview: AgentsOverview; isAdmin: boolean }) {
  const tiles: Tile[] = [
    {
      key: "validations",
      label: "Validations à faire",
      value: overview.pendingValidations,
      href: "/agents/validations",
      hint: "Posts qui attendent « Publier » ou « Refuser ».",
      tone: overview.pendingValidations > 0 ? "warning" : "neutral",
    },
    {
      key: "requests",
      label: "Demandes du bot",
      value: overview.openHumanRequests,
      href: "/agents/validations?tab=demandes",
      hint: "Questions posées par le bot sur Telegram.",
      tone: overview.openHumanRequests > 0 ? "warning" : "neutral",
    },
    {
      key: "alerts",
      label: "Alertes ouvertes",
      value: overview.openAlerts,
      href: isAdmin ? "/settings/alerts" : null,
      hint: "Équipe en pause, plafond proche, canal en baisse…",
      tone: overview.openAlerts > 0 ? "warning" : "neutral",
    },
    {
      key: "experiments",
      label: "Tests A/B en cours",
      value: overview.experimentsRunning,
      href: "/agents/algo#tests",
      hint: "Deux versions comparées par l'équipe Algorithme.",
      tone: "neutral",
    },
  ];
  return (
    <section aria-label="Ce qui vous attend" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="block text-note text-muted-foreground">{t.label}</span>
            <span
              className={cn(
                "block text-figure font-semibold tabular-nums",
                t.tone === "warning" ? "text-warning" : "text-foreground",
              )}
            >
              {fmtNum(t.value)}
            </span>
            <span className="block text-note text-muted-foreground">{t.hint}</span>
          </>
        );
        return t.href ? (
          <Link
            key={t.key}
            href={t.href}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {body}
          </Link>
        ) : (
          <div key={t.key} className="rounded-xl border border-border bg-card p-4">
            {body}
          </div>
        );
      })}
    </section>
  );
}

/** Réglages appliqués cette semaine par l'équipe Algorithme, avec « Annuler » (petits réglages : tous ; gros : administrateurs). */
export function AppliedSettings({ rows, role }: { rows: AppliedRecommendation[]; role: string }) {
  return (
    <FormSection
      id="reglages-appliques"
      title="Réglages appliqués cette semaine"
      description="Ce que l'équipe Algorithme a changé chez les autres équipes depuis lundi. « Annuler » remet la valeur d'avant."
      actions={
        <Link href="/agents/algo#recommandations" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}>
          Toutes les propositions
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Undo2 />}
          title="Aucun réglage appliqué cette semaine"
          description="Les propositions de l'équipe Algorithme arrivent chaque lundi ; elles s'appliquent selon son niveau."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {sortApplied(rows).map((r) => {
            const big = isBigRecommendation(r);
            const allowed = canActOnRecommendation(role, r);
            const undoable = r.status === "APPLIED";
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-body text-foreground">
                    {fieldLabel(r.field)} · {r.targetLabel}
                  </p>
                  <p className="text-note text-muted-foreground">
                    Équipe {teamName(r.teamKey)} · appliqué le {fmtDate(new Date(r.appliedAt))}
                  </p>
                </div>
                {big ? <StatusPill tone="neutral">Gros réglage</StatusPill> : null}
                {!undoable ? (
                  <StatusPill tone="muted">Déjà annulé</StatusPill>
                ) : allowed ? (
                  <form action={recommendationAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="action" value="undo" />
                    <input type="hidden" name="from" value="/agents" />
                    <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                      {ACTION_WORDS.undo.button}
                    </Button>
                  </form>
                ) : (
                  <span className="text-note text-muted-foreground">Annulation réservée aux administrateurs</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FormSection>
  );
}
