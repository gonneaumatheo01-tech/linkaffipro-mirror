/**
 * « Produire un post de test » (CONTRAT phase 20, propriétaire : chantier A). Mission POST en simulation vers le
 * canal Test, format imposé ou tiré du mélange par défaut, persona facultative (sinon celle du premier plan Dating,
 * sinon la première persona active).
 */
import type { AgentsDeps, TeamKey } from "../types";
import { createMission, type CreateMissionResult } from "./lifecycle";

export async function createTestPostMission(
  deps: AgentsDeps,
  input: { teamKey: TeamKey; byUserId: string | null; format?: "video" | "photo" | "text"; personaId?: string | null },
): Promise<CreateMissionResult> {
  const test = await deps.prisma.channel.findFirst({ where: { isTest: true, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!test) return { ok: false, reason: "Aucun canal Test : cochez « canal de test » sur un canal (page Canaux)." };
  let personaId = input.personaId ?? null;
  if (!personaId && input.teamKey === "dating") {
    const plan = await deps.prisma.channelAgentPlan.findFirst({
      where: { teamKey: "dating", personaId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { personaId: true },
    });
    personaId = plan?.personaId ?? null;
    if (!personaId)
      personaId = (await deps.prisma.persona.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
  }
  if (personaId && !(await deps.prisma.persona.findUnique({ where: { id: personaId }, select: { id: true } })))
    return { ok: false, reason: "Persona introuvable." };
  if (input.teamKey === "dating" && input.format && input.format !== "text" && !personaId)
    return { ok: false, reason: "Un post photo ou vidéo de test a besoin d'une persona (Conversations → Personas)." };
  return createMission(deps, {
    teamKey: input.teamKey,
    channelId: test.id,
    createdBy: "HUMAN",
    createdById: input.byUserId,
    isTest: true,
    ...(input.format ? { format: input.format } : {}),
    personaId,
  });
}
