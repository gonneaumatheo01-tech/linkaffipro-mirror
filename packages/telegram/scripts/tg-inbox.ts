// Liste les messages privés reçus de l'administrateur (depuis Event), du plus ancien au plus récent.
// Usage : tsx tg-inbox.ts [--since <date ISO>]
import { prisma } from "@linkaffipro/db";
import { formatInboxLine, inboxMessageFromPayload } from "../src/admin-chat";

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf("--since");
  const since = si >= 0 && args[si + 1] ? new Date(args[si + 1]!) : new Date(Date.now() - 24 * 3600 * 1000);
  if (Number.isNaN(since.getTime())) throw new Error("Date --since invalide (format ISO attendu).");
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  if (!setting || typeof setting.value !== "string") throw new Error("Identifiant admin inconnu : lancez d'abord pnpm tg:send.");
  const adminId = BigInt(setting.value);
  const events = await prisma.event.findMany({
    where: { type: "telegram.message", occurredAt: { gte: since }, payload: { path: ["message", "chat", "type"], equals: "private" } },
    orderBy: { occurredAt: "asc" },
    take: 500,
  });
  const lines = events.map((e) => inboxMessageFromPayload(e.payload, adminId)).filter((m): m is NonNullable<typeof m> => m !== null);
  if (lines.length === 0) console.log(`(aucun message de l'admin depuis ${since.toISOString()})`);
  for (const m of lines) console.log(formatInboxLine(m));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
