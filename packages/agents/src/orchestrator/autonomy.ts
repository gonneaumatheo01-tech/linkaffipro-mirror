/**
 * Niveaux d'autonomie (`AgentTeamConfig.autonomyLevel`), règle pure : 0 = tout passe en validation avant publication ;
 * 1 = seules les nouveautés (premier post d'un canal, nouvelle persona, nouveau thème, nouvelle catégorie, doute du
 * Contrôle qualité) ; 2 = rien (rapport seulement). Ce que le plan impose de toujours valider (`alwaysValidate`, phases
 * suivantes) l'est quel que soit le niveau.
 */
export type AutonomyFacts = {
  firstPostOfChannel?: boolean;
  newPersona?: boolean;
  newTheme?: boolean;
  newCategory?: boolean;
  controlDoubt?: boolean;
  /** Motif d'une validation imposée par le plan quel que soit le niveau. */
  alwaysValidate?: string | null;
};

export type AutonomyDecision = { validate: boolean; reason: string | null };

const NOVELTY_REASONS: Array<[keyof AutonomyFacts, string]> = [
  ["firstPostOfChannel", "premier post de ce canal"],
  ["newPersona", "nouvelle persona"],
  ["newTheme", "nouveau thème"],
  ["newCategory", "nouvelle catégorie"],
  ["controlDoubt", "doute du contrôle qualité"],
];

export function autonomyDecision(level: 0 | 1 | 2, facts: AutonomyFacts): AutonomyDecision {
  if (facts.alwaysValidate) return { validate: true, reason: facts.alwaysValidate };
  if (level === 0) {
    const novelty = NOVELTY_REASONS.filter(([k]) => facts[k]).map(([, r]) => r);
    return { validate: true, reason: novelty.length ? `je valide tout (${novelty.join(", ")})` : "je valide tout (niveau 0)" };
  }
  if (level === 1) {
    const novelty = NOVELTY_REASONS.filter(([k]) => facts[k]).map(([, r]) => r);
    return novelty.length ? { validate: true, reason: `nouveauté : ${novelty.join(", ")}` } : { validate: false, reason: null };
  }
  return { validate: false, reason: null };
}

/** Nombre de premières photos d'une persona toujours validées (phase 20). */
export const FIRST_PERSONA_MEDIA_VALIDATED = 3;

export type AlwaysValidateFacts = {
  teamKey: string;
  format: "video" | "photo" | "text" | undefined;
  personaName?: string | null;
  /** Missions photo déjà terminées de la persona. */
  personaPhotosDone: number;
  firstPostOfChannel: boolean;
  /** Doute ou défaut vu par le contrôle du média. */
  mediaDoubt?: string | null;
  /** Équipe Casino (phase 22) : thème jamais publié sur ce canal, offre (campagne) jamais utilisée, bouton Offre impossible. */
  theme?: string | null;
  newTheme?: boolean;
  newOffer?: boolean;
  offerName?: string | null;
  offerProblem?: string | null;
  /** Le canal visé est un canal casino (faux pour une mission de test ou un canal d'un autre univers). */
  casinoChannel?: boolean;
};

/** Validations imposées de l'équipe Casino : nouveau canal, nouveau thème, offre jamais utilisée, bouton Offre impossible. */
export function casinoAlwaysValidateReason(f: AlwaysValidateFacts): string | null {
  const reasons: string[] = [];
  if (f.offerProblem) reasons.push(f.offerProblem);
  if (f.casinoChannel === false) return reasons.length ? `toujours validé : ${reasons.join(", ")}` : null;
  if (f.firstPostOfChannel) reasons.push("nouveau canal");
  if (f.newTheme) reasons.push(`nouveau thème${f.theme ? ` (${f.theme})` : ""}`);
  if (f.newOffer) reasons.push(`offre jamais utilisée${f.offerName ? ` (${f.offerName})` : ""}`);
  return reasons.length ? `toujours validé : ${reasons.join(", ")}` : null;
}

/**
 * Validations imposées quel que soit le niveau (équipe Dating, phase 20) : les 3 premières photos d'une persona, le premier post d'un canal, et tout média dont le contrôle doute (règle pure).
 */
export function alwaysValidateReason(f: AlwaysValidateFacts): string | null {
  if (f.teamKey === "casino") return casinoAlwaysValidateReason(f);
  if (f.teamKey !== "dating") return null;
  const reasons: string[] = [];
  const who = f.personaName ? ` de ${f.personaName}` : "";
  if (f.mediaDoubt) reasons.push(`contrôle du média : ${f.mediaDoubt}`);
  if (f.format === "photo" && f.personaPhotosDone < FIRST_PERSONA_MEDIA_VALIDATED)
    reasons.push(`une des ${FIRST_PERSONA_MEDIA_VALIDATED} premières photos${who}`);
  if (f.firstPostOfChannel) reasons.push("nouveau canal");
  return reasons.length ? `toujours validé : ${reasons.join(", ")}` : null;
}

/** Faits de l'équipe Paris sportifs (phase 23) qui imposent la validation du client quel que soit le niveau. */
export type SportsValidateFacts = {
  newLeague: boolean;
  league?: string | null;
  newMarket: boolean;
  market?: string | null;
  /** Cote constatée hors de la fourchette de la catégorie. */
  oddsOutOfRange: boolean;
  /** Image de repli (capture impossible). */
  fallbackImage: boolean;
  fallbackReason?: string | null;
};

/** Toujours validés : ligue ou marché jamais utilisés, cote hors fourchette, image de repli (règle pure). */
export function sportsAlwaysValidateReason(f: SportsValidateFacts): string | null {
  const reasons: string[] = [];
  if (f.fallbackImage) reasons.push(`image de repli (capture impossible${f.fallbackReason ? ` : ${f.fallbackReason}` : ""})`);
  if (f.newLeague) reasons.push(`ligue jamais utilisée${f.league ? ` (${f.league})` : ""}`);
  if (f.newMarket) reasons.push(`marché jamais utilisé${f.market ? ` (${f.market})` : ""}`);
  if (f.oddsOutOfRange) reasons.push("cote hors de la fourchette de la catégorie");
  return reasons.length ? `toujours validé : ${reasons.join(", ")}` : null;
}
