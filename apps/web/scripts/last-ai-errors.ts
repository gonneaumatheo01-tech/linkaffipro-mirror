import { prisma } from "@linkaffipro/db";

async function main() {
  const rows = await prisma.aiConversationUsage.findMany({
    where: { ok: false },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { error: true, model: true, attempt: true, purpose: true, createdAt: true },
  });
  for (const r of rows)
    console.log(
      r.createdAt.toISOString(),
      "essai",
      r.attempt,
      r.model,
      "|",
      (r.error ?? "").slice(0, 300),
    );
  console.log(rows.length, "lignes");
}

main().then(() => process.exit(0));
