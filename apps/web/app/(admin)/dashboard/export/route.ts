import { isVertical } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/members/csv";
import { loadAdsTable, type AdsRow } from "@/lib/dashboard/daily";
import type { Derived, StatTotals } from "@/lib/dashboard/metrics";
import { parseCompare, periodLabel, previousPeriod, resolvePeriod } from "@/lib/periods";

export const dynamic = "force-dynamic";

/**
 * Colonnes du fichier, dans le vocabulaire de l'interface (docs/REFONTE-UX.md) ; le terme technique reste entre
 * parenthèses pour qui le cherche dans Excel. Mêmes chiffres et même ordre qu'avant.
 */
const COLUMNS: Array<{ key: keyof StatTotals | keyof Derived; label: string; money?: boolean }> = [
  { key: "spend", label: "Dépense pub (EUR)", money: true },
  { key: "entryClicks", label: "Clics sur les pubs" },
  { key: "requests", label: "Demandes d'adhésion" },
  { key: "approved", label: "Acceptés" },
  { key: "joined", label: "Membres entrés" },
  { key: "offerClicks", label: "Clics sur les offres" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "Premiers dépôts (FTD)" },
  { key: "deposits", label: "Dépôts (nombre)" },
  { key: "depositAmount", label: "Montant déposé (EUR)", money: true },
  { key: "ngr", label: "Revenu net (NGR, EUR)", money: true },
  { key: "cpl", label: "Coût par membre (CPL, EUR)" },
  { key: "cpa", label: "Coût par inscription (CPA, EUR)" },
  { key: "costPerFtd", label: "Coût par premier dépôt (EUR)" },
  { key: "roas", label: "Retour sur dépense pub (ROAS)" },
  { key: "profit", label: "Bénéfice (EUR)", money: true },
];

function value(t: StatTotals, d: Derived, key: keyof StatTotals | keyof Derived): number | null {
  return key in t ? t[key as keyof StatTotals] : d[key as keyof Derived];
}

function cell(v: number | null, money?: boolean): string | number {
  if (v === null) return "";
  return money ? v.toFixed(2) : v;
}

/**
 * Export CSV (compatible Excel) du tableau par campagne sur la période (`range`, `from`, `to`), filtrable par univers
 * (`vertical`) et par campagne (`campaignId`). La ligne TOTAL compte chaque joueur une seule fois.
 * Avec `compare=1`, chaque colonne est suivie de sa valeur sur la période précédente et de la variation en %.
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const params = Object.fromEntries(sp.entries());
  const period = resolvePeriod(params);
  const compare = parseCompare(sp.get("compare"));
  const v = sp.get("vertical") ?? "";
  const campaignId = sp.get("campaignId") ?? "";
  const { rows, total, totalDerived, previousTotal, previousTotalDerived, totalDeltas } =
    await loadAdsTable(period, {
      vertical: isVertical(v) ? v : "",
      ...(campaignId ? { campaignId } : {}),
    });

  const headers = ["Campagne", "Période"];
  for (const c of COLUMNS) {
    headers.push(c.label);
    if (compare) headers.push(`${c.label} – période précédente`, `${c.label} – variation (%)`);
  }
  const line = (
    name: string,
    t: StatTotals,
    d: Derived,
    pt: StatTotals,
    pd: Derived,
    deltas: AdsRow["deltas"],
  ) => {
    const out: Array<string | number> = [name, periodLabel(period)];
    for (const c of COLUMNS) {
      out.push(cell(value(t, d, c.key), c.money));
      if (compare) {
        out.push(cell(value(pt, pd, c.key), c.money));
        const delta = deltas[c.key];
        out.push(delta === null || delta === undefined ? "" : delta);
      }
    }
    return out;
  };
  const csv = toCsv(headers, [
    ...rows.map((r) => line(r.name, r.totals, r.derived, r.previous, r.previousDerived, r.deltas)),
    line("TOTAL", total, totalDerived, previousTotal, previousTotalDerived, totalDeltas),
  ]);
  const suffix = compare ? `-vs-${previousPeriod(period).from}` : "";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campagnes-${period.from}-${period.to}${suffix}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
