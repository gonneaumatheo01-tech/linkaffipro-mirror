import { isVertical } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/members/csv";
import { loadAdsTable, type AdsRow } from "@/lib/dashboard/daily";
import { adsExportCell, exportDelta, type ExportFormat } from "@/lib/dashboard/export-cells";
import type { Derived, StatTotals } from "@/lib/dashboard/metrics";
import { parseCompare, periodLabel, previousPeriod, resolvePeriod } from "@/lib/periods";

export const dynamic = "force-dynamic";

/**
 * Colonnes du fichier, dans le vocabulaire de l'interface (docs/REFONTE-UX.md) ; le terme technique reste entre
 * parenthèses pour qui le cherche dans Excel. Phase 10 : commissions (primes des joueurs + part du revenu), retour sur
 * dépense pub = commissions ÷ dépense, gains = commissions − dépense pub. « (CPA, … ) » ne désigne que le coût par
 * inscription : les primes des joueurs sont la « commission CPA » (`ambiguousCpaHeaders`, testé).
 */
const COLUMNS: Array<{
  key: keyof StatTotals | keyof Derived;
  label: string;
  format: ExportFormat;
}> = [
  { key: "spend", label: "Dépense pub (EUR)", format: "money" },
  { key: "entryClicks", label: "Clics sur les pubs", format: "number" },
  { key: "requests", label: "Demandes d'adhésion", format: "number" },
  { key: "approved", label: "Acceptés", format: "number" },
  { key: "joined", label: "Membres entrés", format: "number" },
  { key: "offerClicks", label: "Clics sur les offres", format: "number" },
  { key: "registrations", label: "Inscriptions", format: "number" },
  { key: "ftds", label: "Premiers dépôts (FTD)", format: "number" },
  { key: "deposits", label: "Dépôts (nombre)", format: "number" },
  { key: "depositAmount", label: "Montant déposé (EUR)", format: "money" },
  { key: "ngr", label: "Revenu net (NGR, EUR)", format: "money" },
  { key: "cpaCommissions", label: "Primes des joueurs (commission CPA, EUR)", format: "money" },
  { key: "revshareCommissions", label: "Part du revenu (revshare, EUR)", format: "money" },
  { key: "commissions", label: "Commissions (EUR)", format: "money" },
  { key: "cpl", label: "Coût par membre (CPL, EUR)", format: "money" },
  { key: "cpa", label: "Coût par inscription (CPA, EUR)", format: "money" },
  { key: "costPerFtd", label: "Coût par premier dépôt (EUR)", format: "money" },
  { key: "roas", label: "Retour sur dépense pub (ROAS)", format: "ratio" },
  { key: "gains", label: "Gains (EUR)", format: "money" },
];

function value(t: StatTotals, d: Derived, key: keyof StatTotals | keyof Derived): number | null {
  return key in t ? t[key as keyof StatTotals] : d[key as keyof Derived];
}

/**
 * Export CSV (compatible Excel) du tableau par campagne sur la période (`range`, `from`, `to`), filtrable par univers
 * (`vertical`) et par campagne (`campaignId`). La ligne TOTAL compte chaque joueur une seule fois.
 * Avec `compare=1`, chaque colonne est suivie de sa valeur sur la période précédente et de la variation en % (vide
 * sur une base négative, règle du site).
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
      out.push(adsExportCell(value(t, d, c.key), c.format));
      if (compare) {
        const before = value(pt, pd, c.key);
        out.push(adsExportCell(before, c.format));
        const delta = exportDelta(deltas[c.key], before);
        out.push(delta === null ? "" : delta);
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
