/**
 * Phase 31 — page Agents → Prospection : libellés français et lecture tolérante des colonnes JSON d'un prospect
 * (marques, monétisation, pays, signaux de faux, risques, détail de la note). Règles pures, sans Prisma ni `next/*`.
 * Rien ici ne contacte un canal : seuls des liens publics `https://t.me/<nom>` sont produits.
 */
import { DEFAULT_COUNTRIES_SCOPE, PROSPECTION_SETTINGS, type ScoreWeights } from "@linkaffipro/agents";
import { countryName, stringList } from "@/lib/agents/analyses";
import { fmtNum, fmtPct } from "@/lib/format";

export const PROSPECTION_PATH = "/agents/prospection";

export const PROSPECT_STATUSES = [
  "DISCOVERED",
  "ENRICHING",
  "UNREADABLE",
  "ENRICH_FAILED",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONTACTED",
  "RESPONDED",
  "NEGOTIATING",
  "SIGNED",
  "ACTIVE",
  "CHURNED",
  "SKIPPED",
  "BLACKLISTED",
] as const;
export type ProspectStatusKey = (typeof PROSPECT_STATUSES)[number];

export const TIERS = ["A", "B", "C", "D"] as const;
export const VERTICALS = ["SPORTS", "CASINO", "BOTH", "OTHER"] as const;
export const CONTACT_LEVELS = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export const COMPETITIVE_STATES = ["FREE", "ROTATING", "EXCLUSIVE", "OURS"] as const;
export const OPENNESS_KEYS = ["pub", "affiliation", "vip"] as const;
export type OpennessKey = (typeof OPENNESS_KEYS)[number];
export const SOURCE_TYPES = [
  "DIRECTORY",
  "WEB_SEARCH",
  "SOCIAL",
  "GRAPH_FORWARD",
  "GRAPH_MENTION",
  "FOLDER",
  "ANALYSTS",
  "MANUAL",
  "ACCOUNT_SEARCH",
] as const;

export const VERTICAL_LABELS: Record<string, string> = {
  SPORTS: "Paris sportifs",
  CASINO: "Casino",
  BOTH: "Casino et paris",
  OTHER: "Autre",
};

export const COMPETITION_LABELS: Record<string, string> = {
  FREE: "Libre (aucune marque)",
  ROTATING: "Plusieurs marques",
  EXCLUSIVE: "Une seule marque",
  OURS: "Déjà avec nous",
};

export const OPENNESS_LABELS: Record<OpennessKey, string> = {
  pub: "Vend de la pub",
  affiliation: "Pousse des marques",
  vip: "Vend un accès payant",
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  DIRECTORY: "Annuaire de canaux",
  WEB_SEARCH: "Recherche sur internet",
  SOCIAL: "Réseaux sociaux",
  GRAPH_FORWARD: "Repris par un autre canal",
  GRAPH_MENTION: "Cité par un autre canal",
  FOLDER: "Dossier de canaux",
  ANALYSTS: "Équipe Analystes",
  MANUAL: "Ajouté à la main",
  ACCOUNT_SEARCH: "Recherche par compte",
};

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  TELEGRAM_USERNAME: "Telegram",
  EMAIL: "Courriel",
  WEBSITE: "Site",
  BOT: "Bot de contact",
  SOCIAL: "Réseau social",
  MARKETPLACE: "Place de marché",
  LINKED_GROUP: "Groupe lié",
  OTHER: "Autre",
};

export const FAKE_FLAG_LABELS: Record<string, string> = {
  SUSPECT_FAKE_SUBS: "Abonnés probablement achetés (très peu de vues par abonné)",
  SUSPECT_VIEW_BOT: "Vues trop régulières (vues probablement achetées)",
  SUSPECT_BOT_CONTENT: "Contenu automatique",
  SUSPECT_NO_ENGAGEMENT: "Beaucoup de vues mais aucune réaction",
  GROWTH_SPIKE: "Hausse brutale d'abonnés",
};

export const RISK_FLAG_LABELS: Record<string, string> = {
  SCAM_FIXED_MATCHES: "Vend des « matchs truqués »",
  GUARANTEED_WINS: "Promet des gains garantis",
  PROMOTES_OUR_BRAND: "Pousse déjà une de nos marques",
  UNDERAGE_SIGNALS: "Signes d'un public mineur",
};

