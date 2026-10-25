/**
 * Échanges avec `pnpm agents:capture-runner` (Mac du client, phase 23). La base de production n'est pas exposée sur
 * Internet : le Mac passe par le site (`/api/integrations/capture-runner`, jeton `Authorization: Bearer`).
 * - GET : prend la plus ancienne demande « mac » et renvoie de quoi la faire (demande, identifiants, session) ;
 * - POST : dépose le résultat (PNG en base64, cote lue ou erreur classée) et la session mise à jour.
 * Jeton : `Setting` `agents.secret.providers.captureRunner.token` (chiffré), créé par `pnpm agents:capture-token`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { encrypt } from "@linkaffipro/core";
import type { Db as PrismaClient } from "@linkaffipro/db";
import { readSecret, secretSettingKey } from "../../human/secrets";
import type { CaptureErrorKind, CaptureResult } from "../screenshot";
import type { BookmakerCredentials } from "./adapter";
import { claimNextCaptureRequest, claimableCaptureKinds, completeCaptureRequest, readCaptureRequest, type StoredCaptureRequest } from "./requests";
import { isStorageState, readBookmakerCredentials, readBookmakerSession, saveBookmakerSession, type BrowserStorageState } from "./session";
import { loadCaptureSettings } from "./settings";
import { claimReadJob, finishReadJob, macHeartbeatFresh, readMacHeartbeat, readReadJob, writeMacHeartbeat, type MacHeartbeat } from "../../bookmakers/jobs";
import { loadSiteAccess, readTransportCredentials, type SiteAccess } from "../../bookmakers/transport/env";
import { statusOfValue } from "../../bookmakers/transport/execute";

export const CAPTURE_RUNNER_TOKEN_KEY = "providers.captureRunner.token";

/** Crée (ou remplace) le jeton du Mac ; renvoyé une seule fois. */
export async function issueCaptureRunnerToken(prisma: PrismaClient, opts: { rotate?: boolean } = {}): Promise<string> {
  const existing = opts.rotate ? null : await readSecret(prisma, CAPTURE_RUNNER_TOKEN_KEY);
  if (existing) return existing;
  const token = `lapcr_${randomBytes(24).toString("base64url")}`;
  const key = secretSettingKey(CAPTURE_RUNNER_TOKEN_KEY);
  const value = { enc: encrypt(token), last4: token.slice(-4), updatedAt: new Date().toISOString() };
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return token;
}

export async function checkCaptureRunnerToken(prisma: PrismaClient, authorization: string | null): Promise<boolean> {
  const given = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!given) return false;
  const expected = await readSecret(prisma, CAPTURE_RUNNER_TOKEN_KEY);
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RunnerJob = {
  request: StoredCaptureRequest;
  credentials: BookmakerCredentials | null;
  session: BrowserStorageState | null;
  sites: Record<string, unknown>;
};

export async function runnerNext(prisma: PrismaClient, by = "mac"): Promise<RunnerJob | null> {
  const request = await claimNextCaptureRequest(prisma, "mac", by, new Date(), { kinds: await claimableCaptureKinds(prisma) });
  if (!request) return null;
  const [credentials, session, settings] = await Promise.all([
    readBookmakerCredentials(prisma, request.bookmaker),
    readBookmakerSession(prisma, request.bookmaker),
    loadCaptureSettings(prisma),
  ]);
  return { request, credentials, session, sites: settings.bookmakerSites };
}

const KINDS: readonly CaptureErrorKind[] = ["login_failed", "captcha", "two_factor", "geo_blocked", "not_found", "market_missing", "timeout", "forbidden_action", "unknown"];
const MAX_PNG_BYTES = 6 * 1024 * 1024;

export type RunnerResultBody = {
  id?: unknown;
  ok?: unknown;
  pngBase64?: unknown;
  readOdds?: unknown;
  pageUrl?: unknown;
  kind?: unknown;
  message?: unknown;
  session?: unknown;
};

/** Pur : corps reçu → résultat de capture validé (ou message d'erreur). */
export function parseRunnerResult(body: RunnerResultBody): { id: string; result: CaptureResult; session: BrowserStorageState | null } | { error: string } {
  if (typeof body.id !== "string" || !body.id) return { error: "id manquant" };
  const session = isStorageState(body.session) ? body.session : null;
  if (body.ok === true) {
    if (typeof body.pngBase64 !== "string") return { error: "image manquante" };
    const png = new Uint8Array(Buffer.from(body.pngBase64, "base64"));
    if (png.byteLength < 8 || png.byteLength > MAX_PNG_BYTES || png[0] !== 0x89 || png[1] !== 0x50) return { error: "image PNG invalide" };
    const readOdds = Number(body.readOdds);
    if (!Number.isFinite(readOdds) || readOdds < 0) return { error: "cote invalide" };
    return { id: body.id, session, result: { ok: true, png, readOdds, pageUrl: typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 500) : "" } };
  }
  const kind = KINDS.includes(body.kind as CaptureErrorKind) ? (body.kind as CaptureErrorKind) : "unknown";
  return { id: body.id, session, result: { ok: false, kind, message: typeof body.message === "string" ? body.message.slice(0, 300) : kind } };
}

