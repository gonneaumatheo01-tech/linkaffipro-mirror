#!/usr/bin/env node
// Exécute tg-send / tg-inbox / tg-diag dans le conteneur Railway `web` (accès à la base de production sans
// exposer celle-ci ni stocker son mot de passe sur le Mac). Avec TG_LOCAL=1, exécute en local (.env.local).
import { spawnSync } from "node:child_process";

const [mode, ...rest] = process.argv.slice(2);
if (mode !== "send" && mode !== "inbox" && mode !== "diag") {
  console.error('Usage : pnpm tg:send "message" [--confirm <id>] | pnpm tg:inbox [--since <ISO>] | pnpm tg:diag');
  process.exit(2);
}
const SCRIPTS = {
  send: "packages/telegram/scripts/tg-send.ts",
  inbox: "packages/telegram/scripts/tg-inbox.ts",
  // Phase 26 : diagnostic du dialogue admin, lecture seule.
  diag: "packages/telegram/scripts/tg-diag.ts",
};
const script = SCRIPTS[mode];
const confirmIdx = rest.indexOf("--confirm");
const confirm = confirmIdx >= 0 ? rest[confirmIdx + 1] : undefined;
const sinceIdx = rest.indexOf("--since");
const since = sinceIdx >= 0 ? rest[sinceIdx + 1] : undefined;
const skip = new Set([confirmIdx, sinceIdx].filter((i) => i >= 0).flatMap((i) => [i, i + 1]));
const message = rest.filter((_a, i) => !skip.has(i)).join(" ");

const safe = (v) => /^[A-Za-z0-9:.+_-]*$/.test(v ?? "");
if (!safe(confirm) || !safe(since)) {
  console.error("Argument invalide.");
  process.exit(2);
}
const extra = [confirm ? `--confirm ${confirm}` : "", since ? `--since ${since}` : ""].filter(Boolean).join(" ");

if (process.env.TG_LOCAL === "1") {
  const env = { ...process.env, TG_MESSAGE_B64: Buffer.from(message, "utf8").toString("base64") };
  const r = spawnSync("node", ["--env-file-if-exists=.env.local", "--import", "tsx", script, ...extra.split(" ").filter(Boolean)], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

const b64 = Buffer.from(message, "utf8").toString("base64");
const remote = `cd /app && TG_MESSAGE_B64=${b64} ADMIN_TELEGRAM_USERNAME=${process.env.ADMIN_TELEGRAM_USERNAME ?? ""} pnpm exec tsx ${script} ${extra}`;
const r = spawnSync("railway", ["ssh", "--service", "web", "--", "sh", "-c", remote], { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
const out = (r.stdout ?? "").split("\n").filter((l) => !/^Using SSH key/.test(l)).join("\n").trim();
const err = (r.stderr ?? "").split("\n").filter((l) => !/^Using SSH key/.test(l) && l.trim()).join("\n").trim();
if (out) console.log(out);
if (err) console.error(err);
process.exit(r.status ?? 1);
