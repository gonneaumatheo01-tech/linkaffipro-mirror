/**
 * Pages à capturer (fonctions pures, testées dans routes.test.ts) : adresses tirées des fichiers
 * `app/(admin)/**\/page.tsx`, adresses prévues par la refonte (docs/REFONTE-PLAN.md) même si elles n'existent pas
 * encore (notées « absente (404) » dans l'index), pages publiques, et noms de fichiers stables.
 */

/** Adresses cibles de la refonte (phase 9) : capturées dès qu'elles existent, notées absentes sinon. */
export const PLANNED_ROUTES = [
  "/campaigns/links",
  "/members/broadcasts",
  "/members/broadcasts/new",
  "/members/broadcasts/[id]",
  "/members/automations",
  "/members/automations/new",
  "/members/automations/[id]",
  "/stats",
  "/stats/ads",
  "/stats/funnel",
  "/stats/channels",
  "/stats/cohorts",
  "/settings/bots",
  "/settings/journal",
  "/settings/journal/events",
  "/styleguide",
];

/** Pages hors connexion (capturées dans une session vierge). */
export const PUBLIC_ROUTES = ["/login", "/privacy", "/terms"];

/** Ordre du menu de la refonte, puis anciennes adresses, puis pages publiques. */
const SECTION_ORDER = [
  "",
  "campaigns",
  "pages",
  "channels",
  "messages",
  "members",
  "stats",
  "settings",
  "help",
  "account",
  "styleguide",
];

function pathOf(route: string): string {
  const q = route.search(/[?#]/);
  return q === -1 ? route : route.slice(0, q);
}

export function isPublicRoute(route: string): boolean {
  return PUBLIC_ROUTES.includes(pathOf(route));
}

/**
 * Adresse d'un fichier page relatif à `app/(admin)` (séparateurs / ou \). Groupes `(x)` retirés ; null pour ce qui
 * n'est pas une page navigable (autre fichier, route parallèle `@x`, interceptée `(.)x`, dossier privé `_x`).
 */
export function routeFromPageFile(rel: string): string | null {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.pop() !== "page.tsx") return null;
  const segs: string[] = [];
  for (const p of parts) {
    if (p.startsWith("@") || p.startsWith("_") || /^\(\.+\)/.test(p)) return null;
    if (/^\(.*\)$/.test(p)) continue;
    segs.push(p);
  }
  return `/${segs.join("/")}`;
}

function sectionRank(route: string): number {
  if (isPublicRoute(route)) return SECTION_ORDER.length + 1;
  const first = pathOf(route).split("/")[1] ?? "";
  const i = SECTION_ORDER.indexOf(first);
  return i === -1 ? SECTION_ORDER.length : i;
}

/** Tri : ordre du menu, puis alphabétique dans chaque rubrique (la page de liste avant ses fiches). */
export function sortRoutes(routes: readonly string[]): string[] {
  return [...routes].sort(
    (a, b) => sectionRank(a) - sectionRank(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** Liste par défaut : pages existantes + adresses prévues + pages publiques, sans doublon, triée. */
export function defaultRoutes(discovered: readonly string[]): string[] {
  return sortRoutes([...new Set([...discovered, ...PLANNED_ROUTES, ...PUBLIC_ROUTES])]);
}

export function isDynamicRoute(route: string): boolean {
  return /\[[^\]]+\]/.test(pathOf(route));
}

/** Objets dont la base locale fournit un identifiant réel pour les fiches. */
export type EntityKey =
  | "campaign"
  | "channel"
  | "member"
  | "post"
  | "postAbGroup"
  | "broadcast"
  | "broadcastAbGroup"
  | "automation"
  | "importBatch"
  | "landingPage";
export type EntityIds = Partial<Record<EntityKey, string>>;

/** Segment qui précède l'identifiant → objet (anciennes et nouvelles adresses : /broadcasts et /members/broadcasts). */
const ENTITY_BY_SEGMENT: Record<string, EntityKey> = {
  campaigns: "campaign",
  channels: "channel",
  members: "member",
  messages: "post",
  broadcasts: "broadcast",
  automations: "automation",
  imports: "importBatch",
  // Phase 15 : fiche d'une page d'atterrissage (`/pages/[id]`).
  pages: "landingPage",
};
const AB_GROUP: Partial<Record<EntityKey, EntityKey>> = {
  post: "postAbGroup",
  broadcast: "broadcastAbGroup",
};

/** Objet de la fiche (un seul segment dynamique pris en charge), ou null. */
export function entityForRoute(route: string): EntityKey | null {
  const segs = pathOf(route).split("/").filter(Boolean);
  const dyn = segs.map((s, i) => (/^\[.+\]$/.test(s) ? i : -1)).filter((i) => i >= 0);
  if (dyn.length !== 1) return null;
  const at = dyn[0]!;
  const prev = segs[at - 1];
  if (prev === "ab") {
    const owner = ENTITY_BY_SEGMENT[segs[at - 2] ?? ""];
    return owner ? (AB_GROUP[owner] ?? null) : null;
  }
  return ENTITY_BY_SEGMENT[prev ?? ""] ?? null;
}

/** Adresse concrète : le segment dynamique remplacé par l'identifiant trouvé ; null s'il n'y en a pas. */
export function fillRoute(route: string, ids: EntityIds): string | null {
  if (!isDynamicRoute(route)) return route;
  const entity = entityForRoute(route);
  const id = entity ? ids[entity] : undefined;
  if (!id) return null;
  const q = route.search(/[?#]/);
  const path = q === -1 ? route : route.slice(0, q);
  const rest = q === -1 ? "" : route.slice(q);
  return path.replace(/\[[^\]]+\]/, encodeURIComponent(id)) + rest;
}

/** Nom stable tiré de l'adresse (jamais de l'identifiant réel) : « / » → accueil, `/campaigns/[id]` → campaigns-id. */
export function routeSlug(route: string): string {
  const slug = route
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[[\]]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "accueil";
}

export function captureFileName(
  route: string,
  width: number,
  ext: "webp" | "png" = "webp",
): string {
  return `${routeSlug(route)}-${width}.${ext}`;
}
