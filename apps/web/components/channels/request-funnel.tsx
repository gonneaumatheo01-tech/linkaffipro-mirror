"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { FigureDelta } from "@/components/campaigns/campaign-figure";
import { BarList } from "@/components/charts/bar-list";
import { cn } from "@/components/ui/cn";
import type {
  FunnelGroupDisplay,
  FunnelPeriodView,
  FunnelStepDisplay,
  FunnelView,
} from "@/lib/channels/request-funnel";

/**
 * Parcours des demandes (phase 14, décision E9) : les demandes de la période et ce qu'elles sont devenues (accueil
 * envoyé, ont bloqué le bot, canaux rejoints, acceptées, parties), en barres lisibles sans couleur (`BarList`), puis
 * une ligne par provenance (pub, canal d'origine, lien) avec le détail au clic. Composant client : il ne reçoit que
 * des données déjà calculées par le serveur (`funnelView`), jamais d'accès à la base.
 *
 * - Plusieurs périodes (onglet « Demandes » de la fiche canal) : pastilles « Aujourd'hui / 7 derniers jours / 30
 *   derniers jours », instantanées (toutes calculées d'avance).
 * - Une seule période (Statistiques → Canaux, période du sélecteur commun) : pas de pastilles ; avec la comparaison,
 *   « Avant : X » et la variation sous chaque étape.
 * - Beaucoup de vrais blocages (même seuil que l'alerte Telegram) : avertissement en tête, avec le lien vers le message
 *   d'accueil (`welcomeHref`).
 */
export function RequestFunnel({
  periods,
  defaultKey,
  welcomeHref,
  compare = false,
}: {
  periods: FunnelPeriodView[];
  defaultKey?: string;
  /** « Modifier le message d'accueil » sous l'avertissement (fiche canal → « Ce que dit le bot »). */
  welcomeHref?: string;
  /** Période précédente montrée sous chaque étape. */
  compare?: boolean;
}) {
  const [current, setCurrent] = useState(
    periods.some((p) => p.key === defaultKey) ? defaultKey! : (periods[0]?.key ?? ""),
  );
  const selected = periods.find((p) => p.key === current) ?? periods[0];
  if (!selected) return null;
  return (
    <div className="space-y-5">
      {periods.length > 1 ? (
        <PeriodChips periods={periods} current={selected.key} onChange={setCurrent} />
      ) : null}
      <FunnelBody
        key={selected.key}
        view={selected.view}
        period={selected.label}
        welcomeHref={welcomeHref}
        compare={compare}
      />
    </div>
  );
}

