/**
 * `pnpm agents:bookmaker-runner` (alias : `pnpm agents:capture-runner`), phase 35 (phase 23 pour les captures) : tourne
 * sur le Mac du client, dont l'adresse n'est pas bloquée par les bookmakers. Demande au site (attente longue, 20 s) un
 * travail : capture de la phase 23, ou lecture d'un bookmaker (`fetch-api`, `page`, `record`, `visible`, `test`), le fait
 * avec Chromium (même code et même garde « jamais de mise » que le serveur) et rend le résultat. Rien n'est gardé sur le
 * Mac : identifiants et session arrivent du site et repartent (jamais écrits sur disque).
 * Installé comme service de session macOS par `pnpm agents:runner:install` (redémarre s'il tombe).
 * Options : `--once` (un passage puis sortie), `--visible` (fenêtre du navigateur affichée, 10 min au plus puis
 * sortie : le service habituel reprend sans fenêtre), `--url <site>`.
 * Jeton : `CAPTURE_RUNNER_TOKEN` (`.env.local`) ; absent, il est demandé au site par `railway ssh` puis rangé.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { chromiumExecutable } from "../src/capture/browser";
import { runnerPass, type RunnerIo } from "../src/bookmakers/runner-core";

const args = process.argv.slice(2);
const once = args.includes("--once");
const visible = args.includes("--visible");
const urlArg = args.indexOf("--url");
const BASE = (urlArg >= 0 ? args[urlArg + 1] : process.env.CAPTURE_RUNNER_URL) ?? "https://app.linkaffipro.com";
const ENDPOINT = `${BASE.replace(/\/$/, "")}/api/integrations/capture-runner`;
const ROOT = resolve(import.meta.dirname, "../../..");
const ENV_FILE = resolve(ROOT, ".env.local");
const RETRY_MS = 15_000;
/** `--visible` : 10 min au plus (le temps qu'un humain règle un captcha ou saisisse un code). */
const VISIBLE_MAX_MS = 10 * 60_000;

function log(msg: string): void {
  console.log(`[${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}] ${msg}`);
}

/** Jeton du runner : `.env.local`, sinon demandé au site par Railway (même mécanique que la phase 23). */
function runnerToken(): string {
  if (process.env.CAPTURE_RUNNER_TOKEN) return process.env.CAPTURE_RUNNER_TOKEN;
  if (existsSync(ENV_FILE)) {
    const m = /^CAPTURE_RUNNER_TOKEN=(\S+)$/m.exec(readFileSync(ENV_FILE, "utf8"));
    if (m) return m[1]!;
  }
  log("Première fois : je récupère la clé d'accès auprès du site (Railway)…");
  const out = execFileSync("railway", ["ssh", "--service", "web", "--", "pnpm", "--silent", "agents:capture-token"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const m = /CAPTURE_RUNNER_TOKEN=(\S+)/.exec(out);
  if (!m) throw new Error("clé d'accès introuvable dans la réponse de Railway (railway login ?)");
  appendFileSync(ENV_FILE, `\nCAPTURE_RUNNER_TOKEN=${m[1]}\n`);
  log("Clé d'accès rangée dans .env.local ✅");
  return m[1]!;
}

async function main(): Promise<void> {
  const tok = runnerToken();
  const io: RunnerIo = {
    visible,
    log,
    launch: ({ proxy, headless }) => chromium.launch({ headless: headless !== false, executablePath: chromiumExecutable(), ...(proxy ? { proxy } : {}) }),
    call: async <T,>(method: "GET" | "POST", query: string, body?: unknown): Promise<T> => {
      const res = await fetch(`${ENDPOINT}${query}`, {
        method,
        headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 401) throw new Error("clé d'accès refusée : supprime la ligne CAPTURE_RUNNER_TOKEN de .env.local et relance");
      if (!res.ok) throw new Error(`le site répond ${res.status}`);
      return (await res.json()) as T;
    },
  };
  log(`Lecture depuis ce Mac : en attente des demandes de ${BASE} (Ctrl+C pour arrêter)`);
  const visibleUntil = visible ? Date.now() + VISIBLE_MAX_MS : Infinity;
  for (;;) {
    if (Date.now() >= visibleUntil) {
      log("Navigateur visible : 10 minutes écoulées, je m'arrête (le service sans fenêtre reprend).");
      return;
    }
    const started = Date.now();
    try {
      const r = await runnerPass(io, { waitSec: once ? 0 : 20 });
      if (once) {
        if (r === "idle") log("Aucune demande en attente.");
        return;
      }
      // Ancien site sans attente longue : pas plus d'une demande toutes les 15 s quand il n'y a rien.
      if (r === "idle" && Date.now() - started < 2_000) await new Promise((res) => setTimeout(res, RETRY_MS));
    } catch (err) {
      log(`Problème : ${(err as Error).message}. Nouvel essai dans 15 s.`);
      if (once) {
        process.exitCode = 1;
        return;
      }
      await new Promise((res) => setTimeout(res, RETRY_MS));
    }
  }
}

await main();