export const AUTHENTICITY_LABELS: Record<string, string> = {
  REAL: "Canal réel",
  SUSPECT_GENERIC: "Contenu générique",
  SUSPECT_BOT: "Probablement automatique",
  REPOST: "Ne fait que reprendre d'autres canaux",
};

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  tips_free: "Pronostics gratuits",
  vip_sales: "Vente d'accès payant",
  bonus_pushing: "Bonus et codes promo",
  streams_clips: "Vidéos et extraits de parties",
  news: "Actualités",
  mixed: "Mélange",
};

export const DEAL_TYPE_LABELS: Record<string, string> = {
  CPA: "Prime par joueur",
  REVSHARE: "Part du revenu",
  HYBRID: "Mixte",
};

/** Libellés des composantes de la note (`scoreBreakdown`). */
export const BREAKDOWN_LABELS: Record<keyof ScoreWeights | "penalties", string> = {
  audience: "Audience",
  engagement: "Réactions des lecteurs",
  fit: "Adéquation avec vos offres",
  openness: "Ouverture aux partenariats",
  competition: "Concurrence",
  reach: "Facilité à joindre",
  penalties: "Pénalités",
};

// ------------------------------------------------------------------------------------------------- lecture JSON

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pays d'un prospect (`countries` JSON) en codes ISO majuscules, dans l'ordre de probabilité. */
export function countryList(v: unknown): string[] {
  return stringList(v).map((c) => c.toUpperCase());
}

export type Monetization = {
  sellsVip: boolean;
  vipPrice: string | null;
  sellsAds: boolean;
  adPrice: string | null;
  pushesAffiliate: boolean;
  marketplaceListing: string | null;
};

export function monetizationOf(v: unknown): Monetization {
  const o = isObj(v) ? v : {};
  return {
    sellsVip: o.sellsVip === true,
    vipPrice: txt(o.vipPrice),
    sellsAds: o.sellsAds === true,
    adPrice: txt(o.adPrice),
    pushesAffiliate: o.pushesAffiliate === true,
    marketplaceListing: txt(o.marketplaceListing),
  };
}

/** Ouverture d'un canal : ce qui montre qu'il accepte déjà des partenaires. */
export function opennessOf(v: unknown): OpennessKey[] {
  const m = monetizationOf(v);
  const out: OpennessKey[] = [];
  if (m.sellsAds || m.marketplaceListing) out.push("pub");
  if (m.pushesAffiliate) out.push("affiliation");
  if (m.sellsVip) out.push("vip");
  return out;
}

export function opennessText(v: unknown): string {
  const m = monetizationOf(v);
  const parts: string[] = [];
  if (m.sellsAds || m.marketplaceListing) parts.push(m.adPrice ? `Vend de la pub (${m.adPrice})` : OPENNESS_LABELS.pub);
  if (m.pushesAffiliate) parts.push(OPENNESS_LABELS.affiliation);
  if (m.sellsVip) parts.push(m.vipPrice ? `Accès payant (${m.vipPrice})` : OPENNESS_LABELS.vip);
  return parts.length ? parts.join(" · ") : "—";
}

export type BrandView = {
  brand: string;
  country: string | null;
  links: number;
  promoCode: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  intensity: string | null;
};

const INTENSITY_ORDER: Record<string, number> = { HEAVY: 0, MEDIUM: 1, LIGHT: 2 };
export const INTENSITY_LABELS: Record<string, string> = { HEAVY: "Beaucoup", MEDIUM: "Régulièrement", LIGHT: "Un peu" };

/** Marques détectées (`brands` JSON), la plus poussée d'abord. */
export function brandList(v: unknown): BrandView[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((b) => ({
      brand: txt(b.brand) ?? "",
      country: txt(b.country),
      links: num(b.links) ?? 0,
      promoCode: txt(b.promoCode),
      firstSeenAt: txt(b.firstSeenAt),
      lastSeenAt: txt(b.lastSeenAt),
      intensity: txt(b.intensity),
    }))
    .filter((b) => b.brand)
    .sort((a, b) => (INTENSITY_ORDER[a.intensity ?? ""] ?? 3) - (INTENSITY_ORDER[b.intensity ?? ""] ?? 3) || b.links - a.links);
}

export function brandsText(v: unknown, max = 3): string {
  const list = brandList(v);
  if (!list.length) return "—";
  const names = list.slice(0, max).map((b) => b.brand);
  return list.length > max ? `${names.join(", ")} +${list.length - max}` : names.join(", ");
}

export function flagList(v: unknown): string[] {
  return stringList(v);
}

