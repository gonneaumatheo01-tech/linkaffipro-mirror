/**
 * Écriture des réglages de l'équipe Algorithme (`AgentTeamConfig.settings.algo`, phase 21), autres clés gardées,
 * avec son `AuditLog` (valeurs avant / après). ADMIN seulement (vérifié par l'action).
 */
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import { mergeAlgoSettings, parseAlgoSettings, type AlgoSettings } from "./settings";

export async function saveAlgoSettings(input: AlgoSettings, userId: string): Promise<void> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" }, select: { settings: true } });
  const before = parseAlgoSettings(row?.settings);
  const settings = mergeAlgoSettings(row?.settings, input) as Prisma.InputJsonValue;
  await prisma.agentTeamConfig.upsert({
    where: { teamKey: "algo" },
    create: { teamKey: "algo", settings, updatedById: userId },
    update: { settings, updatedById: userId },
  });
  await audit({
    userId,
    action: "agents.algo_settings_saved",
    entityType: "AgentTeamConfig",
    entityId: "algo",
    metadata: { before, after: input },
  });
}
