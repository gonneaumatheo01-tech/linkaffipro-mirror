#!/usr/bin/env node
// Restauration d'une sauvegarde logique (.sql.gz) dans la base LOCALE de développement (conteneur Docker `lap-pg`),
// pour vérifier qu'une sauvegarde est exploitable. Ne touche jamais à la production.
// Usage : pnpm db:restore backups/linkaffipro-<date>.sql.gz [--db linkaffipro_restore]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dbIdx = args.indexOf("--db");
const db = dbIdx >= 0 ? args[dbIdx + 1] : "linkaffipro_restore";
if (!file || !existsSync(file)) {
  console.error("Usage : pnpm db:restore <fichier.sql.gz> [--db nom_de_base]");
  process.exit(1);
}
if (!/^[a-z0-9_]+$/.test(db) || db === "linkaffipro") {
  console.error("Nom de base refusé (lettres minuscules, chiffres, _ ; jamais la base de dev principale).");
  process.exit(1);
}
const run = (cmdArgs, input) => spawnSync("docker", ["exec", "-i", "lap-pg", ...cmdArgs], { input, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
const running = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", "lap-pg"], { encoding: "utf8" });
if (running.status !== 0 || running.stdout.trim() !== "true") {
  console.error("Le conteneur Docker lap-pg ne tourne pas (voir CLAUDE.md pour le recréer).");
  process.exit(1);
}
run(["psql", "-U", "postgres", "-q", "-c", `DROP DATABASE IF EXISTS ${db}`]);
const create = run(["psql", "-U", "postgres", "-q", "-c", `CREATE DATABASE ${db}`]);
if (create.status !== 0) {
  console.error(create.stderr.toString());
  process.exit(1);
}
const sql = spawnSync("gzip", ["-dc", file], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }).stdout;
const restore = run(["psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-d", db], sql);
if (restore.status !== 0) {
  console.error(restore.stderr.toString().split("\n").slice(-5).join("\n"));
  process.exit(1);
}
const count = run(["psql", "-U", "postgres", "-tA", "-d", db, "-c", `SELECT count(*) FROM "User"`]).stdout.toString().trim();
const tables = run(["psql", "-U", "postgres", "-tA", "-d", db, "-c", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).stdout.toString().trim();
console.log(`Restauré dans la base locale « ${db} » : ${tables} tables, ${count} utilisateur(s). Connexion : postgresql://postgres:lap@localhost:54329/${db}`);
