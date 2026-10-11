"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import {
  areaPath,
  axisMargin,
  barPath,
  barWidth,
  chartAltText,
  closesOnPointerLeave,
  exactValue,
  formatAxis,
  formatValue,
  hasData,
  linePath,
  nearestIndex,
  niceTicks,
  plotBox,
  seriesPoints,
  tooltipLeft,
  xAt,
  xLabelIndices,
  yAt,
  type ChartFormat,
} from "./chart-logic";

/** Une série : la période choisie (`current`, orange) ou la période précédente (`previous`, gris). */
export type ChartSeries = {
  id: string;
  label: string;
  values: number[];
  tone: "current" | "previous";
};

const DEFAULT_WIDTH = 640;
const TOOLTIP_WIDTH = 208;
const PAD = { right: 12, top: 12, bottom: 28 };

/**
 * Graphique de la période (SVG maison, sans bibliothèque) : courbe avec surface pâle (`kind="line"`) ou barres
 * (`kind="bar"`), la période précédente en gris quand elle est fournie. Réticule et bulle au survol, au toucher et
 * au clavier (flèches gauche / droite, Début, Fin), texte alternatif complet (titre, total, plus haut, plus bas),
 * et le tableau des valeurs dans un bloc repliable : la bulle n'est jamais le seul moyen de lire un chiffre.
 * Couleurs du thème seulement : ligne `brand-ink` (5,4:1 sur blanc), surface et barres orange de marque,
 * période précédente `muted-foreground`, grille `border`.
 */
