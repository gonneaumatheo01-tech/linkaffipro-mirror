import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Term } from "./help-tip";
import {
  hasTrend,
  nothingBefore,
  sparklinePath,
  variationArrow,
  variationLabel,
  variationSentence,
  variationToneOf,
  type Favorable,
  type Variation,
} from "./stat-card-logic";

const TONE_TEXT = {
  positive: "text-success",
  negative: "text-danger",
  neutral: "text-muted-foreground",
} as const;

const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** Variation d'une carte : « delta » en % déjà calculé (ancienne forme) ou variation complète (`variationBetween`). */
function toVariation(delta: number | null | undefined): Variation {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return { kind: "unknown" };
  return { kind: "pct", pct: delta };
}

/**
 * Variation en ligne (flèche + « +12 % » ou « nouveau », colorée selon le sens favorable) avec sa phrase complète
 * pour les lecteurs d'écran. `withComparison` : la fin de phrase visible à côté (« vs hier » ; « rien hier » pour
 * « nouveau »). Rien n'est rendu quand les deux valeurs sont nulles (`kind: "none"`) ; « — » sans comparaison.
 * Partagée par `StatCard` et les chiffres des cartes de campagne (`FigureDelta`).
 */
export function VariationText({
  variation,
  favorable = "up",
  comparison = "vs période précédente",
  withComparison = false,
  className,
}: {
  variation: Variation;
  favorable?: Favorable;
  comparison?: string;
  withComparison?: boolean;
  className?: string;
}) {
  if (variation.kind === "none") return null;
  if (variation.kind === "unknown")
    return (
      <span className={cn("text-note text-muted-foreground", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">{variationSentence(variation, comparison)}</span>
      </span>
    );
  const direction = variationArrow(variation);
  const Arrow = direction ? ARROWS[direction] : Minus;
  const tail = variation.kind === "new" ? nothingBefore(comparison) : comparison;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 text-note", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium whitespace-nowrap tabular-nums",
          TONE_TEXT[variationToneOf(variation, favorable)],
        )}
      >
        <Arrow aria-hidden className="size-3.5" />
        <span aria-hidden>{variationLabel(variation)}</span>
        <span className="sr-only">{variationSentence(variation, comparison)}</span>
      </span>
      {withComparison && tail ? (
        <span aria-hidden className="text-muted-foreground">
          {tail}
        </span>
      ) : null}
    </span>
  );
}

const SPARK_W = 96;
const SPARK_H = 32;

/**
 * Mini-courbe SVG (sans dépendance) : ligne et point final en orange foncé `brand-ink` (5,4:1 sur blanc, lisible
 * au soleil), remplissage orange de marque à 12 %. Masquée aux lecteurs d'écran : le chiffre et la variation
 * portent l'information. Rien n'est dessiné sous deux points ou quand toutes les valeurs sont nulles (`hasTrend`).
 */
export function MiniTrend({
  values,
  className,
}: {
  values: readonly number[];
  className?: string;
}) {
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
 * - `variation` : variation complète d'après la valeur et sa base (`variationBetween(aujourdhui, hier)`) :
 *   « nouveau » quand la base vaut 0, rien quand les deux valent 0, % plafonné à ±999 % sinon. Prime sur `delta` ;
 * - `delta` : variation en % déjà calculée (ex. `deltaPct(aujourdhui, hier)`), null = pas de comparaison ;
 *   affichage plafonné à « > +999 % » (`formatVariation`). Préférer `variation`, qui connaît la base ;
 * - `favorable` : « up » (par défaut), « down » pour un coût, « none » pour un chiffre neutre ;
 * - `term` : terme technique affiché au survol du libellé (ex. « FTD »).
 */
export function StatCard({
  label,
  value,
  variation,
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
  /** Variation d'après la valeur et sa base (`variationBetween`) ; prime sur `delta`. */
  variation?: Variation;
  delta?: number | null;
  favorable?: Favorable;
  /** Fin de phrase de la variation : « vs hier », « vs les 7 jours précédents »… */
  comparison?: string;
  /** Série de la mini-courbe ; une série toute à zéro n'est pas dessinée (`hasTrend`). */
  trend?: readonly number[];
  href?: string;
  term?: string;
  /** Une ligne grise sous la variation (précision, période). */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const shown: Variation | null = variation ?? (delta !== undefined ? toVariation(delta) : null);

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
        {hasTrend(trend) ? <MiniTrend values={trend} className="mb-1" /> : null}
      </div>
      {shown?.kind === "unknown" ? (
        <p className="text-note text-muted-foreground">Pas de comparaison possible</p>
      ) : null}
      {shown && (shown.kind === "pct" || shown.kind === "new") ? (
        <div className="flex">
          <VariationText
            variation={shown}
            favorable={favorable}
            comparison={comparison}
            withComparison
          />
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
