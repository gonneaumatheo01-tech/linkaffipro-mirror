/**
 * Anciennes adresses du site → nouvelles (phase 9, docs/REFONTE-PLAN.md « Navigation cible et adresses »).
 * Fonction pure, testée dans legacy-routes.test.ts, appelée par `proxy.ts` APRÈS la branche du domaine de tracking
 * (go.goolink.eu n'est jamais concerné) : réponse 308, paramètres de l'adresse conservés.
 * Les routes d'API, les liens traqués (`/r/…`) et les fichiers de Next ne sont jamais redirigés.
 */

/** Rubriques déplacées : l'ancien préfixe et tout ce qui est dessous vont sous le nouveau. */
export const LEGACY_PREFIXES: ReadonlyArray<readonly [from: string, to: string]> = [
  ["/broadcasts", "/members/broadcasts"],
  ["/automations", "/members/automations"],
  ["/bots", "/settings/bots"],
  ["/journal", "/settings/journal"],
  ["/links", "/campaigns/links"],
];

/**
 * Paramètres de l'ancien tableau de bord (qui vivait à « / ») : onglet, période, comparaison, filtres, dimension
 * du parcours, tri des pubs. L'accueil n'en utilise aucun : leur présence sur « / » signale une ancienne adresse.
 */
const DASHBOARD_PARAMS = [
  "tab",
  "range",
  "from",
  "to",
  "compare",
  "vertical",
  "channelId",
  "campaignId",
  "dim",
  "sort",
  "dir",
] as const;

/**
 * Onglets de l'ancien tableau de bord et leur page dans Statistiques (étape 7 : une page par onglet, `tab: null`).
 * Sert aux deux anciennes formes : `/?tab=ads` (tableau de bord sur l'accueil) et `/stats?tab=ads` (étapes 2 à 6).
 */
const STATS_TABS: Record<string, { path: string; tab: string | null }> = {
  overview: { path: "/stats", tab: null },
  ads: { path: "/stats/ads", tab: null },
  funnel: { path: "/stats/funnel", tab: null },
  cohorts: { path: "/stats/cohorts", tab: null },
  channels: { path: "/stats/channels", tab: null },
};

/**
 * Le calendrier des messages montre les meilleurs créneaux (étape 4 de la refonte : surlignés dans la semaine,
 * « Programmer un message à ce créneau ») : l'ancien onglet « Meilleurs horaires » de la fiche canal redirige vers
 * le calendrier filtré sur ce canal (`/messages?channelId=…`).
 */
export const BEST_HOURS_IN_CALENDAR = true;

/** Cible dans Statistiques d'un onglet de l'ancien tableau de bord (inconnu ou absent : vue d'ensemble). */
export function statsTarget(tab: string | null): { path: string; tab: string | null } {
  return (
    (tab !== null && Object.hasOwn(STATS_TABS, tab) ? STATS_TABS[tab] : undefined) ??
    STATS_TABS.overview!
  );
}

/** Page des statistiques d'un ancien onglet (`tab`), avec les autres paramètres dans l'ordre. */
function toStatsPage(params: URLSearchParams): string {
  const target = statsTarget(params.get("tab"));
  if (target.tab === null) params.delete("tab");
  else params.set("tab", target.tab);
  return withQuery(target.path, params);
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function toParams(searchParams: URLSearchParams | string): URLSearchParams {
  return new URLSearchParams(searchParams);
}

/** Jamais redirigé : API, liens traqués, fichiers internes de Next. */
function isExcluded(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/r" ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/_next/")
  );
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Nouvelle adresse (chemin et paramètres) pour une ancienne adresse, ou `null` si l'adresse est à jour.
 * - `/broadcasts…`, `/automations…`, `/bots…`, `/journal…`, `/links…` → sous Membres, Réglages ou Campagnes ;
 * - `/` avec des paramètres de l'ancien tableau de bord (`?tab=ads`, `?range=30d`…) → la page des statistiques de
 *   l'onglet (`/stats/ads`…, « Vue d'ensemble » = `/stats`), autres paramètres gardés ;
 * - `/stats?tab=ads|funnel|cohorts|channels` → `/stats/ads`… (`overview` ou inconnu : `/stats`) ;
 * - `/channels/<id>?tab=besthours` → `/messages?channelId=<id>` (meilleurs créneaux dans le calendrier), seulement
 *   quand `bestHoursInCalendar` (par défaut `BEST_HOURS_IN_CALENDAR`).
 */
export function legacyRedirect(
  pathname: string,
  searchParams: URLSearchParams | string = "",
  options: { bestHoursInCalendar?: boolean } = {},
): string | null {
  if (isExcluded(pathname)) return null;

  for (const [from, to] of LEGACY_PREFIXES) {
    if (pathname === from || pathname.startsWith(`${from}/`)) {
      return withQuery(to + pathname.slice(from.length), toParams(searchParams));
    }
  }

  if (pathname === "/") {
    const params = toParams(searchParams);
    if (!DASHBOARD_PARAMS.some((k) => params.has(k))) return null;
    return toStatsPage(params);
  }

  // Statistiques à onglets (étapes 2 à 6) : `/stats?tab=ads` → `/stats/ads`, autres paramètres gardés.
  if (pathname === "/stats" || pathname === "/stats/") {
    const params = toParams(searchParams);
    if (!params.has("tab")) return null;
    return toStatsPage(params);
  }

  const { bestHoursInCalendar = BEST_HOURS_IN_CALENDAR } = options;
  if (bestHoursInCalendar) {
    const channel = /^\/channels\/([^/]+)$/.exec(pathname);
    if (channel && channel[1] !== "import") {
      const params = toParams(searchParams);
      if (params.get("tab") === "besthours") {
        params.delete("tab");
        params.delete("cat");
        const out = new URLSearchParams({ channelId: safeDecode(channel[1]!) });
        for (const [k, v] of params) if (k !== "channelId") out.append(k, v);
        return withQuery("/messages", out);
      }
    }
  }

  return null;
}