export function TimeChart({
  title,
  period,
  labels,
  previousLabels,
  series,
  format,
  integer = false,
  kind = "line",
  height = 220,
  unitLabel = "Jour",
  valuesSummary = "Voir les chiffres jour par jour",
  className,
}: {
  /** Nom du graphique (« Membres entrés jour par jour ») : titre du dessin pour les lecteurs d'écran. */
  title: string;
  /** Période en mots (« 7 derniers jours »), reprise dans le texte alternatif. */
  period?: string;
  /** Libellé de chaque point (« 4 oct. »). */
  labels: string[];
  /** Libellés de la période précédente (bulle, tableau). */
  previousLabels?: string[];
  series: ChartSeries[];
  format: ChartFormat;
  /** Comptes entiers : pas de graduation décimale. */
  integer?: boolean;
  kind?: "line" | "bar";
  height?: number;
  /** En-tête de la première colonne du tableau des valeurs. */
  unitLabel?: string;
  valuesSummary?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Au toucher, la bulle reste après l'appui (voir `closesOnPointerLeave`) : un appui ailleurs sur la page la ferme.
  const shown = active !== null;
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target))
        setActive(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [shown]);

  const n = labels.length;
  const mode = kind === "bar" ? "band" : "point";
  const current = series.find((s) => s.tone === "current") ?? series[0];
  const previous = series.find((s) => s.tone === "previous");

  const layout = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const ticks = niceTicks(all, height < 160 ? 3 : 4, integer);
    const tickLabels = ticks.ticks.map((t) => formatAxis(t, format));
    const box = plotBox(width, height, { left: axisMargin(tickLabels), ...PAD });
    const zeroY = yAt(0, ticks, box);
    const plotW = box.right - box.left;
    const xIdx = xLabelIndices(n, Math.max(2, Math.floor(plotW / 68)));
    return { ticks, tickLabels, box, zeroY, xIdx };
  }, [series, width, height, integer, format, n]);

  const { ticks, tickLabels, box, zeroY, xIdx } = layout;
  const band = n > 0 ? (box.right - box.left) / n : 0;
  const bw = barWidth(band);
  const empty = !hasData(series);
  const alt = chartAltText(
    title,
    series.map((s) => ({ label: s.label, values: s.values })),
    labels,
    format,
    { period, previousLabels },
  );

  const move = (clientX: number) => {
    const el = ref.current;
    if (!el || n === 0) return;
    const x = clientX - el.getBoundingClientRect().left;
    setFromKeyboard(false);
    setActive(nearestIndex(x, n, box, mode));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    const next =
      e.key === "ArrowLeft"
        ? Math.max(0, cur - 1)
        : e.key === "ArrowRight"
          ? Math.min(n - 1, cur + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setFromKeyboard(true);
    setActive(next);
  };

  const activeX = active !== null ? xAt(active, n, box, mode) : 0;
  const readout =
    active !== null
      ? series
          .map((s) => {
            // Le jour de la période choisie est déjà en tête de l'annonce ; la période précédente a le sien.
            const day = s.tone === "previous" ? previousLabels?.[active] : undefined;
            return `${s.label}${day ? ` (${day})` : ""} : ${exactValue(s.values[active] ?? 0, format)}`;
          })
          .join(" ; ")
      : "";

  return (
    <div className={cn("min-w-0", className)}>
      {previous ? (
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-note text-muted-foreground">
          {series.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "inline-block h-0.5 w-4 rounded-full",
                  s.tone === "current" ? "bg-brand-ink" : "bg-muted-foreground",
                )}
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={ref}
        role="group"
        tabIndex={empty ? undefined : 0}
        aria-label={`${title} : flèches gauche et droite pour lire chaque valeur`}
        onPointerMove={(e) => move(e.clientX)}
        onPointerDown={(e) => move(e.clientX)}
        onPointerLeave={(e) => {
          if (closesOnPointerLeave(e.pointerType)) setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (active === null && n > 0 && !empty) {
            setFromKeyboard(true);
            setActive(n - 1);
          }
        }}
        onBlur={() => setActive(null)}
        className="relative touch-pan-y rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ height }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="block overflow-visible"
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{alt}</desc>
          {/* Grille : traits fins pleins, une nuance au-dessus du fond. */}
          {ticks.ticks.map((t, i) => {
            const y = yAt(t, ticks, box);
            return (
              <g key={t}>
                <line
                  x1={box.left}
                  x2={box.right}
                  y1={y}
                  y2={y}
                  strokeWidth={1}
                  className={
                    t === 0 && ticks.min < 0 ? "stroke-muted-foreground/60" : "stroke-border"
                  }
                />
                <text
                  x={box.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  aria-hidden
                  className="fill-muted-foreground text-note tabular-nums"
                >
                  {tickLabels[i]}
                </text>
              </g>
            );
          })}
          {xIdx.map((i) => (
            <text
              key={i}
              x={xAt(i, n, box, mode)}
              y={height - 8}
              textAnchor={
                mode === "point" && n > 1 && i === 0
                  ? "start"
                  : mode === "point" && n > 1 && i === n - 1
                    ? "end"
                    : "middle"
              }
              aria-hidden
              className="fill-muted-foreground text-note"
            >
              {labels[i]}
            </text>
          ))}

          {!empty && current && kind === "bar"
            ? current.values.map((v, i) => {
                const d = barPath(xAt(i, n, box, "band"), bw, zeroY, yAt(v, ticks, box));
                return d ? (
                  <path
                    key={i}
                    d={d}
                    className={cn(
                      "transition-colors",
                      active === i ? "fill-brand-ink" : "fill-brand",
                    )}
                  />
                ) : null;
              })
            : null}

          {!empty && previous ? (
            <path
              d={linePath(seriesPoints(previous.values, ticks, box, mode))}
              fill="none"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-muted-foreground"
            />
          ) : null}

          {!empty && current && kind === "line" ? (
            <>
              <path
                d={areaPath(seriesPoints(current.values, ticks, box), zeroY)}
                className="fill-brand"
                fillOpacity={0.12}
              />
              <path
                d={linePath(seriesPoints(current.values, ticks, box))}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-brand-ink"
              />
              {n === 1 ? (
                <circle
                  cx={xAt(0, 1, box)}
                  cy={yAt(current.values[0] ?? 0, ticks, box)}
                  r={4}
                  strokeWidth={2}
                  className="fill-brand-ink stroke-surface"
                />
              ) : null}
            </>
          ) : null}

          {/* Réticule et points de la valeur survolée. */}
          {!empty && active !== null ? (
            <g aria-hidden>
              <line
                x1={activeX}
                x2={activeX}
                y1={box.top}
                y2={box.bottom}
                strokeWidth={1}
                className="stroke-foreground/30"
              />
              {series.map((s) =>
                kind === "bar" && s.tone === "current" ? null : (
                  <circle
                    key={s.id}
                    cx={activeX}
                    cy={yAt(s.values[active] ?? 0, ticks, box)}
                    r={4}
                    strokeWidth={2}
                    className={cn(
                      "stroke-surface",
                      s.tone === "current" ? "fill-brand-ink" : "fill-muted-foreground",
                    )}
                  />
                ),
              )}
            </g>
          ) : null}
        </svg>

        {empty ? (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-body text-muted-foreground">
            Rien sur cette période pour ce chiffre.
          </p>
        ) : null}

        {!empty && active !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-popover px-3 py-2 text-note shadow-md"
            style={{ left: tooltipLeft(activeX, TOOLTIP_WIDTH, width), width: TOOLTIP_WIDTH }}
          >
            <p className="mb-1 font-medium text-foreground">{labels[active]}</p>
            <ul className="space-y-0.5">
              {series.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-0.5 w-3 shrink-0 rounded-full",
                      s.tone === "current" ? "bg-brand-ink" : "bg-muted-foreground",
                    )}
                  />
                  <span className="text-body font-semibold text-foreground tabular-nums">
                    {exactValue(s.values[active] ?? 0, format)}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {s.tone === "previous" && previousLabels?.[active]
                      ? previousLabels[active]
                      : s.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* Annonce au clavier de la valeur choisie (la bulle n'est qu'un repère visuel). */}
        <p className="sr-only" aria-live="polite">
          {fromKeyboard && active !== null ? `${labels[active] ?? ""} : ${readout}` : ""}
        </p>
      </div>

      {n > 0 ? (
        <details className="group/values mt-3 text-body">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-md text-note font-medium text-muted-foreground hover:text-foreground max-md:min-h-10">
            {valuesSummary}
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-body">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-note text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {unitLabel}
                  </th>
                  {series.map((s) => (
                    <th key={s.id} scope="col" className="px-3 py-2 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((l, i) => (
                  <tr key={`${l}-${i}`} className="border-t border-border">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {l}
                    </th>
                    {series.map((s) => (
                      <td key={s.id} className="px-3 py-1.5 text-right tabular-nums">
                        {formatValue(s.values[i] ?? 0, format)}
                        {s.tone === "previous" && previousLabels?.[i] ? (
                          <span className="ml-1 text-note text-muted-foreground">
                            ({previousLabels[i]})
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
