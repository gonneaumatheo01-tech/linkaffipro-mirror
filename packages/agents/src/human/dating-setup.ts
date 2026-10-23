/**
 * Questions de mise en route de l'équipe Dating (CONTRAT phase 20, propriétaire : chantier B) : clé fal.ai, puis par
 * persona Dating active adresse du LoRA, mot déclencheur, photos de référence, vidéos sources, puis plafond vidéo,
 * puis confirmation du banc d'essai. Mises dans la file `HumanRequest` une seule fois (idempotent).
 */
import type { AgentsDeps } from "../types";

export async function ensureDatingSetupQuestions(_deps: AgentsDeps): Promise<{ queued: number }> {
  throw new Error("ensureDatingSetupQuestions : à écrire (chantier B)");
}
