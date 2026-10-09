import { prisma } from "@linkaffipro/db";

/** Vide les tables touchées par les tests (ordre : dépendances d'abord). Base de test uniquement. */
export async function resetDb(): Promise<void> {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("resetDb refuse de tourner hors de la base de test");
  await prisma.$transaction([
    prisma.postbackLog.deleteMany(),
    prisma.playerEvent.deleteMany(),
    prisma.player.deleteMany(),
    prisma.postbackEndpoint.deleteMany(),
    prisma.click.deleteMany(),
    prisma.trackingLink.deleteMany(),
    prisma.affiliateCampaign.deleteMany(),
    prisma.affiliateProgram.deleteMany(),
    prisma.event.deleteMany(),
    prisma.memberBotState.deleteMany(),
    prisma.member.deleteMany(),
    prisma.bot.deleteMany(),
  ]);
}

/** Attend la fin des rappels `after()` déclenchés par les routes (voir setup.ts). */
export async function flushAfter(): Promise<void> {
  const list = globalThis.__afterPromises ?? [];
  globalThis.__afterPromises = [];
  await Promise.all(list);
}

/** Contexte de route Next (params asynchrones). */
export function ctx<T extends Record<string, unknown>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