export type BreakdownBar = { key: keyof typeof BREAKDOWN_LABELS; label: string; value: number; max: number; ratio: number };

/** Détail de la note en barres : chaque composante sur son poids ; les pénalités sur leur plafond (négatif). */
export function breakdownBars(v: unknown, weights: ScoreWeights, penaltyMax = 18): BreakdownBar[] {
  if (!isObj(v)) return [];
  const keys = Object.keys(weights) as Array<keyof ScoreWeights>;
  const bars: BreakdownBar[] = keys.map((k) => {
    const value = num(v[k]) ?? 0;
    const max = weights[k] || 1;
    return { key: k, label: BREAKDOWN_LABELS[k], value, max: weights[k], ratio: Math.max(0, Math.min(1, value / max)) };
  });
  const pen = num(v.penalties) ?? 0;
  if (pen !== 0) bars.push({ key: "penalties", label: BREAKDOWN_LABELS.penalties, value: pen, max: -penaltyMax, ratio: Math.min(1, Math.abs(pen) / penaltyMax) });
  return bars;
}

/** Poids enregistrés (somme 100), sinon ceux par défaut. */
export function weightsOf(v: unknown): ScoreWeights {
  const d = PROSPECTION_SETTINGS.weights.value;
  if (!isObj(v)) return { ...d };
  const out = { ...d };
  for (const k of Object.keys(d) as Array<keyof ScoreWeights>) {
    const n = num(v[k]);
    if (n !== null && n >= 0) out[k] = n;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- affichage

/** Lien public du canal : seulement `https://t.me/...` (jamais une autre adresse). */
export function publicChannelUrl(p: { channelUrl: string; username?: string | null }): string | null {
  if (p.username && /^[a-z0-9_]{3,64}$/i.test(p.username)) return `https://t.me/${p.username}`;
  try {
    const u = new URL(p.channelUrl);
    return u.protocol === "https:" && (u.hostname === "t.me" || u.hostname === "telegram.me") ? u.toString() : null;
  } catch {
    return null;
  }
}

export function channelName(p: { title: string; username?: string | null; channelUrl: string }): string {
  if (p.title.trim()) return p.title.trim();
  if (p.username) return `@${p.username}`;
  return p.channelUrl.replace(/^https:\/\//, "");
}

export function marketText(p: { vertical: string; countries: unknown; language: string | null }): string {
  const countries = countryList(p.countries);
  const parts = [VERTICAL_LABELS[p.vertical] ?? p.vertical];
  if (countries.length) parts.push(countries.slice(0, 2).map(countryName).join(", ") + (countries.length > 2 ? "…" : ""));
  if (p.language) parts.push(languageName(p.language));
  return parts.join(" · ");
}

let languageNames: Intl.DisplayNames | null = null;
export function languageName(code: string): string {
  if (!/^[a-z]{2,3}$/i.test(code)) return code;
  try {
    languageNames ??= new Intl.DisplayNames(["fr"], { type: "language" });
    return languageNames.of(code.toLowerCase()) ?? code;
  } catch {
    return code;
  }
}

export function audienceText(p: { subscribers: number | null; medianViews: number | null; viewRate: number | null }): string {
  const parts: string[] = [];
  parts.push(p.subscribers != null ? `${fmtNum(p.subscribers)} abonnés` : "abonnés inconnus");
  if (p.medianViews != null) parts.push(`${fmtNum(p.medianViews)} vues par post`);
  if (p.viewRate != null) parts.push(`${fmtPct(p.viewRate, 0)} lus`);
  return parts.join(" · ");
}

/** Pays du périmètre en plus du périmètre par défaut (le client a élargi la recherche). */
export function extraScopeCountries(scope: readonly string[]): string[] {
  const base = new Set<string>(DEFAULT_COUNTRIES_SCOPE);
  return [...new Set(scope.map((c) => c.toUpperCase()))].filter((c) => /^[A-Z]{2}$/.test(c) && !base.has(c));
}

/** Identifiant sûr (cuid) reçu d'un formulaire ou de l'adresse. */
export function safeProspectId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[a-z0-9]{8,40}$/i.test(s) ? s : null;
}

export function prospectHref(id: string): string {
  return `${PROSPECTION_PATH}/${encodeURIComponent(id)}`;
}

/** Nombre de jours (arrondi) entre deux dates. */
export function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function daysText(n: number | null): string {
  if (n === null) return "—";
  if (n < 1) return "moins d'un jour";
  return `${fmtNum(n)} jour${n > 1 ? "s" : ""}`;
}
