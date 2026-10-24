import { EmptyState } from "@/components/admin/empty-state";
import type { HistoryEntry } from "@/lib/agents/inspiration";
import { fmtDate } from "@/lib/format";

const KIND_CLASS: Record<HistoryEntry["kind"], string> = {
  added: "text-foreground",
  read: "text-foreground",
  applied: "text-success",
  undone: "text-muted-foreground",
  rejected: "text-muted-foreground",
  test: "text-foreground",
  verdict: "font-medium text-foreground",
};

/** Historique d'une référence : ajout, lectures, applications, annulations, tests A/B et leurs bilans. */
export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <EmptyState title="Rien pour l'instant" />;
  return (
    <ol className="space-y-2">
      {entries.slice(0, 50).map((e, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-body">
          <span className="text-note text-muted-foreground tabular-nums">{fmtDate(e.at)}</span>
          <span className={KIND_CLASS[e.kind]}>{e.text}</span>
        </li>
      ))}
    </ol>
  );
}
