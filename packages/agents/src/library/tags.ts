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
    const p = personas.find((x) => normalizeText(x.name) === t);
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
