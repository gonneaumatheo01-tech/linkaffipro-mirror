/**
 * Dépendances des fonctions de `@linkaffipro/agents` appelées par le site : base, mise en file des agents, messager
 * du dialogue admin Telegram. Construites à la demande (une action serveur à la fois), jamais au chargement du module :
 * une page qui ne fait que lire n'ouvre aucune connexion Redis.
 */
import type { AgentsDeps, AgentsEnqueue } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAgentsEnqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "@linkaffipro/telegram";

export function buildAgentsDeps(): AgentsDeps {
  return {
    prisma,
    now: () => new Date(),
    // Copie structurelle de `AgentsEnqueue` dans `@linkaffipro/queue` (sans dépendance vers les agents).
    enqueue: createAgentsEnqueue() as unknown as AgentsEnqueue,
    admin: createAdminMessenger(),
  };
}
