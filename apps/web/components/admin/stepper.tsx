import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { clampStep, stepProgress, stepState, stepSummary } from "./stepper-logic";

export type StepperStep = { key?: string; title: string; help?: string };

/**
 * Étapes d'un assistant : numérotées, l'étape en cours en orange, les étapes faites cochées, les suivantes
 * en gris ; la ligne d'aide de l'étape en cours dessous. Horizontal sur ordinateur, compact sur téléphone
 * (« Étape 2 sur 4 · Offres » et une barre d'avancement).
 * - `current` : index de l'étape en cours (à partir de 0) ;
 * - `onStepClick` : rend les étapes déjà faites cliquables pour y revenir (composant client seulement).
 * Navigation : `<nav aria-label>` + liste ordonnée, `aria-current="step"` sur l'étape en cours.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
  label = "Étapes",
  showHelp = true,
  className,
}: {
  steps: ReadonlyArray<StepperStep>;
  current: number;
  onStepClick?: (index: number) => void;
  label?: string;
  showHelp?: boolean;
  className?: string;
}) {
  if (steps.length === 0) return null;
  const cur = clampStep(current, steps.length);
  const help = steps[cur]?.help;
  return (
    <nav aria-label={label} data-slot="stepper" className={cn("space-y-3", className)}>
      {/* Téléphone : une ligne et une barre d'avancement. */}
      <div className="md:hidden">
        <p className="text-body font-semibold text-foreground" aria-current="step">
          {stepSummary(steps, cur)}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${stepProgress(cur, steps.length)}%` }}
          />
        </div>
      </div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 max-md:hidden">
        {steps.map((s, i) => {
          const state = stepState(i, cur);
          const clickable = Boolean(onStepClick) && state === "done";
          const circle = (
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-note font-semibold tabular-nums",
                state === "current" && "border-brand bg-brand text-brand-foreground",
                state === "done" && "border-success/30 bg-success-soft text-success",
                state === "upcoming" && "border-border bg-surface text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-4" /> : i + 1}
            </span>
          );
          const text = (
            <span
              className={cn(
                "text-body whitespace-nowrap",
                state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {s.title}
              <span className="sr-only">
                {state === "done" ? " (faite)" : state === "current" ? " (en cours)" : " (à venir)"}
              </span>
            </span>
          );
          return (
            <li
              key={s.key ?? i}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(i)}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg px-1 hover:bg-muted"
                  title={`Revenir à l'étape ${i + 1}`}
                >
                  {circle}
                  {text}
                </button>
              ) : (
                <span className="inline-flex min-h-9 items-center gap-2 px-1">
                  {circle}
                  {text}
                </span>
              )}
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-6 shrink-0 lg:w-10",
                    i < cur ? "bg-success/40" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {showHelp && help ? <p className="text-body text-muted-foreground">{help}</p> : null}
    </nav>
  );
}
