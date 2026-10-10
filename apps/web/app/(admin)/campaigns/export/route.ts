import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { statusLabels } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";
import { csvDay, csvNumber, toCsv } from "@/lib/members/csv";
import { listCampaignsUncached, type MetricKey } from "@/lib/campaigns/queries";
import type { CampaignMetrics } from "@/lib/campaigns/metrics";
import {
  parseCompare,
  periodDates,
  periodLabel,
  previousPeriod,
  resolvePeriod,
  variationOf,
} from "@/lib/periods";

export const dynamic = "force-dynamic";

const PLATFORM = statusLabels("adPlatform") as Record<string, string>;
const STATUS = statusLabels("campaign") as Record<string, string>;
const SOURCE: Record<string, string> = { CSV: "CSV", API: "API", MANUAL: "manuel" };

const METRICS: Array<{ key: MetricKey; label: string; money?: boolean }> = [
  { key: "spend", label: "Dépense (€)", money: true },
  { key: "entryClicks", label: "Clics sur les pubs" },
  { key: "members", label: "Membres" },
  { key: "offerClicks", label: "Clics sur les offres" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "Premiers dépôts (FTD)" },
  { key: "deposits", label: "Dépôts (nombre)" },
  { key: "depositAmount", label: "Dépôts (€)", money: true },
  { key: "cpl", label: "Coût par membre (CPL, €)", money: true },
  { key: "cpa", label: "Coût par inscription (CPA, €)", money: true },
  { key: "costPerFtd", label: "Coût par premier dépôt (€)", money: true },
  { key: "revenue", label: "Revenu net (NGR, €)", money: true },
  { key: "roas", label: "Retour sur dépense pub (ROAS)", money: true },
  { key: "profit", label: "Bénéfice (€)", money: true },
];

/**
 * Export CSV des campagnes sur la période (`range`, `from`, `to`).
 * - par défaut : une ligne par campagne avec dépense, clics, membres, clics sur les offres, inscriptions, premiers
 *   dépôts, dépôts, coût par membre, coût par inscription, coût par premier dépôt, revenu net, retour sur dépense pub,
 *   bénéfice (le terme technique entre parenthèses dans l'en-tête : un fichier n'a pas de survol) ;
 *   avec `compare=1`, chaque indicateur est suivi de la période précédente et de la variation en % ;
 * - `kind=costs` : coûts par jour (toutes les campagnes, ou `campaignId=…`).
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const period = resolvePeriod(Object.fromEntries(url.searchParams.entries()));
  const compare = parseCompare(url.searchParams.get("compare"));
  const { dateFrom, dateTo } = periodDates(period);
  const headers = (name: string) => ({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}-${period.from}-${period.to}.csv"`,
    "Cache-Control": "no-store",
  });

  if (url.searchParams.get("kind") === "costs") {
    const campaignId = url.searchParams.get("campaignId") || null;
    const scope = campaignId
      ? { OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] }
      : {};
    const costs = await prisma.adCost.findMany({
      where: { date: { gte: dateFrom, lte: dateTo }, ...scope },
      orderBy: [{ date: "desc" }],
      take: 20_000,
      include: {
        campaign: { select: { name: true } },
        adSet: { select: { name: true, campaign: { select: { name: true } } } },
        ad: {
          select: {
            name: true,
            adSet: { select: { name: true, campaign: { select: { name: true } } } },
          },
        },
      },
    });
    const csv = toCsv(
      [
        "Jour",
        "Campagne",
        "Groupe",
        "Pub",
        "Dépense",
        "Devise",
        "Impressions",
        "Clics (plateforme)",
        "Source",
      ],
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

  const { rows, total, previousTotal } = await listCampaignsUncached(period, compare);
  const head = [
    "Campagne",
    "Plateforme",
    "Statut",
    "Univers",
    "Canaux",
    "Liens d'entrée",
    "Offres",
    "Campagne pub à rattacher",
    "Période",
  ];
  for (const m of METRICS) {
    head.push(m.label);
    if (compare) head.push(`${m.label} – période précédente`, `${m.label} – variation (%)`);
  }
  const prevLabel = periodLabel(previousPeriod(period));
  const metricCells = (current: CampaignMetrics, previous: CampaignMetrics | null) => {
    const out: Array<string | number> = [];
    for (const m of METRICS) {
      const v = current[m.key];
      out.push(m.money ? csvNumber(v) : (v ?? 0));
      if (compare) {
        const pv = previous?.[m.key] ?? null;
        out.push(m.money ? csvNumber(pv) : (pv ?? 0));
        const d = variationOf(v, pv);
        out.push(d === null || d === undefined ? "" : csvNumber(d, 1));
      }
    }
    return out;
  };
  const periodText = compare ? `${periodLabel(period)} vs ${prevLabel}` : periodLabel(period);
  const csv = toCsv(head, [
    ...rows.map((r) => [
      r.name,
      r.adPlatform ? (PLATFORM[r.adPlatform] ?? r.adPlatform) : "",
      STATUS[r.status] ?? r.status,
      r.vertical ? universeLabel(r.vertical) : "",
      r.channels.join(", "),
      r.links,
      r.offers,
      r.importedFrom ? (PLATFORM[r.importedFrom] ?? r.importedFrom) : "",
      periodText,
      ...metricCells(r.metrics, r.previous),
    ]),
    // Total sur les joueurs, clics et membres distincts (même calcul que la ligne Total de la page).
    ...(rows.length
      ? [
          [
            "Total (chaque joueur compté une fois)",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            periodText,
            ...metricCells(total, previousTotal),
          ],
        ]
      : []),
  ]);
  return new Response(csv, { headers: headers(compare ? "campagnes-comparaison" : "campagnes") });
}
