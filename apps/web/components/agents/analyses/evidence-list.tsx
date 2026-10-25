import { evidenceDate, hostOf, type Evidence } from "@/lib/agents/analyses";

/** Preuves d'une règle ou d'une recommandation : lien vers la source, date et ce qu'elle dit. */
export function EvidenceList({ items, label = "Preuves" }: { items: Evidence[]; label?: string }) {
  if (items.length === 0) return <p className="text-note text-muted-foreground">Aucune source jointe : à ne pas prendre pour acquis.</p>;
  return (
    <ul aria-label={label} className="list-disc space-y-0.5 pl-5 text-note text-foreground">
      {items.map((e, i) => {
        const date = evidenceDate(e.date);
        return (
          <li key={`${e.url}-${i}`}>
            <a href={e.url} target="_blank" rel="noreferrer noopener" className="text-info underline underline-offset-4">
              {hostOf(e.url)}
            </a>
            {date ? ` · ${date}` : ""}
            {e.description ? ` · ${e.description}` : ""}
          </li>
        );
      })}
    </ul>
  );
}
