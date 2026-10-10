"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/components/ui/cn";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "./empty-state";
import { Term } from "./help-tip";
import { SidePanel } from "./side-panel";
import {
  ariaSort,
  cellSortValue,
  columnCountWarning,
  firstDirection,
  nextSort,
  numericColumnWarning,
  sortRows,
  type SortDirection,
  type SortState,
  type SortValue,
} from "./data-table-logic";

export type { SortDirection, SortState, SortValue } from "./data-table-logic";

export type DataTableColumn = {
  key: string;
  /** Mot du client (« Premiers dépôts »). */
  header: string;
  /** Terme technique au survol de l'en-tête (« FTD »). */
  term?: string;
  /** `right` pour les chiffres (tri du plus grand au plus petit au premier clic). */
  align?: "left" | "right";
  /** Tri par cette colonne (par défaut : oui). */
  sortable?: boolean;
  sortFirst?: SortDirection;
  /** Colonne masquée sur téléphone (la moins utile). */
  hideOnMobile?: boolean;
  className?: string;
};

export type DataTableRow<T = unknown> = {
  id: string;
  /** Contenu de chaque cellule, par clé de colonne (texte, nombre ou nœud déjà rendu côté serveur). */
  cells: Record<string, React.ReactNode>;
  /**
   * Valeur de tri par colonne quand la cellule est un nœud React ou un texte qui n'est pas un nombre français
   * (« 1 234 € », « 15,3 % » et « 09/10/2026 14:05 » sont relus tout seuls ; « — » est trié avec les vides).
   */
  sortValues?: Record<string, SortValue>;
  /** Lien de la ligne : la première cellule devient un lien, la ligne entière est cliquable. */
  href?: string;
  /** Détail affiché dans le volet latéral (rendu côté serveur). */
  detail?: React.ReactNode;
  /** Titre du volet (par défaut : texte de la première cellule). */
  detailTitle?: string;
  detailDescription?: React.ReactNode;
  /** Données brutes pour `renderDetail` / `rowHref` (usage dans un composant client). */
  data?: T;
};

const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[data-row-ignore]";

/**
 * Tableau de liste (5 colonnes au plus, avertissement en développement au-delà) : tri par colonne,
 * état vide, et ligne cliquable qui ouvre un volet latéral de détail (`detail` / `renderDetail`)
 * ou une page (`href` / `rowHref`). Au clavier : la première cellule est un bouton ou un lien.
 * Les lignes sont des données sérialisables : un composant serveur peut tout passer (cellules déjà rendues).
 * Le tri porte sur les lignes reçues (la page affichée).
 */
