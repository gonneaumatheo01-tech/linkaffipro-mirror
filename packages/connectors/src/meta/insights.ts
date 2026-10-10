/**
 * Rapports Meta (Insights API, niveau pub, un enregistrement par jour) → lignes normalisées `AdInsightRow`.
 * Les « résultats » sont la somme des actions de type lead / purchase / complete_registration / omni_purchase
 * (quand Meta les renvoie) ; `null` sinon, pour ne pas inventer de zéro.
 */
import type { AdInsightRow } from "../types";

export const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "reach",
  "actions",
  "account_currency",
  "date_start",
  "date_stop",
] as const;

/** Types d'actions comptés comme « résultats » (ordre sans importance ; doublons omni_* additionnés tels quels). */
export const RESULT_ACTION_TYPES = [
  "lead",
  "purchase",
  "complete_registration",
  "omni_purchase",
] as const;

export type MetaAction = { action_type?: string; value?: string | number };

export type MetaInsightRaw = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  reach?: string | number;
  actions?: MetaAction[];
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
};

/** Somme des actions « résultat » ; `null` si aucune action de ces types n'est présente. */
export function sumResults(actions: MetaAction[] | undefined | null): number | null {
  if (!actions || actions.length === 0) return null;
  let found = false;
  let total = 0;
  for (const a of actions) {
    if (!a.action_type || !(RESULT_ACTION_TYPES as readonly string[]).includes(a.action_type))
      continue;
    const v = Number(a.value);
    if (!Number.isFinite(v)) continue;
    found = true;
    total += v;
  }
  return found ? total : null;
}

function num(v: string | number | undefined | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function optNum(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Convertit un enregistrement Meta en ligne normalisée ; `null` si l'enregistrement est inexploitable (pas de date ou de campagne). */
export function mapInsightRow(raw: MetaInsightRaw, fallbackCurrency: string): AdInsightRow | null {
  const date = raw.date_start?.slice(0, 10);
  if (!date || !raw.campaign_id) return null;
  return {
    date,
    campaignExternalId: String(raw.campaign_id),
    campaignName: raw.campaign_name?.trim() || `Campagne ${raw.campaign_id}`,
    adSetExternalId: raw.adset_id ? String(raw.adset_id) : null,
    adSetName: raw.adset_name?.trim() || null,
    adExternalId: raw.ad_id ? String(raw.ad_id) : null,
    adName: raw.ad_name?.trim() || null,
    spend: num(raw.spend),
    currency: (raw.account_currency || fallbackCurrency || "EUR").toUpperCase(),
    impressions: Math.round(num(raw.impressions)),
    clicks: Math.round(num(raw.clicks)),
    reach: optNum(raw.reach),
    results: sumResults(raw.actions),
  };
}

export function mapInsightRows(rows: MetaInsightRaw[], fallbackCurrency: string): AdInsightRow[] {
  const out: AdInsightRow[] = [];
  for (const r of rows) {
    const m = mapInsightRow(r, fallbackCurrency);
    if (m) out.push(m);
  }
  return out;
}
