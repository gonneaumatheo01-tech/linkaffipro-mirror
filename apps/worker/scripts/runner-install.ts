/**
 * Service macOS du runner des bookmakers (phase 35, chantier A) : le Mac du client lit tout seul, sans rien lancer.
 *   pnpm agents:runner:install [--dry-run]    écrit ~/Library/LaunchAgents/com.linkaffipro.bookmaker-runner.plist puis
 *                                             `launchctl bootstrap gui/<uid>` (démarre à l'ouverture de session,
 *                                             redémarre s'il tombe, journal logs/bookmaker-runner.log)
 *   pnpm agents:runner:uninstall [--dry-run]  `launchctl bootout` + suppression du fichier
 *   pnpm agents:runner:status                 service chargé ? dernier signe du Mac vu par le site < 2 min ?
 * Aucun secret dans le fichier du service : le runner lit `.env.local` lui-même au lancement (`--env-file-if-exists`).
 * Jeton absent de `.env.local` : demandé au site par `railway ssh … agents:capture-token` (même mécanique que la
 * phase 23) et rangé dans `.env.local` du Mac (jamais dans le dépôt). `--dry-run` affiche tout sans rien installer.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const RUNNER_LABEL = "com.linkaffipro.bookmaker-runner";
const ROOT = resolve(import.meta.dirname, "../../..");

export type PlistInput = { root: string; nodePath: string; logFile: string; pathEnv: string; label?: string };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Pur : contenu du fichier du service (aucune variable secrète : seulement PATH et le dossier du dépôt). */
export function buildPlist(i: PlistInput): string {
  const label = i.label ?? RUNNER_LABEL;
  const args = [i.nodePath, "--env-file-if-exists=.env.local", "--import", "tsx", "apps/worker/scripts/bookmaker-runner.ts"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(i.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(i.pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xml(i.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(i.logFile)}</string>
</dict>
</plist>
`;
}

export function plistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${RUNNER_LABEL}.plist`);
}

/** Pur : PATH du service (dossier de node, Homebrew, CLI Railway, système). */
export function servicePath(nodePath: string, home = homedir()): string {
  return [...new Set([dirname(nodePath), join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":");
}

export function hasRunnerToken(envFile: string): boolean {
  return !!process.env.CAPTURE_RUNNER_TOKEN || (existsSync(envFile) && /^CAPTURE_RUNNER_TOKEN=\S+$/m.test(readFileSync(envFile, "utf8")));
}

function say(msg: string): void {
  console.log(msg);
}

function launchctl(args: string[], dry: boolean): { ok: boolean; out: string } {
  if (dry) {
    say(`  (à blanc) launchctl ${args.join(" ")}`);
    return { ok: true, out: "" };
  }
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function uid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 501;
}

function ensureToken(envFile: string, dry: boolean): void {
  if (hasRunnerToken(envFile)) {
    say("Clé d'accès du runner : déjà rangée dans .env.local ✅");
    return;
  }
  if (dry) {
    say("Clé d'accès du runner : absente, elle serait demandée au site (railway ssh … agents:capture-token) et rangée dans .env.local.");
    return;
  }
  say("Clé d'accès du runner : je la demande au site (Railway)…");
  const ask = (env: NodeJS.ProcessEnv) =>
    execFileSync("railway", ["ssh", "--service", "web", "--", "pnpm", "--silent", "agents:capture-token"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env });
  let out: string;
  try {
    out = ask(process.env);
  } catch (err) {
    // Jeton Railway de `.env.local` refusé : nouvel essai avec la session du Mac (`railway login`), comme `env -u RAILWAY_API_TOKEN`.
    if (!process.env.RAILWAY_API_TOKEN) throw err;
    const { RAILWAY_API_TOKEN: _t, ...rest } = process.env;
    out = ask(rest);
  }
  const m = /CAPTURE_RUNNER_TOKEN=(\S+)/.exec(out);
  if (!m) throw new Error("clé d'accès introuvable dans la réponse de Railway (railway login ?)");
  appendFileSync(envFile, `\nCAPTURE_RUNNER_TOKEN=${m[1]}\n`);
  say("Clé d'accès rangée dans .env.local ✅");
}

/** Chromium de Playwright sur le Mac (installé une fois s'il manque). */
function ensureChromium(root: string, dry: boolean): void {
  let present = false;
  try {
    const out = execFileSync(process.execPath, ["-e", "const {chromium}=require('playwright-core');process.stdout.write(require('fs').existsSync(chromium.executablePath())?'1':'0')"], { cwd: join(root, "packages", "agents"), encoding: "utf8" });
    present = out.trim() === "1";
  } catch {
    present = false;
  }
  if (present) {
    say("Navigateur Chromium : présent ✅");
    return;
  }
  if (dry) {
    say("Navigateur Chromium : absent, il serait installé (pnpm --filter web exec playwright install chromium).");
    return;
  }
  say("Navigateur Chromium : installation…");
  execFileSync("pnpm", ["--filter", "web", "exec", "playwright", "install", "chromium"], { cwd: root, stdio: "inherit" });
}

export function install(o: { dry: boolean; home?: string; root?: string; nodePath?: string }): void {
  const root = o.root ?? ROOT;
  const home = o.home ?? homedir();
  const nodePath = o.nodePath ?? process.execPath;
  const logFile = join(root, "logs", "bookmaker-runner.log");
  const file = plistPath(home);
  const plist = buildPlist({ root, nodePath, logFile, pathEnv: servicePath(nodePath, home) });
  ensureToken(join(root, ".env.local"), o.dry);
  ensureChromium(root, o.dry);
  if (o.dry) {
    say(`Fichier du service (à blanc, rien n'est écrit) : ${file}\n`);
    say(plist);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(file, plist, { mode: 0o644 });
    say(`Fichier du service écrit : ${file}`);
  }
  const domain = `gui/${uid()}`;
  launchctl(["bootout", `${domain}/${RUNNER_LABEL}`], o.dry); // ancien service éventuel, erreur ignorée
  const r = launchctl(["bootstrap", domain, file], o.dry);
  if (!r.ok) throw new Error(`launchctl bootstrap a échoué : ${r.out.trim().slice(0, 300)}`);
  launchctl(["enable", `${domain}/${RUNNER_LABEL}`], o.dry);
  launchctl(["kickstart", "-k", `${domain}/${RUNNER_LABEL}`], o.dry);
  say(o.dry ? "À blanc : rien n'a été installé." : `Service installé et lancé ✅ (journal : ${logFile})`);
}

export function uninstall(o: { dry: boolean; home?: string }): void {
  const file = plistPath(o.home ?? homedir());
  launchctl(["bootout", `gui/${uid()}/${RUNNER_LABEL}`], o.dry);
  if (o.dry) say(`  (à blanc) suppression de ${file}`);
  else if (existsSync(file)) rmSync(file);
  say(o.dry ? "À blanc : rien n'a été retiré." : "Service retiré ✅");
}

async function status(): Promise<void> {
  const r = launchctl(["print", `gui/${uid()}/${RUNNER_LABEL}`], false);
  const loaded = r.ok;
  const running = loaded && /state = running/.test(r.out);
  say(`Service : ${loaded ? (running ? "chargé et en marche ✅" : "chargé, pas en marche en ce moment") : "pas installé ❌ (pnpm agents:runner:install)"}`);
  const envFile = join(ROOT, ".env.local");
  const tok = process.env.CAPTURE_RUNNER_TOKEN ?? (existsSync(envFile) ? /^CAPTURE_RUNNER_TOKEN=(\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : undefined);
  if (!tok) {
    say("Dernier signe du Mac : inconnu (pas de clé d'accès dans .env.local).");
    process.exitCode = loaded ? 0 : 1;
    return;
  }
  const base = (process.env.CAPTURE_RUNNER_URL ?? "https://app.linkaffipro.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/integrations/capture-runner?status=1`, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { alive?: boolean; heartbeat?: { at?: string } | null };
    const at = body.heartbeat?.at ? new Date(body.heartbeat.at) : null;
    say(`Dernier signe du Mac vu par le site : ${at ? `${at.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} ${body.alive ? "(il y a moins de 2 min ✅)" : "(il y a plus de 2 min ❌)"}` : "jamais"}`);
    process.exitCode = loaded && body.alive ? 0 : 1;
  } catch (err) {
    say(`Dernier signe du Mac : site injoignable (${(err as Error).message}).`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry-run") || process.argv.includes("--dry-run");
  if (process.platform !== "darwin" && !dry) throw new Error("ce service ne s'installe que sur un Mac");
  if (cmd === "install") install({ dry });
  else if (cmd === "uninstall") uninstall({ dry });
  else if (cmd === "status") await status();
  else {
    say("Usage : runner-install.ts install|uninstall|status [--dry-run]");
    process.exitCode = 2;
  }
}

// Lancé comme script (pas importé par un test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main().catch((err: Error) => {
    console.error(`Erreur : ${err.message}`);
    process.exitCode = 1;
  });
}
