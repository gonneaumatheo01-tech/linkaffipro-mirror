/**
 * Persona d'un vrai compte Telegram (Réglages → Comptes, phase 18) : seulement une persona Rencontres
 * (`Persona.universe = "dating"`). Les personas Casino et Paris sportifs parlent sous l'identité imposée de l'équipe
 * (phase 25), jamais depuis un compte personnel. Règle unique de la liste proposée et du refus côté serveur.
 */
export const ACCOUNT_PERSONA_UNIVERSE = "dating";

/** Filtre Prisma des personas proposées pour un compte. */
export const accountPersonaWhere = { universe: ACCOUNT_PERSONA_UNIVERSE } as const;

export function isAccountPersonaAllowed(p: { universe: string | null | undefined } | null | undefined): boolean {
  return !!p && p.universe === ACCOUNT_PERSONA_UNIVERSE;
}

export const ACCOUNT_PERSONA_REFUSED =
  "Un compte Telegram ne peut porter qu'une persona Rencontres : les personas Casino et Paris sportifs parlent au nom de l'équipe.";
