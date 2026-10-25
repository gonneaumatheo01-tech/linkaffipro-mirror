import { fmtClock, timelineItems, timelineTicks } from "@/lib/agents/montage";

/**
 * Plan de coupe en frise (phase 28) : chaque moment retenu est placé sur la durée de la vidéo source, avec son numéro ;
 * la liste en dessous donne les temps, le score et la description (lisible au clavier et par un lecteur d'écran : la
 * frise est décorative, la liste porte l'information).
 */
export function MontageTimeline({
  clips,
  durationMs,
}: {
  clips: ReadonlyArray<{ id: string; index: number; startMs: number; endMs: number; score: number | null; description: string | null; status: string }>;
  durationMs: number | null;
}) {
  const { totalMs, items } = timelineItems(clips, durationMs);
  const ticks = timelineTicks(totalMs);
  const byId = new Map(clips.map((c) => [c.id, c]));
  return (
    <div className="space-y-4">
      <div aria-hidden="true" className="space-y-1">
        <div className="relative h-10 rounded-lg border border-border bg-muted">
          {items.map((it) => {
            const off = byId.get(it.id)?.status === "REJECTED" || byId.get(it.id)?.status === "CANCELLED";
            return (
              <span
                key={it.id}
                className={`absolute top-1 bottom-1 flex items-center justify-center overflow-hidden rounded-md text-note font-medium ${off ? "bg-muted-foreground/30 text-foreground" : "bg-brand text-foreground"}`}
                style={{ left: `${it.leftPct}%`, width: `${it.widthPct}%`, minWidth: "1.25rem" }}
              >
                {it.index}
              </span>
            );
          })}
        </div>
        <div className="relative h-4 text-note text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t.pct}
              className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
      <ol className="space-y-2" aria-label="Moments retenus">
        {[...clips]
          .sort((a, b) => a.index - b.index)
          .map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-body text-foreground">
              <a href={`#short-${c.id}`} className="font-medium text-info underline">
                {c.index}.
              </a>
              <span className="tabular-nums">
                {fmtClock(c.startMs)} à {fmtClock(c.endMs)}
              </span>
              {c.score != null ? <span className="text-note text-muted-foreground">intérêt {c.score}/10</span> : null}
              {c.description ? <span className="text-muted-foreground">· {c.description}</span> : null}
            </li>
          ))}
      </ol>
    </div>
  );
}
