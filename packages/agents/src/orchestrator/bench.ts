/**
 * Banc d'essai vidéo (CONTRAT phase 20, propriétaire : chantier A). Enfile le banc (tâche `agents-orchestrator`
 * `bench`) : 3 vidéos sources les moins récentes de la persona, chaque fournisseur disponible, résultats envoyés à
 * l'admin, puis une demande CHOICE. Rien sans clé : message clair.
 */
import type { AgentsDeps } from "../types";

export async function startBench(
  _deps: AgentsDeps,
  _input: { personaId: string; count?: number; byUserId?: string | null },
): Promise<{ ok: boolean; message: string }> {
  throw new Error("startBench : à écrire (chantier A)");
}
