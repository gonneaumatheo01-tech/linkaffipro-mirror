/**
 * Découpage et normalisation d'une requête de recherche globale (fonction pure).
 * - espaces multiples réduits, 80 caractères maximum, 6 mots maximum ;
 * - `@pseudo` reconnu comme pseudo Telegram ;
 * - une suite de 5 chiffres ou plus est aussi un identifiant Telegram possible.
 */
export type SearchQuery = {
  /** Texte nettoyé tel qu'il sera affiché. */
  raw: string;
  /** Mots en minuscules, sans `@` initial, vides retirés. */
  terms: string[];
  /** Pseudo recherché si la requête commence par `@`. */
  username: string | null;
  /** Identifiant Telegram si la requête est un grand nombre. */
  telegramUserId: bigint | null;
  /** Vrai quand la requête est trop courte pour lancer une recherche. */
  empty: boolean;
};

export const SEARCH_MAX_LENGTH = 80;
export const SEARCH_MAX_TERMS = 6;
export const SEARCH_MIN_LENGTH = 2;

export function parseSearchQuery(input: unknown): SearchQuery {
  const raw = String(input ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
  const username = /^@[A-Za-z0-9_]{2,}$/.test(raw) ? raw.slice(1).toLowerCase() : null;
  const telegramUserId = /^\d{5,19}$/.test(raw) ? BigInt(raw) : null;
  const terms = raw
    .toLowerCase()
    .split(" ")
    .map((t) => t.replace(/^@/, ""))
    .filter((t) => t.length > 0)
    .slice(0, SEARCH_MAX_TERMS);
  const empty = raw.length < SEARCH_MIN_LENGTH || terms.length === 0;
  return { raw, terms, username, telegramUserId, empty };
}

/** Groupes de résultats, dans l'ordre d'affichage. */
export const SEARCH_GROUPS = ["members", "posts", "channels", "campaigns", "automations"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export const SEARCH_GROUP_LABELS: Record<SearchGroup, string> = {
  members: "Membres",
  posts: "Messages",
  channels: "Canaux",
  campaigns: "Campagnes",
  automations: "Automatisations",
};

export type SearchHit = { id: string; title: string; subtitle?: string; href: string };
export type SearchResponse = {
  q: string;
  groups: Array<{ key: SearchGroup; label: string; hits: SearchHit[] }>;
};

/** Extrait court autour du premier mot trouvé (pour les messages). */
export function snippet(text: string, terms: string[], width = 70): string {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = plain.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return plain.slice(0, width) + (plain.length > width ? "…" : "");
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(plain.length, start + width);
  return (start > 0 ? "…" : "") + plain.slice(start, end) + (end < plain.length ? "…" : "");
}
