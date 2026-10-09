/**
 * Macros de suivi des plateformes publicitaires, remplacées par la plateforme au moment du clic.
 * Sources officielles :
 * - TikTok : https://ads.tiktok.com/help/article/track-offsite-web-events-with-utm-parameters (macros __CAMPAIGN_NAME__, __CAMPAIGN_ID__,
 *   __AID_NAME__, __AID__, __CID_NAME__, __CID__, __PLACEMENT__) et https://ads.tiktok.com/help/article/tiktok-click-id
 *   (ttclid ajouté automatiquement depuis avril 2024 ; la forme historique `ttclid=__CLICKID__` reste acceptée).
 * - Meta : https://www.facebook.com/business/help/2360940870872492 (paramètres dynamiques {{campaign.name}}, {{adset.name}},
 *   {{ad.name}}, {{campaign.id}}, {{adset.id}}, {{ad.id}}, {{placement}}, {{site_source_name}}) ; le fbclid est ajouté automatiquement.
 */
export type AdPlatformKey = "TIKTOK" | "META" | "OTHER";

export const AD_MACROS: Record<AdPlatformKey, Record<string, string>> = {
  TIKTOK: {
    ttclid: "__CLICKID__",
    utm_source: "tiktok",
    utm_medium: "paid",
    utm_campaign: "__CAMPAIGN_NAME__",
    utm_content: "__CID_NAME__",
    utm_term: "__AID_NAME__",
    tt_campaign_id: "__CAMPAIGN_ID__",
    tt_adgroup_id: "__AID__",
    tt_ad_id: "__CID__",
    tt_placement: "__PLACEMENT__",
  },
  META: {
    utm_source: "meta",
    utm_medium: "paid",
    utm_campaign: "{{campaign.name}}",
    utm_content: "{{ad.name}}",
    utm_term: "{{adset.name}}",
    fb_campaign_id: "{{campaign.id}}",
    fb_adset_id: "{{adset.id}}",
    fb_ad_id: "{{ad.id}}",
    fb_placement: "{{placement}}",
  },
  OTHER: {
    utm_source: "other",
    utm_medium: "paid",
  },
};

/**
 * Construit l'URL à coller dans la pub : lien goolink + macros de la plateforme.
 * Les macros ne sont pas encodées (la plateforme les remplace telles quelles).
 */
export function buildAdUrl(platform: AdPlatformKey, baseUrl: string, extra: Record<string, string> = {}): string {
  const params = { ...AD_MACROS[platform], ...extra };
  const qs = Object.entries(params)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${isMacro(v) ? v : encodeURIComponent(v)}`)
    .join("&");
  const sep = baseUrl.includes("?") ? "&" : "?";
  return qs ? `${baseUrl}${sep}${qs}` : baseUrl;
}

function isMacro(v: string): boolean {
  return /^__[A-Z0-9_]+__$/.test(v) || /^\{\{[a-z_.]+\}\}$/.test(v);
}

export const AD_PLATFORM_LABELS: Record<AdPlatformKey, string> = { TIKTOK: "TikTok", META: "Meta (Facebook / Instagram)", OTHER: "Autre" };
