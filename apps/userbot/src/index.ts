import { prisma } from "@linkaffipro/db";
import { logger } from "./logger";
import { startAccount, type LiveAccount } from "./client";

const live: LiveAccount[] = [];
let stopping = false;

async function main() {
  logger.info("programme userbot demarre");
  const accounts = await prisma.telegramUserAccount.findMany({
    where: { isActive: true, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) {
    logger.warn("aucun compte actif : connecte un compte depuis /settings/accounts puis relance");
  }
  for (const account of accounts) {
    try {
      live.push(
        await startAccount({
          id: account.id,
          label: account.label,
          phone: account.phone,
          botId: account.botId,
          personaId: account.personaId,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ compte: account.label, err: message }, "connexion impossible");
      await prisma.telegramUserAccount
        .update({
          where: { id: account.id },
          data: { status: "ERROR", lastError: message.slice(0, 500) },
        })
        .catch(() => undefined);
    }
  }
  logger.info({ connectes: live.length }, "comptes connectes");
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "arret en cours");
  const timer = setTimeout(() => process.exit(1), 15_000);
  try {
    await Promise.all(live.map((a) => a.stop()));
    await prisma.$disconnect();
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ reason }, "promesse non geree"));

void main().catch((err: Error) => {
  logger.error({ err: err.message }, "demarrage impossible");
});
