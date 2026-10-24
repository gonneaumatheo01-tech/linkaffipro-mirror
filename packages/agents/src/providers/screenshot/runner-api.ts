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
