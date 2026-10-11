import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { statusLabels } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";
import { csvDay, csvNumber, toCsv } from "@/lib/members/csv";
import { listCampaignsUncached, type MetricKey } from "@/lib/campaigns/queries";
import type { CampaignMetrics } from "@/lib/campaigns/metrics";
import { exportDelta, type ExportFormat } from "@/lib/dashboard/export-cells";
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

/**
 * Colonnes des campagnes ; le terme technique entre parenthèses dans l'en-tête (un fichier n'a pas de survol).
 * « (CPA, … ) » ne désigne que le coût par inscription : les primes des joueurs sont la « commission CPA »
 * (`ambiguousCpaHeaders`, testé).
 */
const METRICS: Array<{ key: MetricKey; label: string; format: ExportFormat }> = [
  { key: "spend", label: "Dépense (€)", format: "money" },
  { key: "entryClicks", label: "Clics sur les pubs", format: "number" },
  { key: "members", label: "Membres", format: "number" },
  { key: "offerClicks", label: "Clics sur les offres", format: "number" },
  { key: "registrations", label: "Inscriptions", format: "number" },
  { key: "ftds", label: "Premiers dépôts (FTD)", format: "number" },
  { key: "deposits", label: "Dépôts (nombre)", format: "number" },
  { key: "depositAmount", label: "Dépôts (€)", format: "money" },
  { key: "cpl", label: "Coût par membre (CPL, €)", format: "money" },
  { key: "cpa", label: "Coût par inscription (CPA, €)", format: "money" },
  { key: "costPerFtd", label: "Coût par premier dépôt (€)", format: "money" },
  { key: "revenue", label: "Revenu net (NGR, €)", format: "money" },
  { key: "cpaCommissions", label: "Primes des joueurs (commission CPA, €)", format: "money" },
  { key: "revshareCommissions", label: "Part du revenu (revshare, €)", format: "money" },
  { key: "commissions", label: "Commissions (€)", format: "money" },
  { key: "roas", label: "Retour sur dépense pub (ROAS)", format: "ratio" },
  { key: "gains", label: "Gains (€)", format: "money" },
];

/**
 * Export CSV des campagnes sur la période (`range`, `from`, `to`).
 * - par défaut : une ligne par campagne avec dépense, clics, membres, clics sur les offres, inscriptions, premiers
 *   dépôts, dépôts, coût par membre, coût par inscription, coût par premier dépôt, revenu net (volume), commissions
 *   (primes des joueurs + part du revenu), retour sur dépense pub (commissions ÷ dépense), gains (commissions −
 *   dépense pub) ;
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
      const cell = (x: number | null | undefined) =>
        m.format === "number" ? (x ?? 0) : csvNumber(x);
      out.push(cell(v));
      if (compare) {
        const pv = previous?.[m.key] ?? null;
        out.push(cell(pv));
        // Règle du site : pas de pourcentage sur une base négative (gains d'avant en perte).
        const d = exportDelta(variationOf(v, pv), pv);
        out.push(d === null ? "" : csvNumber(d, 1));
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
