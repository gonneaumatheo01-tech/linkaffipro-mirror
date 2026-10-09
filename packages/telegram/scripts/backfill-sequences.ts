// Crée les séquences de messages privés par défaut manquantes pour tous les canaux existants.
import { prisma } from "@linkaffipro/db";
import { backfillDefaultSequences } from "../src/sequences/ensure";

async function main() {
  const results = await backfillDefaultSequences();
  for (const r of results) console.log(`${r.title} : ${r.created.length ? r.created.join(", ") : "rien à créer"}`);
  if (results.length === 0) console.log("Aucun canal.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
