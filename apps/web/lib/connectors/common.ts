/**
 * Socle commun des connecteurs publicitaires côté site (Meta, TikTok) :
 * identifiants d'application chiffrés, état OAuth signé (anti-CSRF), stockage temporaire des jetons
 * entre le retour OAuth et le choix des comptes, enregistrement des connexions.
 * Aucun jeton n'est journalisé ni renvoyé au navigateur.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { decrypt, encrypt } from "@linkaffipro/core";
import { enqueue } from "@linkaffipro/queue";
import type { AppCredentials, ExternalAdAccount, TokenSet } from "@linkaffipro/connectors";
import { env } from "@/lib/env";

export type ConnectorPlatform = "META" | "TIKTOK";

export const PLATFORM_LABELS: Record<ConnectorPlatform, string> = { META: "Meta (Facebook / Instagram)", TIKTOK: "TikTok" };

/** Adresse de retour OAuth à déclarer chez la plateforme (valeur exacte affichée dans le guide). */
export function redirectUriFor(platform: ConnectorPlatform): string {
  return `${env.appBaseUrl}/api/connectors/${platform.toLowerCase()}/callback`;
}

// ---------- Identifiants d'application ----------

export async function loadAppCredentials(platform: ConnectorPlatform): Promise<AppCredentials | null> {
  const app = await prisma.connectorApp.findUnique({ where: { platform } });
  if (!app) return null;
  return { clientId: app.clientId, secret: decrypt(app.secretEncrypted), extra: (app.extra ?? {}) as Record<string, unknown> };
}

/** État affichable (jamais le secret) : identifiant d'app, options, dernière vérification, erreur. */
export async function loadAppState(platform: ConnectorPlatform) {
  const app = await prisma.connectorApp.findUnique({ where: { platform } });
  if (!app) return null;
  return { clientId: app.clientId, extra: (app.extra ?? {}) as Record<string, unknown>, verifiedAt: app.verifiedAt, lastError: app.lastError, updatedAt: app.updatedAt, hasSecret: app.secretEncrypted.length > 0 };
}

export async function saveAppCredentials(platform: ConnectorPlatform, input: { clientId: string; secret?: string | null; extra?: Record<string, unknown> }, userId: string): Promise<void> {
  const existing = await prisma.connectorApp.findUnique({ where: { platform } });
  const secretEncrypted = input.secret ? encrypt(input.secret) : existing?.secretEncrypted;
  if (!secretEncrypted) throw new Error("Le secret de l'application est obligatoire la première fois.");
  const extra = { ...((existing?.extra ?? {}) as Record<string, unknown>), ...(input.extra ?? {}) };
  await prisma.connectorApp.upsert({
    where: { platform },
    create: { platform, clientId: input.clientId.trim(), secretEncrypted, extra: toJsonValue(extra), updatedById: userId, verifiedAt: null, lastError: null },
    update: { clientId: input.clientId.trim(), secretEncrypted, extra: toJsonValue(extra), updatedById: userId, verifiedAt: null, lastError: null },
  });
  await audit({ userId, action: "connector.app_saved", entityType: "ConnectorApp", entityId: platform, metadata: { platform, clientId: input.clientId.trim(), secretChanged: Boolean(input.secret) } });
}

export async function markAppVerified(platform: ConnectorPlatform, result: { ok: true } | { ok: false; error: string }): Promise<void> {
  await prisma.connectorApp.update({ where: { platform }, data: result.ok ? { verifiedAt: new Date(), lastError: null } : { lastError: result.error } });
}

// ---------- État OAuth signé (anti-CSRF, 10 minutes) ----------

const STATE_TTL_MS = 10 * 60_000;

function stateKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET manquant");
  return createHmac("sha256", "lap-oauth-state").update(secret).digest();
}

export function createOAuthState(platform: ConnectorPlatform, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ p: platform, u: userId, t: now, n: randomBytes(8).toString("hex") })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string | null | undefined, now = Date.now()): { platform: ConnectorPlatform; userId: string } | null {
  if (!state) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: string; u?: string; t?: number };
    if ((data.p !== "META" && data.p !== "TIKTOK") || typeof data.u !== "string" || typeof data.t !== "number") return null;
    if (now - data.t > STATE_TTL_MS || data.t > now + 60_000) return null;
    return { platform: data.p, userId: data.u };
  } catch {
    return null;
  }
}

