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
