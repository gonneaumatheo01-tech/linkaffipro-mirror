import { isVertical } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/members/csv";
import { parseRange } from "@/lib/dashboard/aggregate";
import { loadAdsTable } from "@/lib/dashboard/daily";

export const dynamic = "force-dynamic";

/** Export CSV (compatible Excel) du tableau par pub. */
export async function GET(req: Request) {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const range = parseRange(sp.get("range"));
  const v = sp.get("vertical") ?? "";
  const { rows, total, totalDerived } = await loadAdsTable(range, { vertical: isVertical(v) ? v : "" });
  const line = (name: string, t: typeof total, d: typeof totalDerived) => [name, t.spend.toFixed(2), t.entryClicks, t.requests, t.approved, t.joined, t.offerClicks, t.registrations, t.ftds, t.deposits, t.depositAmount.toFixed(2), t.ngr.toFixed(2), d.cpl ?? "", d.cpa ?? "", d.costPerFtd ?? "", d.roas ?? "", d.profit.toFixed(2)];
  const csv = toCsv(
    ["Pub", "Dépense (EUR)", "Clics pub", "Demandes", "Acceptés", "Entrés", "Clics offres", "Inscriptions", "FTD", "Dépôts (nb)", "Dépôts (EUR)", "NGR (EUR)", "CPL", "CPA", "Coût par FTD", "ROAS", "Bénéfice (EUR)"],
    [...rows.map((r) => line(r.name, r.totals, r.derived)), line("TOTAL", total, totalDerived)],
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pubs-${range}-${date}.csv"`, "Cache-Control": "no-store" } });
}
