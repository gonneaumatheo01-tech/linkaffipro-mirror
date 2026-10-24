/**
 * État admin / demandes SECRET lu sur une base donnée (même logique que `prismaTelegramDeps.agentsAdminState`, sans
 * cache) : sert aux tests des handlers des agents.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { readSecretRequestsState } from "../agents/admin-state";
import type { AgentsAdminState } from "../ports";

export async function prismaAgentsAdminState(prisma: PrismaClient, telegramUserId: bigint): Promise<AgentsAdminState> {
  const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  if (!s || s.value !== telegramUserId.toString()) return { isAdmin: false, secretPending: false };
  return readSecretRequestsState(prisma);
}
