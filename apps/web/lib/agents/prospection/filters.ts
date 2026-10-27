/**
 * Phase 31 — filtres de la page Agents → Prospection : lecture de l'adresse (`?pays=FR&niveau=A…`), condition Prisma,
 * tri, vues toutes prêtes et adresses. Mêmes filtres pour le tableau, l'avancement et l'export CSV. Règle absolue :
 * un canal hors Europe (`region = NON_EU`) n'est jamais montré ni compté, sauf pour un pays que le client a ajouté au
 * périmètre (`prospection.countries_scope` élargi). Règles pures.
 */
import type { Prisma } from "@linkaffipro/db";
import {
  COMPETITIVE_STATES,
  CONTACT_LEVELS,
  OPENNESS_KEYS,
  PROSPECTION_PATH,
  PROSPECT_STATUSES,
  SOURCE_TYPES,
  TIERS,
  VERTICALS,
  extraScopeCountries,
  type OpennessKey,
  type ProspectStatusKey,
} from "./display";

export const PROSPECTION_VIEWS = ["tableau", "avancement", "offres", "sources", "dictionnaires", "reglages"] as const;
export type ProspectionView = (typeof PROSPECTION_VIEWS)[number];

export const PROSPECTION_VIEW_LABELS: Record<ProspectionView, string> = {
  tableau: "Canaux trouvés",
  avancement: "Avancement",
  offres: "Vos offres",
  sources: "Sources",
  dictionnaires: "Marques et repères",
  reglages: "Réglages",
};

/** Filtres de statut en plus des statuts eux-mêmes : « en cours » (contacté, a répondu, en discussion), « tous ». */
export const STATUS_GROUPS = {
  suivi: ["CONTACTED", "RESPONDED", "NEGOTIATING"],
  /** Par défaut : tout sauf les canaux écartés et ceux à ne plus montrer. */
  defaut: PROSPECT_STATUSES.filter((s) => s !== "DISQUALIFIED" && s !== "BLACKLISTED"),
} as const satisfies Record<string, readonly ProspectStatusKey[]>;

export const SORTS = ["note", "abonnes", "vues", "taux", "recent", "decouverte"] as const;
export type ProspectSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<ProspectSort, string> = {
  note: "Note (la meilleure d'abord)",
  abonnes: "Abonnés",
  vues: "Vues par post",
  taux: "Part des abonnés qui lisent",
  recent: "Dernière action",
  decouverte: "Trouvé le plus récemment",
};

export type ProspectFilters = {
  q: string | null;
  country: string | null;
  vertical: string | null;
  tier: string | null;
  /** Statut précis, « suivi », « tous » ou null (par défaut). */
  status: string | null;
  competition: string | null;
  openness: OpennessKey | null;
  contact: string | null;
  source: string | null;
  sort: ProspectSort;
};

export const EMPTY_FILTERS: ProspectFilters = {
  q: null,
  country: null,
  vertical: null,
  tier: null,
  status: null,
  competition: null,
  openness: null,
  contact: null,
  source: null,
  sort: "note",
};

const first = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
};
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => {
  const s = first(v);
  return s && (list as readonly string[]).includes(s) ? (s as T) : null;
};

export function parseProspectionView(v: unknown): ProspectionView {
  return pick(PROSPECTION_VIEWS, v) ?? "tableau";
}

export function parseProspectFilters(sp: Record<string, unknown>): ProspectFilters {
  const q = first(sp.q)?.slice(0, 80) ?? null;
  const country = first(sp.pays)?.toUpperCase();
  const status = first(sp.statut);
  return {
    q,
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    vertical: pick(VERTICALS, sp.verticale),
    tier: pick(TIERS, sp.niveau),
    status: status === "suivi" || status === "tous" || (PROSPECT_STATUSES as readonly string[]).includes(status ?? "") ? (status as string) : null,
    competition: pick(COMPETITIVE_STATES, sp.concurrence),
    openness: pick(OPENNESS_KEYS, sp.ouverture),
    contact: pick(CONTACT_LEVELS, sp.contact),
    source: pick(SOURCE_TYPES, sp.source),
    sort: pick(SORTS, sp.tri) ?? "note",
  };
}

/** Filtres → paramètres d'adresse (valeurs vides omises ; tri par défaut omis). */
export function filterParams(f: ProspectFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.country) out.pays = f.country;
  if (f.vertical) out.verticale = f.vertical;
  if (f.tier) out.niveau = f.tier;
  if (f.status) out.statut = f.status;
  if (f.competition) out.concurrence = f.competition;
  if (f.openness) out.ouverture = f.openness;
  if (f.contact) out.contact = f.contact;
  if (f.source) out.source = f.source;
  if (f.sort !== "note") out.tri = f.sort;
  return out;
}

export function hasFilters(f: ProspectFilters): boolean {
  return Object.keys(filterParams({ ...f, sort: "note" })).length > 0;
}

export function viewHref(view: ProspectionView, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (view !== "tableau") q.set("vue", view);
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `${PROSPECTION_PATH}${s ? `?${s}` : ""}`;
}

