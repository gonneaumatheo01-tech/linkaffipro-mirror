/**
 * Univers d'une persona et identité permise (phase 25, CONTRAT ; propriétaire : chantier B). Sur un bot Casino ou
 * Paris sportifs, l'identité assistante est imposée : jamais « fille », jamais le mode illusion.
 */
export const PERSONA_UNIVERSES = ["dating", "casino", "sports"] as const;
export type PersonaUniverse = (typeof PERSONA_UNIVERSES)[number];

export function isPersonaUniverse(v: unknown): v is PersonaUniverse {
  return typeof v === "string" && (PERSONA_UNIVERSES as readonly string[]).includes(v);
}

/** Identités permises dans un univers (GIRL seulement pour Rencontres). */
export function allowedIdentities(universe: PersonaUniverse): readonly ("ASSISTANT" | "GIRL")[] {
  return universe === "dating" ? ["ASSISTANT", "GIRL"] : ["ASSISTANT"];
}

/** Fiche d'informations : 40 entrées au plus. */
export const PERSONA_FAQ_MAX = 40;
export type PersonaFaqEntry = { q: string; a: string };
