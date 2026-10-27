/**
 * Phase 31 — vue « Marques et repères » de la page Prospection : lecture des dictionnaires versionnés de l'équipe
 * (marques par pays, motifs de liens d'affiliation, raccourcisseurs, mots « code promo », étiquettes de contact) et
 * propositions d'ajout. Le site n'écrit JAMAIS les fichiers du dépôt : une proposition est rangée dans
 * `Setting prospection.dict_proposals` ; validée par un administrateur, elle rejoint `Setting prospection.dict_additions`
 * (lu par l'équipe en plus des fichiers). Jamais d'ajout silencieux. Règles pures.
 */

export const DICT_PROPOSALS_KEY = "prospection.dict_proposals";
export const DICT_ADDITIONS_KEY = "prospection.dict_additions";

export const DICT_KINDS = ["brand", "affiliate_param", "path_marker", "shortener", "promo_word", "contact_label"] as const;
export type DictKind = (typeof DICT_KINDS)[number];

export const DICT_KIND_LABELS: Record<DictKind, string> = {
  brand: "Marque (casino ou bookmaker)",
  affiliate_param: "Repère de lien d'affiliation (après « ? »)",
  path_marker: "Repère de lien d'affiliation (dans le chemin)",
  shortener: "Raccourcisseur de liens",
  promo_word: "Mot qui annonce un code promo",
  contact_label: "Mot qui annonce un contact",
};

export const BRAND_TYPES = [
  { value: "bookmaker", label: "Bookmaker" },
  { value: "casino", label: "Casino" },
  { value: "both", label: "Les deux" },
] as const;

export const BRAND_STATUSES = [
  { value: "local", label: "Licence du pays" },
  { value: "offshore", label: "Hors licence locale" },
] as const;

export type DictProposal = {
  id: string;
  kind: DictKind;
  value: string;
  /** Marque : pays (code ISO ou GLOBAL), type, statut. Mots : langue (fr, en…). */
  country: string | null;
  brandType: string | null;
  brandStatus: string | null;
  language: string | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  proposedBy: string | null;
  proposedVia: "WEB" | "TELEGRAM";
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

/** Ajouts validés, lus par l'équipe en plus des fichiers du dépôt. */
export type DictAdditions = {
  brands: Array<{ name: string; country: string; type: string; status: string }>;
  queryParams: string[];
  pathMarkers: string[];
  shorteners: string[];
  promoCodeLabels: Record<string, string[]>;
  contactLabels: Record<string, string[]>;
};

export const EMPTY_ADDITIONS: DictAdditions = { brands: [], queryParams: [], pathMarkers: [], shorteners: [], promoCodeLabels: {}, contactLabels: {} };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const langMap = (v: unknown): Record<string, string[]> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strings(x)]).filter(([, x]) => (x as string[]).length)) : {};

export function proposalsOf(v: unknown): DictProposal[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).flatMap((p) => {
    const kind = (DICT_KINDS as readonly string[]).includes(String(p.kind)) ? (p.kind as DictKind) : null;
    const id = s(p.id);
    const value = s(p.value);
    if (!kind || !id || !value) return [];
    const status = p.status === "APPROVED" || p.status === "REJECTED" ? p.status : "PENDING";
    return [
      {
        id,
        kind,
        value,
        country: s(p.country),
        brandType: s(p.brandType),
        brandStatus: s(p.brandStatus),
        language: s(p.language),
        note: s(p.note),
        status,
        proposedBy: s(p.proposedBy),
        proposedVia: p.proposedVia === "TELEGRAM" ? "TELEGRAM" : "WEB",
        proposedAt: s(p.proposedAt) ?? new Date(0).toISOString(),
        decidedBy: s(p.decidedBy),
        decidedAt: s(p.decidedAt),
      } satisfies DictProposal,
    ];
  });
}

export function additionsOf(v: unknown): DictAdditions {
  if (!isObj(v)) return { ...EMPTY_ADDITIONS, promoCodeLabels: {}, contactLabels: {} };
  return {
    brands: Array.isArray(v.brands)
      ? v.brands.filter(isObj).flatMap((b) => (s(b.name) ? [{ name: s(b.name)!, country: s(b.country) ?? "GLOBAL", type: s(b.type) ?? "both", status: s(b.status) ?? "local" }] : []))
      : [],
    queryParams: strings(v.queryParams),
    pathMarkers: strings(v.pathMarkers),
    shorteners: strings(v.shorteners),
    promoCodeLabels: langMap(v.promoCodeLabels),
    contactLabels: langMap(v.contactLabels),
  };
}

