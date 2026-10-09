/** Paramètres de clic publicitaire et UTM conservés lors d'une redirection. */
export const CLICK_ID_PARAMS = ["ttclid", "fbclid", "gclid", "msclkid"] as const;

export type TrackingParams = {
  clickIds: Partial<Record<(typeof CLICK_ID_PARAMS)[number], string>>;
  utm: Record<string, string>;
};

/** Extrait ttclid / fbclid / gclid et les utm_* d'une liste de paramètres. */
export function extractTrackingParams(search: URLSearchParams): TrackingParams {
  const clickIds: TrackingParams["clickIds"] = {};
  const utm: Record<string, string> = {};
  for (const [key, value] of search.entries()) {
    const k = key.toLowerCase();
    if ((CLICK_ID_PARAMS as readonly string[]).includes(k)) {
      clickIds[k as (typeof CLICK_ID_PARAMS)[number]] = value.slice(0, 512);
    } else if (k.startsWith("utm_")) {
      utm[k] = value.slice(0, 256);
    }
  }
  return { clickIds, utm };
}

/**
 * Indique si une requête HTTP vise le domaine de tracking.
 * Compare l'hôte (sans port) au domaine configuré, en acceptant le sous-domaine `www.`.
 */
export function isTrackingHost(hostHeader: string | null | undefined, trackingHost: string | undefined): boolean {
  if (!hostHeader || !trackingHost) return false;
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  const target = trackingHost.toLowerCase();
  return host === target || host === `www.${target}`;
}
