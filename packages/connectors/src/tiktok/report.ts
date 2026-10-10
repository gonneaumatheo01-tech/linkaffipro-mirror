/**
 * Rapport journalier TikTok (`/report/integrated/get/`, niveau pub) → lignes `AdInsightRow`.
 * Les métriques arrivent en chaînes (« 12.34 ») : converties en nombres ; `stat_time_day` arrive
 * en « AAAA-MM-JJ 00:00:00 » : tronqué à la date. 30 jours maximum par requête (découpe faite par l'appelant),
 * pagination par `page` / `page_info.total_page`.
 */
import type { AdInsightRow, DateRange } from "../types";

export const REPORT_PATH = "/open_api/v1.3/report/integrated/get/";
export const REPORT_PAGE_SIZE = 1000;
export const REPORT_DIMENSIONS = ["ad_id", "stat_time_day"] as const;
export const REPORT_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "conversion",
  "campaign_id",
  "campaign_name",
  "adgroup_id",
  "adgroup_name",
  "ad_name",
  "currency",
] as const;

export type TikTokReportRow = {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

export type TikTokReportPage = {
  list?: TikTokReportRow[];
  page_info?: { page?: number; page_size?: number; total_number?: number; total_page?: number };
};

/** Paramètres de requête d'une page de rapport. */
export function reportQuery(advertiserId: string, range: DateRange, page: number): URLSearchParams {
  return new URLSearchParams({
    advertiser_id: advertiserId,
    service_type: "AUCTION",
    report_type: "BASIC",
    data_level: "AUCTION_AD",
    dimensions: JSON.stringify(REPORT_DIMENSIONS),
    metrics: JSON.stringify(REPORT_METRICS),
    start_date: range.from,
    end_date: range.to,
    page: String(page),
    page_size: String(REPORT_PAGE_SIZE),
  });
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function optNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || v === "-") return null;
  return num(v);
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

/** Tronque « 2026-10-01 00:00:00 » (ou ISO) à « 2026-10-01» ; vide si illisible. */
export function statDay(v: unknown): string {
  const s = str(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : "";
}

/** Convertit une ligne TikTok en ligne normalisée ; `null` si la ligne n'a ni date ni pub. */
export function mapReportRow(row: TikTokReportRow, fallbackCurrency: string): AdInsightRow | null {
  const d = row.dimensions ?? {};
  const m = row.metrics ?? {};
  const date = statDay(d.stat_time_day ?? m.stat_time_day);
  const adId = str(d.ad_id ?? m.ad_id);
  if (!date || !adId) return null;
  const campaignId = str(m.campaign_id ?? d.campaign_id);
  return {
    date,
    campaignExternalId: campaignId || `sans-campagne`,
    campaignName: str(m.campaign_name) || campaignId || "Campagne TikTok",
    adSetExternalId: str(m.adgroup_id ?? d.adgroup_id) || null,
    adSetName: str(m.adgroup_name) || null,
    adExternalId: adId,
    adName: str(m.ad_name) || adId,
    spend: num(m.spend),
    currency: (str(m.currency).trim().toUpperCase() || fallbackCurrency || "USD").toUpperCase(),
    impressions: Math.round(num(m.impressions)),
    clicks: Math.round(num(m.clicks)),
    reach: optNum(m.reach),
    results: optNum(m.conversion),
  };
}

/** Convertit une page entière ; les lignes illisibles sont ignorées (jamais inventées). */
export function mapReportPage(
  page: TikTokReportPage | undefined,
  fallbackCurrency: string,
): AdInsightRow[] {
  const out: AdInsightRow[] = [];
  for (const row of page?.list ?? []) {
    const mapped = mapReportRow(row, fallbackCurrency);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Y a-t-il une page suivante ? (`total_page` absent → on s'arrête dès qu'une page est incomplète). */
export function hasNextPage(page: TikTokReportPage | undefined, currentPage: number): boolean {
  const info = page?.page_info;
  if (info?.total_page !== undefined && info.total_page !== null)
    return currentPage < Number(info.total_page);
  const size = Number(info?.page_size ?? REPORT_PAGE_SIZE);
  return (page?.list?.length ?? 0) >= size;
}
