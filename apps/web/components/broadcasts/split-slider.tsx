"use client";

import { cn } from "@/components/ui/cn";
import { rangeFillPercent } from "@/lib/broadcasts/wizard";

/**
 * Curseur natif (champ de type `range`) aux couleurs du thème : piste grise remplie en orange jusqu'à la poignée,
 * poignée orange cerclée d'orange foncé ; au clavier, le contour de focus commun à toute l'interface. Sans style,
 * Chromium assombrit la piste quand la couleur d'accent est claire (piste presque noire sur le thème clair).
 * Zone de 40 px de haut pour le doigt.
 */
export function SplitSlider({
  id,
  value,
  min,
  max,
  step,
  onChange,
  valueText,
  className,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Valeur lue par les lecteurs d'écran (« 50 % pour la version A, 50 % pour la version B »). */
  valueText: string;
  className?: string;
}) {
  const fill = rangeFillPercent(value, min, max);
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-valuetext={valueText}
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
      className={cn(
        "h-10 w-full cursor-pointer appearance-none rounded-md bg-transparent",
        // Chromium, Safari : piste remplie par un dégradé net à la position de la poignée.
        "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-brand)_var(--fill),var(--color-border)_var(--fill))]",
        "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-ink [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-xs",
        // Firefox : piste et partie remplie séparées.
        "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border",
        "[&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-brand",
        "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-ink [&::-moz-range-thumb]:bg-brand",
        className,
      )}
    />
  );
}
