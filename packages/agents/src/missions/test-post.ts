/**
 * « Produire un post de test » (CONTRAT phase 20, propriétaire : chantier A). Mission POST en simulation vers le
 * canal Test, format imposé ou tiré du mélange, persona facultative (sinon celle du premier plan Dating).
 */
import type { AgentsDeps, TeamKey } from "../types";
import type { CreateMissionResult } from "./lifecycle";

export async function createTestPostMission(
  _deps: AgentsDeps,
  _input: { teamKey: TeamKey; byUserId: string | null; format?: "video" | "photo" | "text"; personaId?: string | null },
): Promise<CreateMissionResult> {
  throw new Error("createTestPostMission : à écrire (chantier A)");
}
