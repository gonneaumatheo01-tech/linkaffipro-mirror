#!/usr/bin/env node
// Tests d'intégration : base PostgreSQL de test dans le conteneur Docker local `lap-pg` (voir CLAUDE.md),
// migrations appliquées, puis vitest sur apps/web/tests/integration avec DATABASE_URL de test.
import { spawnSync } from "node:child_process";

const TEST_DB = "linkaffipro_test";
const TEST_URL = `postgresql://postgres:lap@localhost:54329/${TEST_DB}`;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts });

function containerRunning(name) {
  const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "true";
}
function ensureContainer(name, args) {
  if (containerRunning(name)) return;
  const exists = spawnSync("docker", ["inspect", name], { encoding: "utf8" }).status === 0;
  const r = exists ? run("docker", ["start", name]) : run("docker", ["run", "-d", "--name", name, ...args]);
  if (r.status !== 0) {
    console.error(`Impossible de démarrer le conteneur ${name}.`);
    process.exit(1);
  }
}
ensureContainer("lap-pg", ["-e", "POSTGRES_PASSWORD=lap", "-e", "POSTGRES_DB=linkaffipro", "-p", "54329:5432", "postgres:17-alpine"]);
ensureContainer("lap-redis", ["-p", "63799:6379", "redis:7-alpine"]);

// Attendre Postgres puis créer la base de test si absente.
for (let i = 0; i < 30; i++) {
  const r = spawnSync("docker", ["exec", "lap-pg", "pg_isready", "-U", "postgres"], { encoding: "utf8" });
  if (r.status === 0) break;
  spawnSync("sleep", ["1"]);
}
spawnSync("docker", ["exec", "lap-pg", "psql", "-U", "postgres", "-tc", `SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'`], { encoding: "utf8" }).stdout?.includes("1") ||
  run("docker", ["exec", "lap-pg", "psql", "-U", "postgres", "-c", `CREATE DATABASE ${TEST_DB}`]);

const env = {
  ...process.env,
  DATABASE_URL: TEST_URL,
  REDIS_URL: "redis://localhost:63799",
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
  IP_HASH_SALT: "test-salt",
  APP_BASE_URL: "http://localhost:3000",
  TRACKING_HOST: "go.goolink.eu",
  NODE_ENV: "test",
};
if (run("pnpm", ["--filter", "@linkaffipro/db", "exec", "prisma", "migrate", "deploy"], { env }).status !== 0) process.exit(1);
const t = run("pnpm", ["--filter", "web", "exec", "vitest", "run", "--config", "vitest.integration.config.ts"], { env });
process.exit(t.status ?? 1);
