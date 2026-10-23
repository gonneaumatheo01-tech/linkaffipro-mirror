/**
 * Demandes au client par Telegram (CONTRAT, propriétaire : chantier B). Une seule question à la fois : la suivante
 * part quand la précédente est répondue ou passée. Les agents appellent `askHuman`.
 */
import type { AgentsDeps, TeamKey } from "../types";

export type AskHumanInput = {
  teamKey?: TeamKey | null;
  kind: "SECRET" | "TEXT" | "CHOICE" | "MEDIA" | "CONFIRM";
  /** Ce qui est demandé (`providers.fal.apiKey`, `agents.dailyReport`…). */
  key: string;
  /** 5 lignes au plus, français simple, dit exactement quoi répondre et comment passer (« plus tard »). */
  question: string;
  options?: string[];
  expected?: { count?: number; tags?: string[] };
  missionId?: string | null;
  /** Suite à donner : `{ action: "resume-mission" }`, `{ action: "verify-key", provider: "fal" }`… */
  onAnswer?: Record<string, unknown>;
};

/** Range la demande dans la file (QUEUED) et l'envoie tout de suite si aucune autre n'est en cours. Idempotent par `key` ouverte. */
export async function askHuman(
  _deps: AgentsDeps,
  _input: AskHumanInput,
): Promise<{ requestId: string; sent: boolean }> {
  throw new Error("askHuman : à écrire (chantier B)");
}