/** Pastilles de période (boutons à bascule, même allure que `FilterChips`). */
function PeriodChips({
  periods,
  current,
  onChange,
}: {
  periods: FunnelPeriodView[];
  current: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Période du parcours"
      className="flex min-w-0 items-center gap-2 max-md:items-start"
    >
      <span
        aria-hidden
        className="w-14 shrink-0 text-note font-medium text-muted-foreground max-md:pt-3"
      >
        Période
      </span>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {periods.map((p) => {
          const on = p.key === current;
          return (
            <li key={p.key} className="shrink-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(p.key)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-note font-medium whitespace-nowrap transition-colors max-md:h-10",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  on
                    ? "border-brand bg-brand-soft text-brand-ink"
                    : "border-border bg-surface text-foreground hover:bg-muted",
                )}
              >
                {p.label}
                <span
                  className={cn("tabular-nums", on ? "text-brand-ink" : "text-muted-foreground")}
                >
                  {p.view.steps[0]?.valueText ?? "0"}
                  <span className="sr-only"> demandes</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FunnelBody({
  view,
  period,
  welcomeHref,
  compare,
}: {
  view: FunnelView;
  period: string;
  welcomeHref?: string;
  compare: boolean;
}) {
  const groupsId = useId();
  if (view.empty)
    return (
      <p className="text-body text-muted-foreground">
        Aucune demande sur cette période ({period.toLowerCase()}).
      </p>
    );
  return (
    <div className="space-y-5">
      {view.warning ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-body text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0">
            {view.warning}
            {welcomeHref ? (
              <>
                {" "}
                <Link
                  href={welcomeHref}
                  className="font-medium text-brand-ink underline underline-offset-4 max-md:inline-flex max-md:min-h-10 max-md:items-center"
                >
                  Modifier le message d&apos;accueil
                </Link>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      <FunnelSteps
        steps={view.steps}
        label={`Parcours des demandes, ${period.toLowerCase()}`}
        compare={compare}
      />
      {view.unreachable ? <UnreachableNote text={view.unreachable} /> : null}
      {view.groups.length > 1 ? (
        <section aria-labelledby={groupsId} className="space-y-3">
          <div>
            <h3 id={groupsId} className="text-body font-semibold text-foreground">
              Par provenance
            </h3>
            <p className="text-note text-muted-foreground">
              Chaque pub, chaque canal d&apos;où viennent les personnes, chaque lien. Cliquez sur
              une ligne pour tout son parcours.
            </p>
          </div>
          <ProvenanceTable groups={view.groups} period={period} />
        </section>
      ) : view.groups[0] ? (
        <p className="text-note text-muted-foreground">
          Toutes ces demandes viennent de :{" "}
          <span className="text-foreground">{view.groups[0].label}</span>.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Les étapes en barres : le nombre à droite ; la part et, avec la comparaison, la période précédente SOUS le nom de
 * l'étape (sur téléphone, la colonne des chiffres reste étroite : une longue précision y écraserait le nom).
 */
function FunnelSteps({
  steps,
  label,
  compare,
}: {
  steps: FunnelStepDisplay[];
  label: string;
  compare: boolean;
}) {
  return (
    <BarList
      label={label}
      max={steps[0]?.value}
      items={steps.map((s) => ({
        key: s.key,
        title: s.hint,
        value: s.value,
        valueText: s.valueText,
        label: (
          <>
            <span className="block">{s.label}</span>
            {s.note ? (
              <span className="block text-note text-muted-foreground">{s.note}</span>
            ) : null}
            {compare && s.previousText !== undefined ? (
              <span className="flex flex-wrap items-center gap-x-2 text-note text-muted-foreground">
                <span className="tabular-nums">Avant : {s.previousText}</span>
                {s.variation ? (
                  <FigureDelta variation={s.variation} favorable={s.favorable} />
                ) : null}
              </span>
            ) : null}
          </>
        ),
      }))}
    />
  );
}

function UnreachableNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-note text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/** Une ligne par provenance (4 colonnes, 3 sur téléphone), tout le parcours de la provenance dans le volet. */
function ProvenanceTable({ groups, period }: { groups: FunnelGroupDisplay[]; period: string }) {
  const rows: DataTableRow[] = groups.map((g) => ({
    id: g.key,
    detailTitle: g.label,
    detailDescription: `${period} · ${g.summary}`,
    cells: {
      label: <span className="min-w-0 break-words">{g.label}</span>,
      requests: g.cells.requests,
      blocked: g.cells.blocked,
      allJoined: g.cells.allJoined,
      accepted: g.cells.accepted,
    },
    sortValues: {
      label: g.label,
      requests: g.sort.requests,
      blocked: g.sort.blocked,
      allJoined: g.sort.allJoined,
      accepted: g.sort.accepted,
    },
    detail: (
      <div className="space-y-4">
        <FunnelSteps steps={g.steps} label={`Parcours des demandes, ${g.label}`} compare={false} />
        {g.unreachable ? <UnreachableNote text={g.unreachable} /> : null}
      </div>
    ),
  }));
  return (
    <DataTable
      label="Parcours des demandes par provenance"
      columns={[
        { key: "label", header: "Provenance", className: "max-md:whitespace-normal" },
        { key: "requests", header: "Demandes", align: "right" },
        { key: "blocked", header: "Ont bloqué le bot", align: "right" },
        {
          key: "allJoined",
          header: "Tous les canaux rejoints",
          align: "right",
          hideOnMobile: true,
        },
        { key: "accepted", header: "Acceptées", align: "right", hideOnMobile: true },
      ]}
      rows={rows}
    />
  );
}
