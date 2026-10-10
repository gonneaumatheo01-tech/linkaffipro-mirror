import Link from "next/link";
import { VERTICAL_LABELS } from "@linkaffipro/core";
import { HelpTip } from "@/components/admin/help-tip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney, fmtNum } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";
import type { AdsRow } from "@/lib/dashboard/daily";
import type { Derived, StatTotals } from "@/lib/dashboard/metrics";
import { Delta } from "./delta";
import { METRIC_HELP } from "./metric-help";

export type AdsSortKey = keyof StatTotals | keyof Derived | "name";

/** Colonnes du tableau par campagne. `secondary` : masquée sur téléphone (visible dès `md`). */
export const ADS_COLUMNS: Array<{
  key: AdsSortKey;
  label: string;
  money?: boolean;
  invert?: boolean;
  derived?: boolean;
  secondary?: boolean;
}> = [
  { key: "spend", label: "Dépense", money: true, invert: true },
  { key: "entryClicks", label: "Clics pub", secondary: true },
  { key: "requests", label: "Demandes", secondary: true },
  { key: "approved", label: "Acceptés", secondary: true },
  { key: "joined", label: "Entrés" },
  { key: "offerClicks", label: "Clics offres", secondary: true },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "FTD" },
  { key: "deposits", label: "Dépôts", secondary: true },
  { key: "depositAmount", label: "Dépôts €", money: true, secondary: true },
  { key: "ngr", label: "NGR €", money: true },
  { key: "cpl", label: "CPL", money: true, invert: true, derived: true, secondary: true },
  { key: "cpa", label: "CPA", money: true, invert: true, derived: true, secondary: true },
  {
    key: "costPerFtd",
    label: "Coût/FTD",
    money: true,
    invert: true,
    derived: true,
    secondary: true,
  },
  { key: "roas", label: "ROAS", derived: true },
  { key: "profit", label: "Bénéfice €", money: true, derived: true },
];

function cell(row: { totals: StatTotals; derived: Derived }, key: AdsSortKey): number | null {
  if (key === "name") return null;
  return key in row.totals
    ? row.totals[key as keyof StatTotals]
    : row.derived[key as keyof Derived];
}

export function sortAdsRows(rows: AdsRow[], sort: AdsSortKey, dir: "asc" | "desc"): AdsRow[] {
  const s = [...rows];
  s.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    const va = cell(a, sort) ?? -Infinity;
    const vb = cell(b, sort) ?? -Infinity;
    return va - vb;
  });
  return dir === "desc" ? s.reverse() : s;
}

function fmtCell(v: number | null, money?: boolean, key?: AdsSortKey): string {
  if (v === null) return "—";
  if (key === "roas") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}×`;
  return money ? fmtMoney(v) : fmtNum(v);
}

export function AdsTable({
  rows,
  total,
  totalDerived,
  totalDeltas,
  sort,
  dir,
  hrefFor,
  showDeltas = false,
}: {
  rows: AdsRow[];
  total: StatTotals;
  totalDerived: Derived;
  /** Variations du total (affichées avec `showDeltas`). */
  totalDeltas?: AdsRow["deltas"];
  sort: AdsSortKey;
  dir: "asc" | "desc";
  hrefFor: (sort: AdsSortKey) => string;
  /** Affiche sous chaque valeur la variation par rapport à la période précédente. */
  showDeltas?: boolean;
}) {
  const sorted = sortAdsRows(rows, sort, dir);
  const arrow = (k: AdsSortKey) => (sort === k ? (dir === "asc" ? " ▲" : " ▼") : "");
  const sortLabel = (k: AdsSortKey, label: string) =>
    `Trier par ${label.toLowerCase()}${sort === k ? (dir === "asc" ? " (croissant)" : " (décroissant)") : ""}`;
  const colCls = (c: (typeof ADS_COLUMNS)[number]) =>
    `${c.secondary ? "hidden md:table-cell " : ""}whitespace-nowrap text-right`;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Link
              href={hrefFor("name")}
              aria-label={sortLabel("name", "nom")}
              className="hover:underline"
            >
              Campagne{arrow("name")}
            </Link>
          </TableHead>
          {ADS_COLUMNS.map((c) => (
            <TableHead key={c.key} className={colCls(c)}>
              <span className="inline-flex items-center gap-1">
                <Link
                  href={hrefFor(c.key)}
                  aria-label={sortLabel(c.key, c.label)}
                  className="hover:underline"
                >
                  {c.label}
                  {arrow(c.key)}
                </Link>
                {METRIC_HELP[c.key] ? (
                  <HelpTip label={`Définition : ${c.label}`}>{METRIC_HELP[c.key]}</HelpTip>
                ) : null}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.campaignId}>
            <TableCell>
              <Link href={`/campaigns/${r.campaignId}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {[
                  r.platform ? statusLabel("adPlatform", r.platform) : null,
                  r.vertical ? VERTICAL_LABELS[r.vertical] : null,
                  r.status ? statusLabel("campaign", r.status) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </TableCell>
            {ADS_COLUMNS.map((c) => (
              <TableCell
                key={c.key}
                className={`${c.secondary ? "hidden md:table-cell " : ""}text-right tabular-nums`}
              >
                <div>{fmtCell(cell(r, c.key), c.money, c.key)}</div>
                {showDeltas ? (
                  <Delta value={r.deltas[c.key as keyof AdsRow["deltas"]]} invert={c.invert} />
                ) : null}
              </TableCell>
            ))}
          </TableRow>
        ))}
        <TableRow className="font-semibold">
          <TableCell>Total</TableCell>
          {ADS_COLUMNS.map((c) => (
            <TableCell
              key={c.key}
              className={`${c.secondary ? "hidden md:table-cell " : ""}text-right tabular-nums`}
            >
              <div>
                {fmtCell(cell({ totals: total, derived: totalDerived }, c.key), c.money, c.key)}
              </div>
              {showDeltas && totalDeltas ? (
                <Delta value={totalDeltas[c.key as keyof AdsRow["deltas"]]} invert={c.invert} />
              ) : null}
            </TableCell>
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
