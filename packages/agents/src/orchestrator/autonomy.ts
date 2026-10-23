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

/** Nombre de premières vidéos et de premières photos d'une persona toujours validées (phase 20). */
export const FIRST_PERSONA_MEDIA_VALIDATED = 3;

export type AlwaysValidateFacts = {
  teamKey: string;
  format: "video" | "photo" | "text" | undefined;
  personaName?: string | null;
  /** Missions déjà terminées de la persona, par format. */
  personaVideosDone: number;
  personaPhotosDone: number;
  firstPostOfChannel: boolean;
  /** Doute ou défaut vu par le contrôle du média. */
  mediaDoubt?: string | null;
};

/**
 * Validations imposées quel que soit le niveau (équipe Dating, phase 20) : les 3 premières vidéos et les 3 premières
 * photos d'une persona, le premier post d'un canal, et tout média dont le contrôle doute (règle pure).
 */
export function alwaysValidateReason(f: AlwaysValidateFacts): string | null {
  if (f.teamKey !== "dating") return null;
  const reasons: string[] = [];
  const who = f.personaName ? ` de ${f.personaName}` : "";
  if (f.mediaDoubt) reasons.push(`contrôle du média : ${f.mediaDoubt}`);
  if (f.format === "video" && f.personaVideosDone < FIRST_PERSONA_MEDIA_VALIDATED)
    reasons.push(`une des ${FIRST_PERSONA_MEDIA_VALIDATED} premières vidéos${who}`);
  if (f.format === "photo" && f.personaPhotosDone < FIRST_PERSONA_MEDIA_VALIDATED)
    reasons.push(`une des ${FIRST_PERSONA_MEDIA_VALIDATED} premières photos${who}`);
  if (f.firstPostOfChannel) reasons.push("nouveau canal");
  return reasons.length ? `toujours validé : ${reasons.join(", ")}` : null;
}
