// Vérifie l'accès à l'API Link Affi : liste des tables et nombre de lignes des tables utiles. Sans secrets.
import { LINKAFFI_ALLOWED_TABLES, LinkAffiClient, LinkAffiError } from "../src/index";

async function main() {
  const client = new LinkAffiClient();
  const tables = await client.listTables();
  console.log(`Tables exposées (${tables.length}) : ${tables.join(", ")}`);
  console.log("\nTables utiles :");
  for (const t of LINKAFFI_ALLOWED_TABLES) {
    if (!tables.includes(t)) {
      console.log(`  ${t.padEnd(24)} absente`);
      continue;
    }
    try {
      const n = await client.count(t);
      console.log(`  ${t.padEnd(24)} ${n} lignes`);
    } catch (err) {
      console.log(`  ${t.padEnd(24)} erreur : ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof LinkAffiError ? `Link Affi : ${err.message}` : err);
  process.exit(1);
});
