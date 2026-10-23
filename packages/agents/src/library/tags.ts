/**
 * Mots-clés d'une légende de dépôt dans la médiathèque (PUR) : `#casino #roulette`, `#dating #source #lea`,
 * `#dating #reference #lea`, `#photo`. Équipe, nature, persona (prénom), thème, et tous les mots-clés normalisés.
 */
import type { TeamKey } from "../types";
import { normalizeText } from "../human/answer";

export type LibraryKind = "SOURCE" | "GENERATED" | "PHOTO" | "REFERENCE";

export type LibraryTags = {
  teamKey: TeamKey | null;
  kind: LibraryKind | null;
  theme: string | null;
  personaId: string | null;
  personaName: string | null;
  /** Mots-clés normalisés, sans « # », dans l'ordre. */
  tags: string[];
};

const TEAM_TAGS: Record<string, TeamKey> = {
  dating: "dating",
  rencontre: "dating",
  rencontres: "dating",
  casino: "casino",
  paris: "sports",
  sports: "sports",
  sport: "sports",
  parissportifs: "sports",
  paris_sportifs: "sports",
  algo: "algo",
};

const KIND_TAGS: Record<string, LibraryKind> = {
  source: "SOURCE",
  sources: "SOURCE",
  reference: "REFERENCE",
  ref: "REFERENCE",
  photo: "PHOTO",
  photos: "PHOTO",
  genere: "GENERATED",
  generee: "GENERATED",
  generated: "GENERATED",
};

/**
 * Mot-clé d'une persona dans une légende : son premier prénom, sans accents ni signes (« Léa Martin » → `lea`).
 * Utilisé par les questions de mise en route (phase 20) ; le nom complet attaché (`#leamartin`) est aussi reconnu.
 */
export function personaTagOf(name: string): string {
  const first = normalizeText(name).split(" ")[0] ?? "";
  return first.replace(/[^\p{L}\p{N}_-]/gu, "");
}

function personaMatchesTag(name: string, tag: string): boolean {
  const n = normalizeText(name);
  return n === tag || n.replace(/[^\p{L}\p{N}_-]/gu, "") === tag || personaTagOf(name) === tag;
}

/** Mots-clés `#…` d'un texte, normalisés (minuscules, sans accents). */
export function hashtagsOf(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const out: string[] = [];
  for (const m of caption.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    const t = normalizeText(m[1]!);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** La légende demande-t-elle un rangement en médiathèque (au moins un mot-clé d'équipe ou de nature) ? */
export function hasLibraryKeyword(caption: string | null | undefined): boolean {
  return hashtagsOf(caption).some((t) => t in TEAM_TAGS || t in KIND_TAGS);
}

/**
 * Classement d'une légende ; null sans mot-clé de médiathèque. `personas` : prénoms connus (`Persona.name`), comparés
 * sans accents ni majuscules ; le premier mot-clé restant devient le thème.
 */
export function parseLibraryCaption(
  caption: string | null | undefined,
  personas: { id: string; name: string }[] = [],
): LibraryTags | null {
  if (!hasLibraryKeyword(caption)) return null;
  const tags = hashtagsOf(caption);
  let teamKey: TeamKey | null = null;
  let kind: LibraryKind | null = null;
  let persona: { id: string; name: string } | null = null;
  let theme: string | null = null;
  for (const t of tags) {
    if (!teamKey && TEAM_TAGS[t]) {
      teamKey = TEAM_TAGS[t]!;
      continue;
    }
    if (!kind && KIND_TAGS[t]) {
      kind = KIND_TAGS[t]!;
      continue;
    }
    const p = personas.find((x) => normalizeText(x.name) === t) ?? personas.find((x) => personaMatchesTag(x.name, t));
    if (!persona && p) {
      persona = p;
      continue;
    }
    if (!theme && !(t in TEAM_TAGS) && !(t in KIND_TAGS)) theme = t;
  }
  return { teamKey, kind, theme, personaId: persona?.id ?? null, personaName: persona?.name ?? null, tags };
}

/** Nature par défaut selon le type de fichier (photo → PHOTO, vidéo → SOURCE). */
export function defaultKindFor(mimeType: string): LibraryKind {
  return mimeType.startsWith("image/") ? "PHOTO" : "SOURCE";
}

/** Une demande MEDIA attend-elle ces mots-clés ? Tous ses mots-clés doivent être présents. */
export function tagsMatchRequest(tags: string[], expected: string[] | undefined): boolean {
  const want = (expected ?? []).map((t) => normalizeText(t.replace(/^#/, ""))).filter(Boolean);
  if (want.length === 0) return false;
  return want.every((t) => tags.includes(t));
}

/**
 * Mots-clés libres d'une légende (ni équipe, ni nature) : les thèmes candidats d'un dépôt casino, dans l'ordre.
 * Les personas sont ignorées : l'équipe Casino n'en a pas.
 */
export function themeCandidatesOf(tags: string[]): string[] {
  return tags.filter((t) => !(t in TEAM_TAGS) && !(t in KIND_TAGS));
}

/**
 * Synonymes des thèmes casino, sur la forme compacte (sans tirets ni soulignés) : l'admin écrit comme il parle
 * (`#slots`, `#machinesasous`). Table volontairement courte ; les pluriels en « s » sont tolérés à part.
 */
export const CASINO_THEME_SYNONYMS: Record<string, string> = {
  slot: "machines-a-sous",
  slots: "machines-a-sous",
  machine: "machines-a-sous",
  machines: "machines-a-sous",
  machineasous: "machines-a-sous",
  machinesasous: "machines-a-sous",
  machinesous: "machines-a-sous",
  bj: "blackjack",
  livecasino: "live",
  casinolive: "live",
  direct: "live",
  endirect: "live",
  tournament: "tournoi",
  tournaments: "tournoi",
  tournois: "tournoi",
  vibe: "ambiance",
  vibes: "ambiance",
};

const compact = (s: string) => s.replace(/[-_]/g, "");

/** Clé de thème propre (ASCII, tirets) tirée d'un mot-clé normalisé : `machines_a_sous` → `machines-a-sous`. */
export function themeSlugOf(tag: string): string {
  return tag
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Thème connu correspondant à un mot-clé (forme compacte, puis pluriel en « s », puis synonymes), ou null.
 * `known` : clés des thèmes de l'équipe.
 */
export function matchCasinoTheme(tag: string, known: readonly string[]): string | null {
  const c = compact(tag);
  const byCompact = (x: string) => known.find((k) => compact(k) === x) ?? null;
  const direct = byCompact(c) ?? (c.endsWith("s") ? byCompact(c.slice(0, -1)) : null);
  if (direct) return direct;
  const syn = CASINO_THEME_SYNONYMS[c];
  return syn && known.includes(syn) ? syn : null;
}

/** Thèmes d'un dépôt casino : connus (dans l'ordre, sans doublon) et inconnus (clés proposées à la création). */
export function parseCasinoThemes(tags: string[], known: readonly string[]): { themes: string[]; unknown: string[] } {
  const themes: string[] = [];
  const unknown: string[] = [];
  for (const t of themeCandidatesOf(tags)) {
    const k = matchCasinoTheme(t, known);
    if (k) {
      if (!themes.includes(k)) themes.push(k);
      continue;
    }
    // Un synonyme d'un thème de départ retiré par l'équipe se propose sous sa clé canonique.
    const slug = CASINO_THEME_SYNONYMS[compact(t)] ?? themeSlugOf(t);
    if (slug && !unknown.includes(slug)) unknown.push(slug);
  }
  return { themes, unknown };
}
