/**
 * Personas autorisées sur un vrai compte Telegram (Réglages → Comptes) :
 * Rencontres et Paris sportifs. Seules les personas Casino parlent
 * exclusivement sous l'identité de l'équipe via un bot.
 */
export const ACCOUNT_PERSONA_UNIVERSES = ["dating", "sports"] as const;

/** Filtre Prisma des personas proposées pour un compte (tableau modifiable : Prisma refuse un `readonly`). */
export const accountPersonaWhere = { universe: { in: [...ACCOUNT_PERSONA_UNIVERSES] } };

export function isAccountPersonaAllowed(p: { universe: string | null | undefined } | null | undefined): boolean {
  return !!p && typeof p.universe === "string" && (ACCOUNT_PERSONA_UNIVERSES as readonly string[]).includes(p.universe);
}

export const ACCOUNT_PERSONA_REFUSED =
  "Un compte Telegram ne peut porter qu'une persona Rencontres ou Paris sportifs : les personas Casino parlent au nom de l'équipe.";
