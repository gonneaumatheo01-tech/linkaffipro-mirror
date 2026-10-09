#!/usr/bin/env node
// Sauvegarde de la base de production : pg_dump exécuté DANS le conteneur Postgres de Railway (pg_dump 18,
// même version que le serveur), compressé puis rapatrié en base64 par `railway ssh`. Aucun mot de passe sur le Mac.
// Usage : pnpm db:dump   → backups/linkaffipro-<date>.sql.gz
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(process.cwd(), "backups");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `linkaffipro-${stamp}.sql.gz`);

const remote = 'pg_dump --no-owner --no-privileges -U "$PGUSER" "$PGDATABASE" | gzip -9 | base64 -w0';
const r = spawnSync("railway", ["ssh", "--service", "Postgres", "--", "sh", "-c", remote], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
if (r.status !== 0) {
  console.error((r.stderr ?? "").split("\n").filter((l) => !/^Using SSH key/.test(l)).join("\n").trim() || "railway ssh a échoué");
  process.exit(r.status ?? 1);
}
const b64 = (r.stdout ?? "").split("\n").filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).join("");
if (!b64) {
  console.error("Aucune donnée reçue (vérifiez `railway ssh --service Postgres`).");
  process.exit(1);
}
writeFileSync(out, Buffer.from(b64, "base64"));
const size = statSync(out).size;
console.log(`Sauvegarde écrite : ${out} (${(size / 1024).toFixed(0)} Ko)`);
