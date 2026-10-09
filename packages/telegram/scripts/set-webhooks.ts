// (Re)pose les webhooks de tous les bots actifs à partir de APP_BASE_URL.
import { prisma } from "@linkaffipro/db";
import { setAllWebhooks } from "../src/service.js";

async function main() {
  console.log(`APP_BASE_URL = ${process.env.APP_BASE_URL}`);
  const results = await setAllWebhooks();
  for (const r of results) {
    console.log(`@${r.username} → ${r.url ?? "-"} ${r.error ? `ERREUR : ${r.error}` : "ok"}`);
    if (r.error) process.exitCode = 1;
  }
  if (results.length === 0) console.log("Aucun bot actif.");
}

main().finally(() => prisma.$disconnect());
