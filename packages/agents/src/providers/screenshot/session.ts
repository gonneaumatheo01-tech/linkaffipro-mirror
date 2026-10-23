/**
 * Secrets de la capture (phase 23) : identifiants du compte bookmaker, session du navigateur, adresse IP
 * résidentielle. Tout est chiffré (`encrypt` de core) dans `Setting` `agents.secret.<clé>` ; la session n'est jamais
 * écrite en clair sur disque (Playwright la reçoit et la rend en mémoire, `storageState`).
 * Clés :
 * - `providers.bookmakers.<nom>.login` : identifiant seul, ou `{ login, password }` en JSON (commande « bookmaker … ») ;
 * - `providers.bookmakers.<nom>.password` : mot de passe (deuxième question du bot) ;
 * - `providers.bookmakers.<nom>.session` : cookies + stockage (écrit sans journal d'audit : il change à chaque capture) ;
 * - `providers.screenshotProxy` : `http://utilisateur:motdepasse@hote:port` (ou `socks5://…`).
 */
import { encrypt } from "@linkaffipro/core";
import type { Db as PrismaClient } from "@linkaffipro/db";
import { readSecret, secretSettingKey } from "../../human/secrets";
import type { BookmakerCredentials } from "./adapter";
import { bookmakerKey } from "./adapters";

export const SCREENSHOT_PROXY_SECRET_KEY = "providers.screenshotProxy";

export function bookmakerLoginKey(name: string): string {
  return `providers.bookmakers.${bookmakerKey(name)}.login`;
}
export function bookmakerPasswordKey(name: string): string {
  return `providers.bookmakers.${bookmakerKey(name)}.password`;
}
export function bookmakerSessionKey(name: string): string {
  return `providers.bookmakers.${bookmakerKey(name)}.session`;
}

/** Pur : identifiants depuis les deux valeurs rangées (JSON complet dans `.login`, ou deux clés séparées). */
export function credentialsFrom(loginValue: string | null, passwordValue: string | null): BookmakerCredentials | null {
  if (!loginValue) return null;
  try {
    const parsed = JSON.parse(loginValue) as { login?: unknown; password?: unknown };
    if (parsed && typeof parsed.login === "string" && typeof parsed.password === "string" && parsed.login && parsed.password)
      return { login: parsed.login, password: parsed.password };
  } catch {
    /* identifiant simple */
  }
  return passwordValue ? { login: loginValue.trim(), password: passwordValue } : null;
}

export async function readBookmakerCredentials(prisma: PrismaClient, name: string): Promise<BookmakerCredentials | null> {
  const [login, password] = await Promise.all([readSecret(prisma, bookmakerLoginKey(name)), readSecret(prisma, bookmakerPasswordKey(name))]);
  return credentialsFrom(login, password);
}

/** État du navigateur (format `storageState` de Playwright) : cookies et stockage local par origine. */
export type BrowserStorageState = {
  cookies: Array<Record<string, unknown>>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
};

export function isStorageState(v: unknown): v is BrowserStorageState {
  return !!v && typeof v === "object" && Array.isArray((v as BrowserStorageState).cookies) && Array.isArray((v as BrowserStorageState).origins);
}

export async function readBookmakerSession(prisma: PrismaClient, name: string): Promise<BrowserStorageState | null> {
  const raw = await readSecret(prisma, bookmakerSessionKey(name));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStorageState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Range la session chiffrée (même format que `saveSecret`, sans audit ni événement : écrite après chaque capture). */
export async function saveBookmakerSession(prisma: PrismaClient, name: string, state: BrowserStorageState, now = new Date()): Promise<void> {
  const key = secretSettingKey(bookmakerSessionKey(name));
  const value = { enc: encrypt(JSON.stringify(state)), last4: "····", updatedAt: now.toISOString() };
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function clearBookmakerSession(prisma: PrismaClient, name: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: secretSettingKey(bookmakerSessionKey(name)) } });
}

export async function bookmakerSessionUpdatedAt(prisma: PrismaClient, name: string): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: secretSettingKey(bookmakerSessionKey(name)) } });
  const at = (row?.value as { updatedAt?: unknown } | null)?.updatedAt;
  return typeof at === "string" && at ? new Date(at) : null;
}

export type ProxyConfig = { server: string; username?: string; password?: string };

/** Pur : adresse du proxy → réglage Playwright (identifiants séparés de l'adresse) ; null si invalide. */
export function parseProxyUrl(raw: string | null | undefined): ProxyConfig | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z0-9]+:\/\//i.test(v) ? v : `http://${v}`);
  } catch {
    return null;
  }
  if (!["http:", "https:", "socks5:"].includes(u.protocol) || !u.hostname || !u.port) return null;
  const out: ProxyConfig = { server: `${u.protocol}//${u.hostname}:${u.port}` };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}

export async function readScreenshotProxy(prisma: PrismaClient): Promise<ProxyConfig | null> {
  return parseProxyUrl(await readSecret(prisma, SCREENSHOT_PROXY_SECRET_KEY));
}