export type ProposalParse =
  | { ok: true; proposal: Omit<DictProposal, "id" | "status" | "proposedBy" | "proposedVia" | "proposedAt" | "decidedBy" | "decidedAt"> }
  | { ok: false; error: string; field: string };

const fstr = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Formulaire « Proposer un ajout » → proposition (non encore enregistrée). */
export function parseProposalForm(fd: FormData): ProposalParse {
  const kindRaw = fstr(fd, "kind");
  const kind = (DICT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as DictKind) : null;
  if (!kind) return { ok: false, error: "Choisissez ce que vous proposez d'ajouter.", field: "kind" };
  let value = fstr(fd, "value").replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Écrivez ce qu'il faut ajouter.", field: "value" };
  if (value.length > 80) return { ok: false, error: "80 caractères au plus.", field: "value" };
  if (kind === "shortener") {
    value = value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return { ok: false, error: "Un raccourcisseur s'écrit comme un nom de site (bit.ly).", field: "value" };
  }
  if (kind === "affiliate_param") {
    value = value.replace(/^[?&]/, "").replace(/=.*$/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,30}$/.test(value)) return { ok: false, error: "Un repère après « ? » s'écrit en lettres, chiffres ou _ (ref, aff_id).", field: "value" };
  }
  if (kind === "path_marker") {
    value = `/${value.replace(/^\/+|\/+$/g, "").toLowerCase()}/`;
    if (!/^\/[a-z0-9_-]{1,30}\/$/.test(value)) return { ok: false, error: "Un repère de chemin s'écrit comme /aff/.", field: "value" };
  }
  let country: string | null = null;
  let brandType: string | null = null;
  let brandStatus: string | null = null;
  let language: string | null = null;
  if (kind === "brand") {
    country = fstr(fd, "country").toUpperCase() || "GLOBAL";
    if (country !== "GLOBAL" && !/^[A-Z]{2}$/.test(country)) return { ok: false, error: "Pays : un code de deux lettres (FR) ou GLOBAL.", field: "country" };
    brandType = BRAND_TYPES.some((t) => t.value === fstr(fd, "brandType")) ? fstr(fd, "brandType") : "both";
    brandStatus = BRAND_STATUSES.some((t) => t.value === fstr(fd, "brandStatus")) ? fstr(fd, "brandStatus") : "local";
  }
  if (kind === "promo_word" || kind === "contact_label") {
    language = fstr(fd, "language").toLowerCase() || null;
    if (!language || !/^[a-z]{2}$/.test(language)) return { ok: false, error: "Langue : un code de deux lettres (fr, it, de…).", field: "language" };
    value = value.toLowerCase();
  }
  const note = fstr(fd, "note") || null;
  if (note && note.length > 300) return { ok: false, error: "La note fait 300 caractères au plus.", field: "note" };
  return { ok: true, proposal: { kind, value, country, brandType, brandStatus, language, note } };
}

/** Déjà présent (dictionnaire du dépôt, ajouts validés ou proposition en attente) ? Comparaison sans casse. */
export function alreadyKnown(
  p: { kind: DictKind; value: string; language?: string | null },
  known: { brands: string[]; queryParams: string[]; pathMarkers: string[]; shorteners: string[]; promoWords: string[]; contactLabels: string[] },
  pending: readonly DictProposal[],
): boolean {
  const v = p.value.toLowerCase();
  const list =
    p.kind === "brand"
      ? known.brands
      : p.kind === "affiliate_param"
        ? known.queryParams
        : p.kind === "path_marker"
          ? known.pathMarkers
          : p.kind === "shortener"
            ? known.shorteners
            : p.kind === "promo_word"
              ? known.promoWords
              : known.contactLabels;
  if (list.some((x) => x.toLowerCase() === v)) return true;
  return pending.some((x) => x.status === "PENDING" && x.kind === p.kind && x.value.toLowerCase() === v);
}

