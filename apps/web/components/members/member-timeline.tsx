import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { fmtDate } from "@/lib/format";
import type { TimelineEntry, TimelineKind } from "@/lib/members/timeline";

/** Sortes d'éléments de la chronologie : pastille (jetons du thème) et libellé de la légende. */
export const TIMELINE_KINDS: Record<TimelineKind, { label: string; dot: string }> = {
  membership: { label: "Canaux", dot: "bg-info" },
  message: { label: "Messages reçus", dot: "bg-muted-foreground" },
  click: { label: "Clics", dot: "bg-brand" },
  player: { label: "Inscriptions et dépôts", dot: "bg-success" },
  event: { label: "Autres", dot: "bg-night" },
};

/**
 * Chronologie d'un membre (page déjà découpée) : légende, puis une ligne par élément. Ordinateur : date à gauche ;
 * téléphone : date au-dessus du titre (rien ne déborde).
 */
export function MemberTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground">Rien pour l&apos;instant.</p>;
  }
  return (
    <div className="space-y-3">
      <ul aria-label="Légende" className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(TIMELINE_KINDS).map(([k, v]) => (
          <li key={k} className="inline-flex items-center gap-1.5 text-note text-muted-foreground">
            <span aria-hidden className={cn("size-2 rounded-full", v.dot)} />
            {v.label}
          </li>
        ))}
      </ul>
      <ol className="divide-y divide-border">
        {entries.map((e, i) => {
          const kind = TIMELINE_KINDS[e.kind];
          return (
            <li key={i} className="flex gap-3 py-2.5">
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-full sm:mt-2", kind?.dot)}
                role="img"
                aria-label={kind?.label ?? e.kind}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                <time
                  dateTime={e.at.toISOString()}
                  className="shrink-0 text-note text-muted-foreground tabular-nums sm:w-32"
                >
                  {fmtDate(e.at)}
                </time>
                <p className="min-w-0 break-words">
                  {e.href ? (
                    <Link href={e.href} className="underline-offset-4 hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}
                  {e.detail ? (
                    <span className="block text-note break-words text-muted-foreground sm:inline sm:pl-2">
                      {e.detail}
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
