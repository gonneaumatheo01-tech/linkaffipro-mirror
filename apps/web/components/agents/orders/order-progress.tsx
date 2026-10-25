import { progressPercent, progressText } from "@/lib/agents/orders";

type Figures = { planned: number; done: number; failed: number; waiting: number };

/** Progression d'un ordre : phrase (« 4 sur 6 faites · 1 en échec ») et barre, la barre est décorative. */
export function OrderProgress({ figures, status }: { figures: Figures; status: string }) {
  const pct = progressPercent(figures);
  const showBar = figures.planned > 0 || figures.done > 0;
  return (
    <span className="flex min-w-32 flex-col items-start gap-1">
      <span className="text-note text-foreground">{progressText(figures, status)}</span>
      {showBar ? (
        <span className="block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={figures.failed ? "block h-full rounded-full bg-warning" : "block h-full rounded-full bg-success"} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </span>
  );
}
