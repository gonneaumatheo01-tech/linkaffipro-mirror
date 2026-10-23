/**
 * `pnpm agents:capture-runner` (phase 23, parade anti-blocage n° 2) : tourne sur le Mac du client, dont l'adresse IP
 * n'est pas bloquée par le bookmaker. Toutes les 15 s, demande au site une capture en attente (mode « Mac » choisi
 * pour l'équipe Paris), la fait avec Chromium (même code que le worker, même garde « jamais de mise »), et dépose le
 * résultat. Aucune donnée n'est gardée sur le Mac : identifiants et session arrivent du site et repartent (la session
 * n'est jamais écrite sur disque).
 * Options : `--once` (une seule demande puis sortie), `--visible` (fenêtre du navigateur affichée), `--url <site>`.
 * Jeton : `CAPTURE_RUNNER_TOKEN` (`.env.local`) ; absent, il est demandé au site par `railway ssh` puis rangé.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { createBrowserScreenshotProvider, toCaptureRequest, type BrowserStorageState, type CaptureEnv, type CaptureResult, type RunnerJob } from "@linkaffipro/agents";
import { chromiumExecutable } from "../src/capture/browser";

const args = process.argv.slice(2);
const once = args.includes("--once");
const visible = args.includes("--visible");
const urlArg = args.indexOf("--url");
const BASE = (urlArg >= 0 ? args[urlArg + 1] : process.env.CAPTURE_RUNNER_URL) ?? "https://app.linkaffipro.com";
const ENDPOINT = `${BASE.replace(/\/$/, "")}/api/integrations/capture-runner`;
const ROOT = resolve(import.meta.dirname, "../../..");
const ENV_FILE = resolve(ROOT, ".env.local");
const POLL_MS = 15_000;

function log(msg: string): void {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
}

function token(): string {
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

async function call<T>(method: "GET" | "POST", tok: string, body?: unknown): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("clé d'accès refusée : supprime la ligne CAPTURE_RUNNER_TOKEN de .env.local et relance");
  if (!res.ok) throw new Error(`le site répond ${res.status}`);
  return (await res.json()) as T;
}

async function handle(job: RunnerJob, tok: string): Promise<void> {
  let saved: BrowserStorageState | null = null;
  const env: CaptureEnv = {
    credentials: async () => job.credentials,
    loadSession: async () => job.session,
    saveSession: async (_b, s) => {
      saved = s;
    },
    proxy: async () => null,
    sites: async () => job.sites,
  };
  const provider = createBrowserScreenshotProvider({
    env,
    launch: () => chromium.launch({ headless: !visible, executablePath: chromiumExecutable() }),
    name: "mac",
  });
  const r = job.request;
  log(`${r.kind === "test" ? "Test de connexion" : "Capture"} ${r.bookmaker}${r.request ? ` : ${r.request.homeTeam} – ${r.request.awayTeam}` : ""}`);
  let result: CaptureResult;
  if (r.kind === "test") result = await provider.testConnection(r.bookmaker);
  else {
    const req = toCaptureRequest(r);
    result = req ? await provider.capture(req) : { ok: false, kind: "unknown", message: "demande vide" };
  }
  await call("POST", tok, {
    id: r.id,
    ok: result.ok,
    ...(result.ok ? { pngBase64: Buffer.from(result.png).toString("base64"), readOdds: result.readOdds, pageUrl: result.pageUrl } : { kind: result.kind, message: result.message }),
    session: saved,
  });
  log(result.ok ? "Terminé ✅ (capture envoyée)" : `Échec : ${result.kind} (${result.message})`);
}

async function main(): Promise<void> {
  const tok = token();
  log(`Capture depuis ce Mac : en attente des demandes de ${BASE} (Ctrl+C pour arrêter)`);
  for (;;) {
    try {
      const { job } = await call<{ job: RunnerJob | null }>("GET", tok);
      if (job) {
        await handle(job, tok);
        if (once) return;
        continue;
      }
      if (once) {
        log("Aucune demande en attente.");
        return;
      }
    } catch (err) {
      log(`Problème : ${(err as Error).message}. Nouvel essai dans 15 s.`);
      if (once) process.exitCode = 1;
      if (once) return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

await main();
