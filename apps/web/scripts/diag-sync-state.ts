import { prisma } from "@linkaffipro/db";
const J = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
async function main() {
  try {
    const s = await prisma.syncState.findUnique({ where: { source: "stats" } });
    console.log("SYNCSTATE:", J(s));
  } catch (e) {
    console.log("syncState KO:", String((e as Error).message).split("\n")[0]);
  }
}
main().then(() => process.exit(0));
