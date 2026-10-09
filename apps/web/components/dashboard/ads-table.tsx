import Link from "next/link";
import { VERTICAL_LABELS } from "@linkaffipro/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import type { AdsRow } from "@/lib/dashboard/daily";
import type { Derived, StatTotals } from "@/lib/dashboard/metrics";
import { Delta } from "./delta";

export type AdsSortKey = keyof StatTotals | keyof Derived | "name";

export const ADS_COLUMNS: Array<{ key: AdsSortKey; label: string; money?: boolean; invert?: boolean; derived?: boolean }> = [
  { key: "spend", label: "Dépense", money: true, invert: true },
  { key: "entryClicks", label: "Clics pub" },
  { key: "requests", label: "Demandes" },
  { key: "approved", label: "Acceptés" },
  { key: "joined", label: "Entrés" },
  { key: "offerClicks", label: "Clics offres" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "FTD" },
  { key: "deposits", label: "Dépôts" },
  { key: "depositAmount", label: "Dépôts €", money: true },
  { key: "ngr", label: "NGR €", money: true },
  { key: "cpl", label: "CPL", money: true, invert: true, derived: true },
  { key: "cpa", label: "CPA", money: true, invert: true, derived: true },
  { key: "costPerFtd", label: "Coût/FTD", money: true, invert: true, derived: true },
  { key: "roas", label: "ROAS", derived: true },
  { key: "profit", label: "Bénéfice €", money: true, derived: true },
];

function cell(row: { totals: StatTotals; derived: Derived }, key: AdsSortKey): number | null {
  if (key === "name") return null;
  return key in row.totals ? row.totals[key as keyof StatTotals] : row.derived[key as keyof Derived];
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
  return money ? `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : fmtNum(v);
}

export function AdsTable({ rows, total, totalDerived, sort, dir, hrefFor }: { rows: AdsRow[]; total: StatTotals; totalDerived: Derived; sort: AdsSortKey; dir: "asc" | "desc"; hrefFor: (sort: AdsSortKey) => string }) {
  const sorted = sortAdsRows(rows, sort, dir);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead><Link href={hrefFor("name")} className="hover:underline">Pub{sort === "name" ? (dir === "asc" ? " ▲" : " ▼") : ""}</Link></TableHead>
          {ADS_COLUMNS.map((c) => (
            <TableHead key={c.key} className="whitespace-nowrap text-right">
              <Link href={hrefFor(c.key)} className="hover:underline">{c.label}{sort === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}</Link>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.campaignId}>
            <TableCell>
              <Link href={`/campaigns/${r.campaignId}`} className="font-medium hover:underline">{r.name}</Link>
              <div className="text-xs text-muted-foreground">{[r.platform, r.vertical ? VERTICAL_LABELS[r.vertical] : null, r.status].filter(Boolean).join(" · ")}</div>
            </TableCell>
            {ADS_COLUMNS.map((c) => (
              <TableCell key={c.key} className="text-right tabular-nums">
                <div>{fmtCell(cell(r, c.key), c.money, c.key)}</div>
                {!c.derived ? <Delta value={r.deltas[c.key as keyof StatTotals]} invert={c.invert} /> : null}
              </TableCell>
            ))}
          </TableRow>
        ))}
        <TableRow className="font-semibold">
          <TableCell>Total</TableCell>
          {ADS_COLUMNS.map((c) => (
            <TableCell key={c.key} className="text-right tabular-nums">{fmtCell(cell({ totals: total, derived: totalDerived }, c.key), c.money, c.key)}</TableCell>
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
