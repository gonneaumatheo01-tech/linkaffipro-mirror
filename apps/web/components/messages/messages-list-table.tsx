"use client";

import { useState } from "react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/admin/data-table";
import { PostPanel } from "./calendar/post-panel";
import type { CalendarItem } from "./calendar/types";

/** Éléments qui gardent leur propre clic dans une ligne (lien, bouton, champ…). */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[data-row-ignore]";

type EmptyProps = React.ComponentProps<typeof DataTable>["empty"];

/**
 * Liste des messages : `DataTable` (5 colonnes, tri) dont chaque ligne ouvre le même volet que le calendrier
 * (`PostPanel` : aperçu, « Déplacer », puis Fermer, Dupliquer, Modifier, Ouvrir). La première cellule est un bouton
 * (clavier) ; un clic ailleurs sur la ligne l'actionne.
 */
export function MessagesListTable({
  columns,
  rows,
  items,
  empty,
}: {
  columns: DataTableColumn[];
  /** Cellules rendues par la page serveur ; `id` = identifiant du message. */
  rows: DataTableRow[];
  /** Messages de la page, pour le volet. */
  items: CalendarItem[];
  empty?: EmptyProps;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const firstKey = columns[0]?.key ?? "";

  const show = (id: string) => {
    setSelectedId(id);
    setOpen(true);
  };

  const withOpeners: DataTableRow[] = rows.map((r) => ({
    ...r,
    detail: undefined,
    cells: {
      ...r.cells,
      [firstKey]: (
        <button
          type="button"
          aria-haspopup="dialog"
          data-open-post={r.id}
          onClick={() => show(r.id)}
          className="-mx-1 inline-flex min-h-8 max-w-full items-center rounded-md px-1 text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-10"
        >
          {r.cells[firstKey]}
        </button>
      ),
    },
  }));

  return (
    <div
      className="[&_tbody_tr]:cursor-pointer"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE)) return;
        const row = target.closest("tbody tr");
        row?.querySelector<HTMLButtonElement>("button[data-open-post]")?.click();
      }}
    >
      <DataTable label="Messages" columns={columns} rows={withOpeners} empty={empty} />
      <PostPanel item={selected} open={open && selected !== null} onOpenChange={setOpen} />
    </div>
  );
}
