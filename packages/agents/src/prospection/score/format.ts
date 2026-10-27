/**
 * Phase 31, chantier C — mise en forme des chiffres et des libellés d'un prospect (pur). Sert au score (raison du
 * niveau), au Top du jour, aux rappels, au rapport de la semaine et aux fiches de Kevin.
 */
import type { CompetitiveState, ContactConfidence, FakeFlag, ProspectStatus, ProspectVertical, RiskFlag } from "../contract";

const NBSP = "\u00a0";

/** « 850 », « 2,1k », « 17k », « 1,2M » (vues, abonnés). */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "?";
  const a = Math.round(n);
  if (a < 1000) return String(a);
  if (a < 10_000) return `${(Math.round(a / 100) / 10).toString().replace(".", ",")}k`;
  if (a < 1_000_000) return `${Math.round(a / 1000)}k`;
  return `${(Math.round(a / 100_000) / 10).toString().replace(".", ",")}M`;
}

/** Pourcentage arrondi « 12 % » (espace insécable). */
export function formatPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "?";
  const v = ratio * 100;
  const s = digits > 0 ? v.toFixed(digits).replace(".", ",") : String(Math.round(v));
  return `${s}${NBSP}%`;
}

/** Montant en euros « 100 € », « 12,5 € ». */
export function formatEur(n: number): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${s}${NBSP}€`;
}

/** Drapeau d'un code pays ISO (« FR » → 🇫🇷), vide si le code est illisible. */
export function flagOf(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const cc = c === "UK" ? "GB" : c;
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Pays du périmètre en français, avec article (« l'Italie ») et sans (« Italie »). */
const COUNTRY_NAMES: Record<string, [string, string]> = {
  AT: ["Autriche", "l'Autriche"],
  BE: ["Belgique", "la Belgique"],
  BG: ["Bulgarie", "la Bulgarie"],
  HR: ["Croatie", "la Croatie"],
  CY: ["Chypre", "Chypre"],
  CZ: ["Tchéquie", "la Tchéquie"],
  DK: ["Danemark", "le Danemark"],
  EE: ["Estonie", "l'Estonie"],
  FI: ["Finlande", "la Finlande"],
  FR: ["France", "la France"],
  DE: ["Allemagne", "l'Allemagne"],
  GR: ["Grèce", "la Grèce"],
  HU: ["Hongrie", "la Hongrie"],
  IE: ["Irlande", "l'Irlande"],
  IT: ["Italie", "l'Italie"],
  LV: ["Lettonie", "la Lettonie"],
  LT: ["Lituanie", "la Lituanie"],
  LU: ["Luxembourg", "le Luxembourg"],
  MT: ["Malte", "Malte"],
  NL: ["Pays-Bas", "les Pays-Bas"],
  PL: ["Pologne", "la Pologne"],
  PT: ["Portugal", "le Portugal"],
  RO: ["Roumanie", "la Roumanie"],
  SK: ["Slovaquie", "la Slovaquie"],
  SI: ["Slovénie", "la Slovénie"],
  ES: ["Espagne", "l'Espagne"],
  SE: ["Suède", "la Suède"],
  GB: ["Royaume-Uni", "le Royaume-Uni"],
  CH: ["Suisse", "la Suisse"],
  NO: ["Norvège", "la Norvège"],
  IS: ["Islande", "l'Islande"],
};

export function countryName(code: string, withArticle = false): string {
  const c = code.toUpperCase();
  const n = COUNTRY_NAMES[c];
  return n ? n[withArticle ? 1 : 0] : c;
}

export const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const VERTICAL_LABELS: Record<ProspectVertical, string> = {
  SPORTS: "Paris sportifs",
  CASINO: "Casino",
  BOTH: "Paris et casino",
  OTHER: "Autre",
};

export const COMPETITION_LABELS: Record<CompetitiveState, string> = {
  FREE: "sans marque",
  ROTATING: "rotatif",
  EXCLUSIVE: "exclusif",
  OURS: "pousse déjà une de nos marques",
};

export const CONTACT_CONFIDENCE_LABELS: Record<ContactConfidence, string> = {
  HIGH: "sûr",
  MEDIUM: "probable",
  LOW: "à vérifier",
  NONE: "aucun",
};

export const FAKE_FLAG_LABELS: Record<FakeFlag, string> = {
  SUSPECT_FAKE_SUBS: "abonnés peut-être achetés",
  SUSPECT_VIEW_BOT: "vues trop régulières",
  SUSPECT_BOT_CONTENT: "posts tous pareils",
  SUSPECT_NO_ENGAGEMENT: "aucune réaction",
  GROWTH_SPIKE: "hausse brutale d'abonnés",
};

export const RISK_FLAG_LABELS: Record<RiskFlag, string> = {
  SCAM_FIXED_MATCHES: "vend des matchs truqués",
  GUARANTEED_WINS: "promet des gains garantis",
  PROMOTES_OUR_BRAND: "pousse déjà une de nos marques",
  UNDERAGE_SIGNALS: "public peut-être mineur",
};

/** Statuts en français (jamais le nom technique en surface). */
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  DISCOVERED: "trouvé, pas encore lu",
  ENRICHING: "en lecture",
  UNREADABLE: "illisible",
  ENRICH_FAILED: "lecture ratée",
  QUALIFIED: "à contacter",
  DISQUALIFIED: "écarté",
  CONTACTED: "contacté",
  RESPONDED: "a répondu",
  NEGOTIATING: "en négociation",
  SIGNED: "signé",
  ACTIVE: "actif",
  CHURNED: "arrêté",
  SKIPPED: "pas intéressé",
  BLACKLISTED: "à ne plus montrer",
};

/** Provenances en français (rapport de la semaine, fiche). */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  DIRECTORY: "les annuaires",
  WEB_SEARCH: "la recherche web",
  SOCIAL: "les réseaux sociaux",
  GRAPH_FORWARD: "les transferts entre canaux",
  GRAPH_MENTION: "les mentions entre canaux",
  FOLDER: "les dossiers de canaux",
  ANALYSTS: "la veille des Analystes",
  MANUAL: "tes ajouts",
  ACCOUNT_SEARCH: "la recherche par compte",
};

/** Nom affiché d'un prospect : « @nom », sinon son titre. */
export function handleOf(p: { username?: string | null; title?: string | null }): string {
  return p.username ? `@${p.username}` : (p.title || "canal sans nom").slice(0, 60);
}
