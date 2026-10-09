#!/usr/bin/env node
// Tests d'intégration sur base PostgreSQL réelle : apps/web/tests/integration puis apps/worker/tests/integration.
//
// - En local : conteneurs Docker `lap-pg` (port 54329) et `lap-redis` (63799) démarrés ou réutilisés (voir CLAUDE.md),
//   base `linkaffipro_test` créée si absente.
// - Sans Docker (`--no-docker` ou CI=true, GitHub Actions) : la base vient de DATABASE_URL (ou TEST_DATABASE_URL) et
//   doit déjà exister (service Postgres de la CI avec POSTGRES_DB=linkaffipro_test) ; Redis vient de REDIS_URL.
// Dans les deux cas : garde-fou sur le nom de base (doit contenir « linkaffipro_test »), migrations appliquées, puis vitest.
//
// Options : `--only=web` ou `--only=worker` pour ne lancer qu'un paquet.
import { spawnSync } from "node:child_process";

const TEST_DB = "linkaffipro_test";
const args = process.argv.slice(2);
const noDocker = args.includes("--no-docker") || process.env.CI === "true";
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts });

let databaseUrl;
let redisUrl;

if (noDocker) {
  databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  if (!databaseUrl.includes(TEST_DB)) {
    console.error(`Mode sans Docker : DATABASE_URL (ou TEST_DATABASE_URL) doit viser une base dont le nom contient « ${TEST_DB} ».`);
    process.exit(1);
  }
} else {
  databaseUrl = `postgresql://postgres:lap@localhost:54329/${TEST_DB}`;
  redisUrl = "redis://localhost:63799";

  const containerRunning = (name) => {
    const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() === "true";
  };
  const ensureContainer = (name, dockerArgs) => {
    if (containerRunning(name)) return;
    const exists = spawnSync("docker", ["inspect", name], { encoding: "utf8" }).status === 0;
    const r = exists ? run("docker", ["start", name]) : run("docker", ["run", "-d", "--name", name, ...dockerArgs]);
    if (r.status !== 0) {
      console.error(`Impossible de démarrer le conteneur ${name}.`);
      process.exit(1);
    }
  };
  ensureContainer("lap-pg", ["-e", "POSTGRES_PASSWORD=lap", "-e", "POSTGRES_DB=linkaffipro", "-p", "54329:5432", "postgres:17-alpine"]);
  ensureContainer("lap-redis", ["-p", "63799:6379", "redis:7-alpine"]);

  // Attendre Postgres puis créer la base de test si absente.
  for (let i = 0; i < 30; i++) {
    const r = spawnSync("docker", ["exec", "lap-pg", "pg_isready", "-U", "postgres"], { encoding: "utf8" });
    if (r.status === 0) break;
    spawnSync("sleep", ["1"]);
  }
  const exists = spawnSync("docker", ["exec", "lap-pg", "psql", "-U", "postgres", "-tc", `SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'`], { encoding: "utf8" }).stdout?.includes("1");
  if (!exists) run("docker", ["exec", "lap-pg", "psql", "-U", "postgres", "-c", `CREATE DATABASE ${TEST_DB}`]);
}

// Environnement des tests : jamais les clés Link Affi réelles (le test de synchro lance sa propre API simulée).
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("LINKAFFI_")) delete env[k];
Object.assign(env, {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
  IP_HASH_SALT: "test-salt",
  APP_BASE_URL: "http://localhost:3000",
  TRACKING_HOST: "go.goolink.eu",
  TRACKING_BASE_URL: "https://go.goolink.eu",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
});

if (run("pnpm", ["--filter", "@linkaffipro/db", "exec", "prisma", "migrate", "deploy"], { env }).status !== 0) process.exit(1);

const suites = [
  { name: "web", filter: "web" },
  { name: "worker", filter: "worker" },
].filter((s) => !only || s.name === only);
if (suites.length === 0) {
  console.error(`Option --only inconnue : ${only} (attendu : web ou worker).`);
  process.exit(1);
}

let failed = false;
for (const s of suites) {
  console.log(`\n=== Tests d'intégration : ${s.name} ===`);
  const t = run("pnpm", ["--filter", s.filter, "exec", "vitest", "run", "--config", "vitest.integration.config.ts"], { env });
  if (t.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