/** Adresse de l'export CSV des lignes filtrées (celle que donne Kevin : `/agents/prospection?export=csv`). */
export function exportHref(f: ProspectFilters): string {
  const q = new URLSearchParams(filterParams(f)).toString();
  return `${PROSPECTION_PATH}/export${q ? `?${q}` : ""}`;
}

/** Vues toutes prêtes (« vues enregistrées ») : un clic remplit les filtres. */
export const QUICK_VIEWS: ReadonlyArray<{ key: string; label: string; filters: Partial<ProspectFilters> }> = [
  { key: "a-contacter", label: "À contacter", filters: { status: "QUALIFIED" } },
  { key: "a-libres", label: "Niveau A sans concurrent", filters: { tier: "A", competition: "FREE" } },
  { key: "vendent-pub", label: "Vendent de la pub", filters: { openness: "pub", status: "QUALIFIED" } },
  { key: "contact-direct", label: "Contact direct", filters: { contact: "HIGH", status: "QUALIFIED" } },
  { key: "en-cours", label: "En cours avec vous", filters: { status: "suivi", sort: "recent" } },
  { key: "signes", label: "Signés", filters: { status: "SIGNED", sort: "recent" } },
];

export function quickViewFilters(key: string): ProspectFilters | null {
  const v = QUICK_VIEWS.find((x) => x.key === key);
  return v ? { ...EMPTY_FILTERS, ...v.filters } : null;
}

/** La vue toute prête qui correspond exactement aux filtres courants, s'il y en a une. */
export function currentQuickView(f: ProspectFilters): string | null {
  const cur = JSON.stringify(filterParams(f));
  for (const v of QUICK_VIEWS) if (JSON.stringify(filterParams({ ...EMPTY_FILTERS, ...v.filters })) === cur) return v.key;
  return null;
}

// ------------------------------------------------------------------------------------------------- base

/**
 * Canaux visibles : jamais un canal hors Europe, sauf ceux d'un pays ajouté au périmètre par le client. Même condition
 * pour les listes, les comptages et l'export.
 */
export function visibleRegionWhere(scope: readonly string[]): Prisma.ProspectWhereInput {
  const extra = extraScopeCountries(scope);
  if (!extra.length) return { region: { not: "NON_EU" } };
  return {
    OR: [{ region: { not: "NON_EU" } }, ...extra.map((c) => ({ region: "NON_EU" as const, countries: { array_contains: [c] } }))],
  };
}

export function statusesOf(f: Pick<ProspectFilters, "status">): ProspectStatusKey[] | null {
  if (f.status === "tous") return null;
  if (f.status === "suivi") return [...STATUS_GROUPS.suivi];
  if (f.status) return [f.status as ProspectStatusKey];
  return [...STATUS_GROUPS.defaut];
}

/** Condition Prisma complète (région visible + filtres). `ignoreStatus` : l'avancement montre tous les statuts. */
export function prospectWhere(f: ProspectFilters, scope: readonly string[], opts: { ignoreStatus?: boolean } = {}): Prisma.ProspectWhereInput {
  const and: Prisma.ProspectWhereInput[] = [visibleRegionWhere(scope)];
  if (!opts.ignoreStatus) {
    const st = statusesOf(f);
    if (st) and.push({ status: { in: st } });
  }
  if (f.q) {
    const bare = f.q.replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\/(s\/)?/i, "");
    and.push({
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { username: { contains: bare.toLowerCase() } },
        { bestContact: { contains: bare, mode: "insensitive" } },
      ],
    });
  }
  if (f.country) and.push({ countries: { array_contains: [f.country] } });
  if (f.vertical) and.push({ vertical: f.vertical as Prisma.ProspectWhereInput["vertical"] });
  if (f.tier) and.push({ tier: f.tier as Prisma.ProspectWhereInput["tier"] });
  if (f.competition) and.push({ competitiveState: f.competition });
  if (f.contact) and.push({ contactConfidence: f.contact as Prisma.ProspectWhereInput["contactConfidence"] });
  if (f.source) and.push({ sourceType: f.source });
  if (f.openness === "pub")
    and.push({
      OR: [
        { monetization: { path: ["sellsAds"], equals: true } },
        { monetization: { path: ["marketplaceListing"], string_contains: "http" } },
      ],
    });
  if (f.openness === "affiliation") and.push({ monetization: { path: ["pushesAffiliate"], equals: true } });
  if (f.openness === "vip") and.push({ monetization: { path: ["sellsVip"], equals: true } });
  return { AND: and };
}

export function prospectOrderBy(sort: ProspectSort): Prisma.ProspectOrderByWithRelationInput[] {
  const last = { id: "asc" } as const;
  switch (sort) {
    case "abonnes":
      return [{ subscribers: { sort: "desc", nulls: "last" } }, last];
    case "vues":
      return [{ medianViews: { sort: "desc", nulls: "last" } }, last];
    case "taux":
      return [{ viewRate: { sort: "desc", nulls: "last" } }, last];
    case "recent":
      return [{ statusChangedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, last];
    case "decouverte":
      return [{ discoveredAt: "desc" }, last];
    default:
      return [{ score: { sort: "desc", nulls: "last" } }, { cocitationCount: "desc" }, last];
  }
}