// ---------- Jetons en attente du choix des comptes (15 minutes) ----------

const PENDING_TTL_MS = 15 * 60_000;
export type PendingConnection = { tokens: TokenSet; accounts: ExternalAdAccount[]; createdAt: string };

function pendingKey(platform: ConnectorPlatform, userId: string): string {
  return `connectors.pending.${platform}.${userId}`;
}

export async function savePending(platform: ConnectorPlatform, userId: string, pending: { tokens: TokenSet; accounts: ExternalAdAccount[] }): Promise<void> {
  const value = {
    tokensEncrypted: encrypt(JSON.stringify({ ...pending.tokens, expiresAt: pending.tokens.expiresAt ? pending.tokens.expiresAt.toISOString() : null })),
    accounts: pending.accounts,
    createdAt: new Date().toISOString(),
  };
  const key = pendingKey(platform, userId);
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function loadPending(platform: ConnectorPlatform, userId: string): Promise<PendingConnection | null> {
  const row = await prisma.setting.findUnique({ where: { key: pendingKey(platform, userId) } });
  const v = row?.value as { tokensEncrypted?: string; accounts?: ExternalAdAccount[]; createdAt?: string } | null;
  if (!v?.tokensEncrypted || !v.createdAt) return null;
  if (Date.now() - new Date(v.createdAt).getTime() > PENDING_TTL_MS) {
    await clearPending(platform, userId);
    return null;
  }
  const raw = JSON.parse(decrypt(v.tokensEncrypted)) as TokenSet & { expiresAt: string | null };
  return { tokens: { ...raw, expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null }, accounts: v.accounts ?? [], createdAt: v.createdAt };
}

export async function clearPending(platform: ConnectorPlatform, userId: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: pendingKey(platform, userId) } });
}

// ---------- Connexions ----------

/** Enregistre (ou réactive) les comptes cochés avec les jetons, puis lance l'historique de 90 jours. */
export async function saveConnections(platform: ConnectorPlatform, userId: string, tokens: TokenSet, accounts: ExternalAdAccount[]): Promise<string[]> {
  const ids: string[] = [];
  for (const a of accounts) {
    const data = {
      name: a.name,
      currency: (a.currency || "EUR").toUpperCase(),
      timezone: a.timezone ?? null,
      businessName: a.businessName ?? null,
      status: "ACTIVE" as const,
      tokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes ?? null,
      connectedById: userId,
      lastError: null,
    };
    const row = await prisma.adAccountConnection.upsert({
      where: { platform_externalId: { platform, externalId: a.externalId } },
      create: { platform, externalId: a.externalId, ...data },
      update: data,
      select: { id: true, backfilledAt: true },
    });
    ids.push(row.id);
    await audit({ userId, action: "connector.account_connected", entityType: "AdAccountConnection", entityId: row.id, metadata: { platform, externalId: a.externalId, name: a.name } });
    await enqueue("sync-ads", { type: "connection", connectionId: row.id, mode: row.backfilledAt ? "recent" : "backfill" }, { jobId: `sync-ads-${row.id}-connect-${Date.now()}` }).catch(() => undefined);
  }
  return ids;
}

export async function disconnectConnection(connectionId: string, userId: string): Promise<void> {
  const conn = await prisma.adAccountConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error("Connexion introuvable.");
  // Le jeton est effacé ; les campagnes et coûts déjà importés restent (la connexion n'est pas supprimée, pour l'historique).
  await prisma.adAccountConnection.update({ where: { id: connectionId }, data: { status: "DISABLED", tokenEncrypted: "", refreshTokenEncrypted: null, tokenExpiresAt: null, lastError: null } });
  await audit({ userId, action: "connector.account_disconnected", entityType: "AdAccountConnection", entityId: connectionId, metadata: { platform: conn.platform, externalId: conn.externalId } });
}

export async function requestSyncNow(connectionId: string, userId: string, mode: "recent" | "full" = "recent"): Promise<void> {
  await enqueue("sync-ads", { type: "connection", connectionId, mode }, { jobId: `sync-ads-${connectionId}-manual-${Date.now()}` });
  await audit({ userId, action: "connector.sync_requested", entityType: "AdAccountConnection", entityId: connectionId, metadata: { mode } });
}
