import { prisma } from "@linkaffipro/db";
const J = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
async function main() {
  const keys = Object.keys(prisma).filter((k) => !k.startsWith("_") && !k.startsWith("$"));
  console.log("MODELES DISPONIBLES:", keys.join(", "));
  const s = await prisma.syncState.findUnique({ where: { source: "stats" } });
  console.log("CURSOR:", J(s?.cursor));
  console.log("LASTERROR:", s?.lastError, "| streak:", (s?.cursor as { errorStreak?: number } | null)?.errorStreak);
}
main().then(() => process.exit(0));
