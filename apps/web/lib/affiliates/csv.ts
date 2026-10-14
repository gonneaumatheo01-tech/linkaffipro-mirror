/**
 * Exports CSV de la vue « Affiliés Link Affi » (phase 13) : une ligne par campagne Telegram d'affilié (et une ligne de
 * total), ou la liste des premiers dépôts. Fonctions pures, testées dans csv.test.ts ; la route
 * app/(admin)/campaigns/affiliates/export/route.ts les sert avec ses en-têtes (le terme technique y suit le mot du
 * client entre parenthèses : un fichier n'a pas de survol ; seule une route d'export peut l'écrire).
 * Colonnes, dans l'ordre : `CAMPAIGN_COLUMNS` et `FTD_COLUMNS` (une clé par colonne ; la route donne les libellés).
 */
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import type { AffiliateFigures, AffiliateView } from "./figures";
import { campaignLabel } from "./scope";

/** Colonnes de l'export des campagnes, dans l'ordre des cellules. */
export const CAMPAIGN_COLUMNS = [
  "affiliate",
  "affiliateId",
  "campaign",
  "campaignKey",
  "channel",
  "active",
  "attribution",
  "period",
  "clicks",
  "requests",
  "approved",
  "present",
  "left",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
  "depositAmount",
  "revenue",
] as const;
export type CampaignColumn = (typeof CAMPAIGN_COLUMNS)[number];

/** En-têtes dans l'ordre des colonnes (libellés donnés par la route d'export). */
export function headersFor<C extends string>(
  columns: readonly C[],
  labels: Readonly<Record<C, string>>,
): string[] {
  return columns.map((c) => labels[c]);
}

function figureCells(f: AffiliateFigures): Array<string | number> {
  return [
    f.clicks === null ? "" : f.clicks,
    f.requests,
    f.approved,
    f.present,
    f.left,
    f.offerClicks,
    f.registrations,
    f.ftds,
    f.deposits,
    csvNumber(f.depositAmount),
    csvNumber(f.revenue),
  ];
}

/** Durée d'attribution d'une campagne en mots (« à vie », « 30 jours »). */
export function attributionText(days: number | null): string {
  return days && days > 0 ? `${days} jour${days > 1 ? "s" : ""}` : "à vie";
}

/** Une ligne par campagne, puis le total des campagnes exportées. */
export function affiliatesCsv(
  affiliates: readonly AffiliateView[],
  totals: AffiliateFigures,
  periodText: string,
  labels: Readonly<Record<CampaignColumn, string>>,
): string {
  const rows: Array<Array<string | number>> = [];
  for (const a of affiliates)
    for (const c of a.campaigns)
      rows.push([
        a.name,
        c.ref.affiliateId ?? "",
        campaignLabel(c.ref),
        c.ref.campaignKey,
        c.ref.channelTitle,
        c.ref.isActive ? "oui" : "non",
        attributionText(c.ref.attributionDays),
        periodText,
        ...figureCells(c.figures),
      ]);
  if (rows.length > 0)
    rows.push(["Total", "", "", "", "", "", "", periodText, ...figureCells(totals)]);
  return toCsv(headersFor(CAMPAIGN_COLUMNS, labels), rows);
}

/** Colonnes de la liste des premiers dépôts, dans l'ordre des cellules. */
export const FTD_COLUMNS = [
  "affiliate",
  "campaign",
  "channel",
  "member",
  "ftdAt",
  "amount",
  "offer",
] as const;
export type FtdColumn = (typeof FTD_COLUMNS)[number];

/** La liste des premiers dépôts de la période, du plus récent au plus ancien. */
export function affiliateFtdsCsv(
  affiliates: readonly AffiliateView[],
  labels: Readonly<Record<FtdColumn, string>>,
): string {
  const rows = affiliates
    .flatMap((a) => a.campaigns.flatMap((c) => c.ftdList.map((f) => ({ a, c, f }))))
    .sort((x, y) => y.f.ftdAt.getTime() - x.f.ftdAt.getTime())
    .map(({ a, c, f }) => [
      a.name,
      campaignLabel(c.ref),
      c.ref.channelTitle,
      f.memberName,
      csvDate(f.ftdAt),
      csvNumber(f.amount),
      f.offerName,
    ]);
  return toCsv(headersFor(FTD_COLUMNS, labels), rows);
}
