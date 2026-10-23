/**
 * Mise en file des agents (CONTRAT, propriétaire : chantier A). Implémentation BullMQ de `AgentsEnqueue`
 * (`@linkaffipro/agents`) pour le site et le bot ; le worker utilise la même.
 * Dans une file d'équipe, le nom de la tâche = clé de l'agent, `jobId` = `<missionId>:<index>` (idempotent).
 */
export type AgentsEnqueueImpl = {
  orchestrator(job: { type: string; [k: string]: unknown }, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
  step(
    teamKey: "dating" | "casino" | "sports" | "algo",
    agent: string,
    job: { type: "step"; missionId: string; index: number },
    opts?: { delayMs?: number },
  ): Promise<void>;
};

export function createAgentsEnqueue(): AgentsEnqueueImpl {
  throw new Error("createAgentsEnqueue : à écrire (chantier A)");
}