export async function runnerResult(prisma: PrismaClient, body: RunnerResultBody): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseRunnerResult(body);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const s = await readCaptureRequest(prisma, parsed.id);
  if (!s || s.target !== "mac") return { ok: false, error: "demande inconnue" };
  if (parsed.session) await saveBookmakerSession(prisma, s.bookmaker, parsed.session);
  await completeCaptureRequest(prisma, parsed.id, parsed.result);
  return { ok: true };
}

// ---------- Phase 35 : travaux de lecture des bookmakers faits par le Mac (`BookmakerReadJob` target `mac`) ----------

/** Un travail de lecture remis au runner : le site, les identifiants (sauf appel d'API) et la session voyagent ici, jamais dans `params`. */
export type BookmakerRunnerJob = {
  id: string;
  siteKey: string;
  kind: string;
  params: Record<string, unknown>;
  site: SiteAccess;
  credentials: BookmakerCredentials | null;
  session: BrowserStorageState | null;
};

/** Sortes qu'un runner peut annoncer (le reste est orchestré par le worker). */
const RUNNER_KINDS = new Set(["fetch-api", "page", "record", "visible", "test", "capture", "learn", "events", "markets", "verify"]);

/**
 * Prend un travail de lecture « mac » parmi les sortes annoncées par le runner (battement écrit à chaque appel).
 * `waitMs` : attente longue côté site (au plus 25 s), un essai par seconde.
 */
export async function bookmakerRunnerNext(
  prisma: PrismaClient,
  o: { kinds: string[]; version?: string | null; visible?: boolean; waitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => Date },
): Promise<BookmakerRunnerJob | null> {
  const deps = { prisma, ...(o.now ? { now: o.now } : {}) };
  const kinds = o.kinds.filter((k) => RUNNER_KINDS.has(k));
  await writeMacHeartbeat(deps, { kinds, version: o.version ?? null, visible: o.visible ?? false });
  if (!kinds.length) return null;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + Math.min(Math.max(o.waitMs ?? 0, 0), 25_000);
  for (;;) {
    const job = await claimReadJob(deps, { target: "mac", kinds });
    if (job) {
      const site = await loadSiteAccess(deps, job.siteKey);
      if (!site) {
        await finishReadJob(deps, job.id, "FAILED", { obstacle: "unknown_site", message: "site inconnu ou sans adresse" });
        continue;
      }
      const [credentials, session] = await Promise.all([
        job.kind === "fetch-api" ? Promise.resolve(null) : readTransportCredentials(deps, job.siteKey),
        readBookmakerSession(prisma, job.siteKey),
      ]);
      return { id: job.id, siteKey: job.siteKey, kind: job.kind, params: (job.params ?? {}) as Record<string, unknown>, site, credentials, session };
    }
    if (Date.now() >= deadline) return null;
    await sleep(1_000);
  }
}

/** Résultat d'un travail de lecture (25 Mo au plus) ; la session rendue est rechiffrée. */
export const BOOKMAKER_RESULT_MAX_BYTES = 25_000_000;

export type BookmakerRunnerResultBody = { readJobId?: unknown; ok?: unknown; value?: unknown; message?: unknown; session?: unknown; durationMs?: unknown };

export async function bookmakerRunnerResult(prisma: PrismaClient, body: BookmakerRunnerResultBody): Promise<{ ok: boolean; error?: string }> {
  if (typeof body.readJobId !== "string" || !body.readJobId) return { ok: false, error: "readJobId manquant" };
  const deps = { prisma };
  const job = await readReadJob(deps, body.readJobId);
  if (!job || job.target !== "mac" || job.status !== "CLAIMED") return { ok: false, error: "travail inconnu ou déjà rendu" };
  if (isStorageState(body.session)) await saveBookmakerSession(prisma, job.siteKey, body.session);
  const durationMs = Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : null;
  if (body.ok !== true) {
    await finishReadJob(deps, job.id, "FAILED", { obstacle: "runner_error", message: typeof body.message === "string" ? body.message.slice(0, 300) : "erreur sur le Mac", durationMs, target: "mac" });
    return { ok: true };
  }
  const size = JSON.stringify(body.value ?? null).length;
  if (size > BOOKMAKER_RESULT_MAX_BYTES) {
    await finishReadJob(deps, job.id, "FAILED", { obstacle: "too_large", message: `résultat de ${Math.round(size / 1e6)} Mo`, target: "mac" });
    return { ok: false, error: "résultat trop gros" };
  }
  await finishReadJob(deps, job.id, statusOfValue(body.value), { value: body.value ?? null, durationMs, target: "mac" });
  return { ok: true };
}

/** État du Mac pour `pnpm agents:runner:status` (jeton requis). */
export async function bookmakerRunnerStatus(prisma: PrismaClient, now = new Date()): Promise<{ heartbeat: MacHeartbeat | null; alive: boolean }> {
  const heartbeat = await readMacHeartbeat({ prisma });
  return { heartbeat, alive: macHeartbeatFresh(heartbeat, now) };
}