export function DataTable<T = unknown>({
  columns,
  rows,
  label,
  empty,
  defaultSort = null,
  renderDetail,
  rowHref,
  panelSize = "md",
  className,
}: {
  columns: DataTableColumn[];
  rows: DataTableRow<T>[];
  /** Nom du tableau pour les lecteurs d'écran (légende masquée). */
  label?: string;
  empty?: {
    title: string;
    description?: React.ReactNode;
    action?: { href: string; label: string; variant?: "default" | "outline" | "secondary" };
    icon?: React.ReactNode;
  };
  defaultSort?: SortState;
  renderDetail?: (row: DataTableRow<T>) => React.ReactNode;
  rowHref?: (row: DataTableRow<T>) => string | undefined;
  panelSize?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>(defaultSort);
  // On garde l'identifiant de la ligne ouverte, pas la ligne : après une action (rafraîchissement de la page), le volet
  // montre la version à jour de cette ligne, ou se ferme si elle a disparu.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => (selectedId === null ? null : (rows.find((r) => r.id === selectedId) ?? null)),
    [rows, selectedId],
  );
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const warning = columnCountWarning(columns.length);
    if (warning) console.warn(warning);
  }, [columns.length]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const col of columns) {
      if (col.align !== "right" || col.sortable === false) continue;
      const cells = rows
        .filter((r) => !(r.sortValues && col.key in r.sortValues))
        .map((r) => r.cells[col.key]);
      const warning = numericColumnWarning(col.header, cells);
      if (warning) console.warn(warning);
    }
  }, [columns, rows]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return sortRows(
      rows,
      (r) =>
        r.sortValues && sort.key in r.sortValues
          ? r.sortValues[sort.key]
          : cellSortValue(r.cells[sort.key]),
      sort.direction,
    );
  }, [rows, sort]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? "Rien à afficher pour l'instant"}
        description={empty?.description}
        action={empty?.action}
        icon={empty?.icon}
        className={className}
      />
    );
  }

  const hasDetail = (r: DataTableRow<T>) => Boolean(renderDetail || r.detail !== undefined);
  const hrefOf = (r: DataTableRow<T>) => r.href ?? rowHref?.(r);
  const open = (r: DataTableRow<T>) => {
    setSelectedId(r.id);
    setPanelOpen(true);
  };
  const firstKey = columns[0]?.key;
  const titleOf = (r: DataTableRow<T>) => {
    if (r.detailTitle) return r.detailTitle;
    const c = firstKey ? r.cells[firstKey] : null;
    return typeof c === "string" || typeof c === "number" ? String(c) : "Détail";
  };

  return (
    <div className={className}>
      <Table label={label}>
        {label ? <TableCaption className="sr-only">{label}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const sortable = col.sortable !== false;
              const state = ariaSort(sort, col.key);
              const Icon =
                state === "ascending"
                  ? ArrowUp
                  : state === "descending"
                    ? ArrowDown
                    : ChevronsUpDown;
              return (
                <TableHead
                  key={col.key}
                  scope="col"
                  aria-sort={sortable ? state : undefined}
                  className={cn(
                    col.align === "right" && "text-right",
                    col.hideOnMobile && "max-md:hidden",
                    col.className,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => setSort((s) => nextSort(s, col.key, firstDirection(col)))}
                      className={cn(
                        "-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 hover:text-foreground max-md:min-h-10",
                        col.align === "right" && "flex-row-reverse",
                        state !== "none" && "text-foreground",
                      )}
                    >
                      <Term term={col.term}>{col.header}</Term>
                      <Icon
                        aria-hidden
                        className={cn("size-3.5", state === "none" && "opacity-50")}
                      />
                    </button>
                  ) : (
                    <Term term={col.term}>{col.header}</Term>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const href = hrefOf(r);
            const detail = !href && hasDetail(r);
            const clickable = Boolean(href) || detail;
            return (
              <TableRow
                key={r.id}
                data-state={panelOpen && selected?.id === r.id ? "selected" : undefined}
                className={cn(clickable && "cursor-pointer")}
                onClick={
                  clickable
                    ? (e) => {
                        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
                        if (href) router.push(href);
                        else open(r);
                      }
                    : undefined
                }
              >
                {columns.map((col, i) => {
                  const content = r.cells[col.key] ?? null;
                  let cell: React.ReactNode = content;
                  if (i === 0 && href) {
                    cell = (
                      <Link
                        href={href}
                        className="inline-flex min-h-8 items-center font-medium text-foreground underline-offset-4 hover:underline max-md:min-h-10"
                      >
                        {content}
                      </Link>
                    );
                  } else if (i === 0 && detail) {
                    cell = (
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => open(r)}
                        className="-mx-1 inline-flex min-h-8 items-center rounded-md px-1 text-left font-medium text-foreground underline-offset-4 hover:underline max-md:min-h-10"
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <TableCell
                      key={col.key}
                      className={cn(
                        col.align === "right" && "text-right tabular-nums",
                        col.hideOnMobile && "max-md:hidden",
                        col.className,
                      )}
                    >
                      {cell}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sorted.some((r) => !hrefOf(r) && hasDetail(r)) ? (
        <SidePanel
          open={panelOpen && selected !== null}
          onOpenChange={setPanelOpen}
          title={selected ? titleOf(selected) : "Détail"}
          description={selected?.detailDescription}
          size={panelSize}
        >
          {selected ? (renderDetail ? renderDetail(selected) : selected.detail) : null}
        </SidePanel>
      ) : null}
    </div>
  );
}
