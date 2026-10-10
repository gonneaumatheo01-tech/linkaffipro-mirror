import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Term } from "./help-tip";
import {
  formatVariation,
  sparklinePath,
  variationSummary,
  variationTone,
  type Favorable,
} from "./stat-card-logic";

const TONE_TEXT = {
  positive: "text-success",
  negative: "text-danger",
  neutral: "text-muted-foreground",
} as const;

const SPARK_W = 96;
const SPARK_H = 32;

/**
 * Mini-courbe SVG (sans dépendance) : ligne et point final en orange foncé `brand-ink` (5,4:1 sur blanc, lisible
 * au soleil), remplissage orange de marque à 12 %. Masquée aux lecteurs d'écran : le chiffre et la variation
 * portent l'information.
 */
export function MiniTrend({ values, className }: { values: number[]; className?: string }) {
  const p = sparklinePath(values, SPARK_W, SPARK_H, 3);
  if (!p) return null;
  return (
    <svg
      aria-hidden
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className={cn("shrink-0 overflow-visible text-brand-ink", className)}
    >
      <path d={p.area} className="fill-brand" fillOpacity={0.12} />
      <path
        d={p.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={p.last.x} cy={p.last.y} r={2.5} fill="currentColor" />
    </svg>
  );
}

/**
 * Carte de chiffre : libellé (note grise), gros chiffre (28 px, chiffres tabulaires), variation colorée
 * (flèche + %, verte si favorable), mini-courbe facultative, lien facultatif (toute la carte est cliquable).
 * - `delta` : variation en % déjà calculée (ex. `deltaPct(aujourdhui, hier)`), null = pas de comparaison ;
 * - `favorable` : « up » (par défaut), « down » pour un coût, « none » pour un chiffre neutre ;
 * - `term` : terme technique affiché au survol du libellé (ex. « FTD »).
 */
export function StatCard({
  label,
  value,
  delta,
  favorable = "up",
  comparison = "vs période précédente",
  trend,
  href,
  term,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  favorable?: Favorable;
  /** Fin de phrase de la variation : « vs hier », « vs les 7 jours précédents »… */
  comparison?: string;
  trend?: number[];
  href?: string;
  term?: string;
  /** Une ligne grise sous la variation (précision, période). */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const showDelta = delta !== undefined;
  const tone = variationTone(delta, favorable);
  const rounded = formatVariation(delta);
  const Arrow =
    delta === null || delta === undefined || rounded === "0 %"
      ? Minus
      : delta > 0
        ? ArrowUpRight
        : ArrowDownRight;

  const body = (
    <>
      <div className="flex items-center gap-2 text-note font-medium text-muted-foreground">
        {icon ? <span className="[&>svg]:size-4">{icon}</span> : null}
        <Term term={term}>{label}</Term>
        {href ? (
          <ChevronRight
            aria-hidden
            className="ml-auto size-4 shrink-0 transition-transform group-hover/stat:translate-x-0.5"
          />
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 truncate text-figure text-foreground tabular-nums">{value}</div>
        {trend ? <MiniTrend values={trend} className="mb-1" /> : null}
      </div>
      {showDelta && (delta === null || !Number.isFinite(delta)) ? (
        <p className="text-note text-muted-foreground">Pas de comparaison possible</p>
      ) : null}
      {showDelta && delta !== null && Number.isFinite(delta) ? (
        <div className="flex flex-wrap items-center gap-x-1.5 text-note">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium whitespace-nowrap tabular-nums",
              TONE_TEXT[tone],
            )}
          >
            <Arrow aria-hidden className="size-3.5" />
            <span aria-hidden>{rounded}</span>
            <span className="sr-only">{variationSummary(delta, comparison)}</span>
          </span>
          <span aria-hidden className="text-muted-foreground">
            {comparison}
          </span>
        </div>
      ) : null}
      {hint ? <p className="text-note text-muted-foreground">{hint}</p> : null}
    </>
  );

  const base = "flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-4";
  if (href) {
    return (
      <Link
        href={href}
        data-slot="stat-card"
        className={cn(
          base,
          "group/stat transition-colors hover:border-brand/50 hover:bg-brand-soft/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="stat-card" className={cn(base, className)}>
      {body}
    </div>
  );
}
