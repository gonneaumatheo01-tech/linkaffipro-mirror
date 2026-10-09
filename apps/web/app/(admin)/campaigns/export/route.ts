import { prisma } from "@linkaffipro/db";
import { VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { statusLabels } from "@/lib/status-badges";
import { csvDay, csvNumber, toCsv } from "@/lib/members/csv";
import { listCampaignsUncached, rangeKeyOf, sinceFor } from "@/lib/campaigns/queries";

export const dynamic = "force-dynamic";

const PLATFORM = statusLabels("adPlatform") as Record<string, string>;
const STATUS = statusLabels("campaign") as Record<string, string>;
const SOURCE: Record<string, string> = { CSV: "CSV", API: "API", MANUAL: "manuel" };

/**
 * Export CSV des pubs.
 * - par défaut : une ligne par pub avec dépense, clics, membres, inscrits, FTD, CPL, CPA, coût par FTD, revenu, ROAS sur la période (`range` = 7, 30 ou 90 jours) ;
 * - `kind=costs` : coûts par jour (toutes les pubs, ou `campaignId=…`).
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const range = rangeKeyOf(url.searchParams.get("range") ?? undefined);
  const since = sinceFor(range);
  const date = new Date().toISOString().slice(0, 10);
  const headers = (name: string) => ({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${date}.csv"`, "Cache-Control": "no-store" });

  if (url.searchParams.get("kind") === "costs") {
    const campaignId = url.searchParams.get("campaignId") || null;
    const scope = campaignId ? { OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] } : {};
    const costs = await prisma.adCost.findMany({
      where: { date: { gte: since }, ...scope },
      orderBy: [{ date: "desc" }],
      take: 20_000,
      include: { campaign: { select: { name: true } }, adSet: { select: { name: true, campaign: { select: { name: true } } } }, ad: { select: { name: true, adSet: { select: { name: true, campaign: { select: { name: true } } } } } } },
    });
    const csv = toCsv(
      ["Jour", "Pub (campagne)", "Groupe", "Pub précise", "Dépense", "Devise", "Impressions", "Clics (plateforme)", "Source"],
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

  const rows = await listCampaignsUncached(range);
  const csv = toCsv(
    ["Pub", "Plateforme", "Statut", "Univers", "Canaux", "Liens d'entrée", `Période (jours)`, "Dépense (€)", "Clics d'entrée", "Membres", "Inscrits", "FTD", "CPL (€)", "CPA (€)", "Coût par FTD (€)", "Revenu (€)", "ROAS", "Résultat (€)"],
    rows.map((r) => [
      r.name,
      r.adPlatform ? (PLATFORM[r.adPlatform] ?? r.adPlatform) : "",
      STATUS[r.status] ?? r.status,
      r.vertical ? VERTICAL_LABELS[r.vertical as Vertical] : "",
      r.channels.join(", "),
      r.links,
      range,
      csvNumber(r.metrics.spend),
      r.metrics.entryClicks ?? 0,
      r.metrics.members,
      r.metrics.registrations,
      r.metrics.ftds,
      csvNumber(r.metrics.cpl),
      csvNumber(r.metrics.cpa),
      csvNumber(r.metrics.costPerFtd),
      csvNumber(r.metrics.revenue),
      csvNumber(r.metrics.roas),
      csvNumber(r.metrics.profit),
    ]),
  );
  return new Response(csv, { headers: headers("pubs") });
}
