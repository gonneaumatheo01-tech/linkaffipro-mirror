/**
 * État admin / demande SECRET lu sur une base donnée (même logique que `prismaTelegramDeps.agentsAdminState`, sans
 * cache) : sert aux tests des handlers des agents.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";

export async function prismaAgentsAdminState(
  prisma: PrismaClient,
  telegramUserId: bigint,
): Promise<{ isAdmin: boolean; secretPending: boolean }> {
  const s = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  if (!s || s.value !== telegramUserId.toString()) return { isAdmin: false, secretPending: false };
  const pending = await prisma.humanRequest.findFirst({ where: { status: "PENDING", kind: "SECRET" } });
  return { isAdmin: true, secretPending: !!pending };
}
