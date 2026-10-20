import { prisma } from "@linkaffipro/db";
async function main() {
  const rows = await prisma.aiConversationUsage.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { ok: true, error: true, model: true, attempt: true, createdAt: true },
  });
  for (const r of rows)
    console.log(r.createdAt.toISOString(), r.ok ? "OK " : "KO ", "essai", r.attempt, "|", (r.error ?? "").slice(0, 300));
  console.log(rows.length, "lignes");
}
main().then(() => process.exit(0));