/** Ajoute une proposition validée aux ajouts (sans doublon). */
export function applyProposal(add: DictAdditions, p: DictProposal): DictAdditions {
  const next: DictAdditions = {
    brands: [...add.brands],
    queryParams: [...add.queryParams],
    pathMarkers: [...add.pathMarkers],
    shorteners: [...add.shorteners],
    promoCodeLabels: { ...add.promoCodeLabels },
    contactLabels: { ...add.contactLabels },
  };
  const push = (list: string[]) => (list.includes(p.value) ? list : [...list, p.value]);
  if (p.kind === "brand") {
    if (!next.brands.some((b) => b.name.toLowerCase() === p.value.toLowerCase()))
      next.brands.push({ name: p.value, country: p.country ?? "GLOBAL", type: p.brandType ?? "both", status: p.brandStatus ?? "local" });
  } else if (p.kind === "affiliate_param") next.queryParams = push(next.queryParams);
  else if (p.kind === "path_marker") next.pathMarkers = push(next.pathMarkers);
  else if (p.kind === "shortener") next.shorteners = push(next.shorteners);
  else if (p.kind === "promo_word") next.promoCodeLabels[p.language ?? "fr"] = push(next.promoCodeLabels[p.language ?? "fr"] ?? []);
  else next.contactLabels[p.language ?? "fr"] = push(next.contactLabels[p.language ?? "fr"] ?? []);
  return next;
}

export function proposalText(p: Pick<DictProposal, "kind" | "value" | "country" | "language">): string {
  const extra = p.kind === "brand" ? ` (${p.country ?? "GLOBAL"})` : p.language ? ` (${p.language})` : "";
  return `${DICT_KIND_LABELS[p.kind]} : « ${p.value} »${extra}`;
}

// ------------------------------------------------------------------------------------------------- dictionnaires

export type BrandEntry = { name: string; country: string; type: string; status: string; offshoreNonEu: boolean; added: boolean };

export type DictView = {
  brands: BrandEntry[];
  queryParams: string[];
  pathMarkers: string[];
  shorteners: string[];
  promoCodeLabels: Record<string, string[]>;
  contactLabels: Record<string, string[]>;
};

/** Dictionnaires du dépôt (forme des fichiers JSON de l'équipe) + ajouts validés, pour la lecture. */
export function dictView(raw: { brands?: unknown; patterns?: unknown; contactLabels?: unknown }, additions: DictAdditions): DictView {
  const brandsRaw = isObj(raw.brands) ? raw.brands.brands : raw.brands;
  const brands: BrandEntry[] = (Array.isArray(brandsRaw) ? brandsRaw : []).filter(isObj).flatMap((b) =>
    s(b.name)
      ? [{ name: s(b.name)!, country: s(b.country) ?? "GLOBAL", type: s(b.type) ?? "both", status: s(b.status) ?? "local", offshoreNonEu: b.offshoreNonEu === true, added: false }]
      : [],
  );
  for (const b of additions.brands)
    if (!brands.some((x) => x.name.toLowerCase() === b.name.toLowerCase())) brands.push({ ...b, offshoreNonEu: false, added: true });
  const pat = isObj(raw.patterns) ? raw.patterns : {};
  const labels = isObj(raw.contactLabels) ? (isObj(raw.contactLabels.labels) ? raw.contactLabels.labels : raw.contactLabels) : {};
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  const mergeLang = (a: Record<string, string[]>, b: Record<string, string[]>) => {
    const out: Record<string, string[]> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(out[k] ?? [], v);
    return out;
  };
  return {
    brands: brands.sort((a, b) => (a.country === b.country ? a.name.localeCompare(b.name, "fr") : a.country === "GLOBAL" ? 1 : b.country === "GLOBAL" ? -1 : a.country.localeCompare(b.country))),
    queryParams: merge(strings(pat.queryParams), additions.queryParams),
    pathMarkers: merge(strings(pat.pathMarkers), additions.pathMarkers),
    shorteners: merge(strings(pat.shorteners), additions.shorteners),
    promoCodeLabels: mergeLang(langMap(pat.promoCodeLabels), additions.promoCodeLabels),
    contactLabels: mergeLang(langMap(labels), additions.contactLabels),
  };
}

export function knownLists(v: DictView) {
  return {
    brands: v.brands.map((b) => b.name),
    queryParams: v.queryParams,
    pathMarkers: v.pathMarkers,
    shorteners: v.shorteners,
    promoWords: Object.values(v.promoCodeLabels).flat(),
    contactLabels: Object.values(v.contactLabels).flat(),
  };
}
