import { prisma } from "@linkaffipro/db";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { statusLabels } from "@/lib/status-badges";
import { csvDay, csvNumber, toCsv } from "@/lib/members/csv";
import { listCampaignsUncached, type MetricKey } from "@/lib/campaigns/queries";
import { parseCompare, periodDates, periodLabel, previousPeriod, resolvePeriod } from "@/lib/periods";

export const dynamic = "force-dynamic";

const PLATFORM = statusLabels("adPlatform") as Record<string, string>;
const STATUS = statusLabels("campaign") as Record<string, string>;
const SOURCE: Record<string, string> = { CSV: "CSV", API: "API", MANUAL: "manuel" };

const METRICS: Array<{ key: MetricKey; label: string; money?: boolean }> = [
  { key: "spend", label: "Dépense (€)", money: true },
  { key: "entryClicks", label: "Clics pub" },
  { key: "members", label: "Membres" },
  { key: "offerClicks", label: "Clics offre" },
  { key: "registrations", label: "Inscrits" },
  { key: "ftds", label: "FTD" },
  { key: "deposits", label: "Dépôts (nombre)" },
  { key: "depositAmount", label: "Dépôts (€)", money: true },
  { key: "cpl", label: "CPL (€)", money: true },
  { key: "cpa", label: "CPA (€)", money: true },
  { key: "costPerFtd", label: "Coût par FTD (€)", money: true },
  { key: "revenue", label: "Revenu (€)", money: true },
  { key: "roas", label: "ROAS", money: true },
  { key: "profit", label: "Résultat (€)", money: true },
];

/**
 * Export CSV des campagnes sur la période (`range`, `from`, `to`).
 * - par défaut : une ligne par campagne avec dépense, clics, membres, clics offre, inscrits, FTD, dépôts, CPL, CPA, coût par FTD, NGR, ROAS, bénéfice ;
 *   avec `compare=1`, chaque indicateur est suivi de la période précédente et de la variation en % ;
 * - `kind=costs` : coûts par jour (toutes les campagnes, ou `campaignId=…`).
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const period = resolvePeriod(Object.fromEntries(url.searchParams.entries()));
  const compare = parseCompare(url.searchParams.get("compare"));
  const { dateFrom, dateTo } = periodDates(period);
  const headers = (name: string) => ({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${period.from}-${period.to}.csv"`, "Cache-Control": "no-store" });

  if (url.searchParams.get("kind") === "costs") {
    const campaignId = url.searchParams.get("campaignId") || null;
    const scope = campaignId ? { OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] } : {};
    const costs = await prisma.adCost.findMany({
      where: { date: { gte: dateFrom, lte: dateTo }, ...scope },
      orderBy: [{ date: "desc" }],
      take: 20_000,
      include: { campaign: { select: { name: true } }, adSet: { select: { name: true, campaign: { select: { name: true } } } }, ad: { select: { name: true, adSet: { select: { name: true, campaign: { select: { name: true } } } } } } },
    });
    const csv = toCsv(
      ["Jour", "Campagne", "Groupe", "Pub précise", "Dépense", "Devise", "Impressions", "Clics (plateforme)", "Source"],
      costs.map((c) => [
        csvDay(c.date),
        c.ad?.adSet.campaign.name ?? c.adSet?.campaign.name ?? c.campaign?.name ?? "",
        c.ad?.adSet.name ?? c.adSet?.name ?? "",
        c.ad?.name ?? "",
        csvNumber(Number(c.spend)),
        c.currency,
        c.impressions,
        c.clicks,
        SOURCE[c.source] ?? c.source,
      ]),
    );
    return new Response(csv, { headers: headers("couts-par-jour") });
  }

  const rows = await listCampaignsUncached(period, compare);
  const head = ["Campagne", "Plateforme", "Statut", "Univers", "Canaux", "Liens d'entrée", "Offres", "Importée", "Période"];
  for (const m of METRICS) {
    head.push(m.label);
    if (compare) head.push(`${m.label} – période précédente`, `${m.label} – variation (%)`);
  }
  const prevLabel = periodLabel(previousPeriod(period));
  const csv = toCsv(
    head,
    rows.map((r) => {
      const out: Array<string | number> = [
        r.name,
        r.adPlatform ? (PLATFORM[r.adPlatform] ?? r.adPlatform) : "",
        STATUS[r.status] ?? r.status,
        r.vertical ? VERTICAL_LABELS[r.vertical as Vertical] : "",
        r.channels.join(", "),
        r.links,
        r.offers,
        r.importedFrom ? (PLATFORM[r.importedFrom] ?? r.importedFrom) : "",
        compare ? `${periodLabel(period)} vs ${prevLabel}` : periodLabel(period),
      ];
      for (const m of METRICS) {
        const v = r.metrics[m.key];
        out.push(m.money ? csvNumber(v) : (v ?? 0));
        if (compare) {
          const pv = r.previous?.[m.key] ?? null;
          out.push(m.money ? csvNumber(pv) : (pv ?? 0));
          const d = r.deltas?.[m.key];
          out.push(d === null || d === undefined ? "" : csvNumber(d, 1));
        }
      }
      return out;
    }),
  );
  return new Response(csv, { headers: headers(compare ? "campagnes-comparaison" : "campagnes") });
}
