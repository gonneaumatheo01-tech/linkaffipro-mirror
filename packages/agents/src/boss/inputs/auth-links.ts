/**
 * Phase 34, chantier F — liens d'autorisation envoyés par Kevin pour ce qui exige un navigateur (connexion au site,
 * invitation, autorisation Meta / TikTok, page du site). Jeton aléatoire de 32 octets ; SEULE son empreinte SHA-256
 * est gardée (`Setting` `boss.authlink.<empreinte>`) ; usage unique (la ligne est effacée à l'ouverture), 15 minutes
 * (`AUTH_LINK_TTL_MS`). Adresse : `${APP_BASE_URL}/k/<jeton>` (route `apps/web/app/k/[token]/route.ts`).
 *
 * Le lien ne crée jamais de session : `login` mène à la page de connexion (e-mail pré-rempli), la sécurité du compte
 * reste au site ; `oauth_*` mène à la route de démarrage existante (qui exige déjà une session ADMIN) ; `page` mène à
 * une adresse INTERNE seulement.
 */
import { createHash, randomBytes } from "node:crypto";
import { agentEvent, nowOf } from "../../admin/journal";
import { AUTH_LINK_PATH, AUTH_LINK_TTL_MS, type BossInputsApi } from "../../site/contract";
import type { AgentsDeps } from "../../types";

export const AUTH_LINK_SETTING_PREFIX = "boss.authlink.";
export const AUTH_LINK_PURPOSES = ["login", "oauth_meta", "oauth_tiktok", "invite", "page"] as const;
export type AuthLinkPurpose = (typeof AUTH_LINK_PURPOSES)[number];
export type AuthLinkRequest = Parameters<BossInputsApi["createAuthLink"]>[1];

export type StoredAuthLink = {
  purpose: AuthLinkPurpose;
  userId: string | null;
  chatId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};

export type AuthLinkDeps = Pick<AgentsDeps, "prisma" | "now" | "logger"> & { appBaseUrl?: string | null };

/** Empreinte SHA-256 (hex) d'un jeton. */
export function authLinkHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Forme d'un jeton (32 octets en base64url : 43 caractères). */
export function isAuthLinkToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/**
 * Adresse interne sûre (« /settings/connectors »…) : commence par un seul « / », sans schéma, sans « \ », sans
 * caractère de contrôle, sans « // » ni « /\ » au début (adresses relatives au protocole). Pur.
 */
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 500) return false;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  try {
    const u = new URL(path, "https://interne.invalid");
    return u.origin === "https://interne.invalid";
  } catch {
    return false;
  }
}

/** Jeton d'invitation du site (`payload.inviteToken`, ou `payload.token`). */
function inviteTokenOf(p: Record<string, unknown>): string | null {
  const t = p.inviteToken ?? p.token;
  return typeof t === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(t) ? t : null;
}

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,24}$/;

/** Contrôle d'une demande de lien ; lève une erreur en français si elle n'est pas valable (pur). */
export function validateAuthLinkRequest(req: AuthLinkRequest): void {
  if (!(AUTH_LINK_PURPOSES as readonly string[]).includes(req.purpose)) throw new Error("Type de lien inconnu.");
  if (!req.chatId || !/^-?\d+$/.test(String(req.chatId))) throw new Error("Conversation inconnue.");
  const p = req.payload ?? {};
  if (req.purpose === "page" && !isSafeInternalPath(p.path)) throw new Error("Seule une page du site peut être ouverte par ce lien.");
  if (req.purpose === "invite" && !inviteTokenOf(p)) throw new Error("Invitation introuvable.");
  if (req.purpose === "login" && p.email !== undefined && p.email !== null && (typeof p.email !== "string" || !EMAIL_RE.test(p.email)))
    throw new Error("Adresse e-mail invalide.");
}

function baseUrlOf(deps: AuthLinkDeps): string {
  const base = deps.appBaseUrl ?? process.env.APP_BASE_URL ?? "https://app.linkaffipro.com";
  return base.replace(/\/+$/, "");
}

/** Efface les liens expirés (jamais ouverts) : la table des réglages ne grossit pas. Ne lève jamais. */
async function purgeExpired(deps: AuthLinkDeps, now: Date): Promise<void> {
  try {
    const rows = (await deps.prisma.setting.findMany({ where: { key: { startsWith: AUTH_LINK_SETTING_PREFIX } }, select: { key: true, value: true } })) as Array<{ key: string; value: unknown }>;
    const dead = rows.filter((r) => {
      const exp = (r.value as { expiresAt?: unknown } | null)?.expiresAt;
      return typeof exp !== "string" || new Date(exp).getTime() <= now.getTime();
    });
    if (dead.length) await deps.prisma.setting.deleteMany({ where: { key: { in: dead.map((r) => r.key) } } });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] purge des liens d'autorisation");
  }
}

/**
 * Crée un lien signé à usage unique (15 min). Le jeton n'est rendu qu'une fois (dans l'adresse) : jamais stocké en
 * clair, jamais journalisé (le journal garde le type et la conversation).
 */
export async function createAuthLink(deps: AuthLinkDeps, req: AuthLinkRequest): Promise<{ url: string; expiresAt: string }> {
  validateAuthLinkRequest(req);
  const now = nowOf(deps);
  await purgeExpired(deps, now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + AUTH_LINK_TTL_MS).toISOString();
  const value: StoredAuthLink = {
    purpose: req.purpose,
    userId: req.userId ?? null,
    chatId: String(req.chatId),
    payload: JSON.parse(JSON.stringify(req.payload ?? {})) as Record<string, unknown>,
    createdAt: now.toISOString(),
    expiresAt,
  };
  await deps.prisma.setting.create({ data: { key: `${AUTH_LINK_SETTING_PREFIX}${authLinkHash(token)}`, value: value as never } });
  await agentEvent(deps as AgentsDeps, "boss.authlink.created", { purpose: req.purpose, chatId: value.chatId });
  return { url: `${baseUrlOf(deps)}${AUTH_LINK_PATH}${token}`, expiresAt };
}

export type ConsumeAuthLinkResult = { ok: true; link: StoredAuthLink } | { ok: false; reason: "unknown" | "expired" };

/**
 * Ouverture d'un lien : la ligne est effacée AVANT toute redirection (usage unique, même si deux ouvertures arrivent
 * en même temps : une seule efface la ligne). Inconnu, déjà utilisé ou expiré → refus.
 */
export async function consumeAuthLink(deps: AuthLinkDeps, token: string): Promise<ConsumeAuthLinkResult> {
  if (!isAuthLinkToken(token)) return { ok: false, reason: "unknown" };
  const key = `${AUTH_LINK_SETTING_PREFIX}${authLinkHash(token)}`;
  const row = (await deps.prisma.setting.findUnique({ where: { key } })) as { value: unknown } | null;
  if (!row) return { ok: false, reason: "unknown" };
  const del = await deps.prisma.setting.deleteMany({ where: { key } });
  if (del.count !== 1) return { ok: false, reason: "unknown" };
  const link = row.value as StoredAuthLink;
  if (!link || typeof link !== "object" || typeof link.expiresAt !== "string") return { ok: false, reason: "unknown" };
  if (new Date(link.expiresAt).getTime() <= nowOf(deps).getTime()) return { ok: false, reason: "expired" };
  await agentEvent(deps as AgentsDeps, "boss.authlink.used", { purpose: link.purpose, chatId: link.chatId });
  return { ok: true, link };
}

export type AuthLinkTarget =
  | { kind: "redirect"; path: string }
  | { kind: "oauth"; platform: "META" | "TIKTOK"; startPath: string; chatId: string; userId: string | null };

/** Où mène un lien ouvert (pur). Une page externe n'est jamais une destination (repli : l'accueil du site). */
export function authLinkTarget(link: StoredAuthLink): AuthLinkTarget {
  const p = link.payload ?? {};
  switch (link.purpose) {
    case "login": {
      const email = typeof p.email === "string" && EMAIL_RE.test(p.email) ? p.email : null;
      const next = isSafeInternalPath(p.next) ? p.next : null;
      const qs = new URLSearchParams();
      if (email) qs.set("email", email);
      if (next) qs.set("callbackUrl", next);
      const s = qs.toString();
      return { kind: "redirect", path: s ? `/login?${s}` : "/login" };
    }
    case "invite": {
      const t = inviteTokenOf(p);
      return { kind: "redirect", path: t ? `/invite/${t}` : "/login" };
    }
    case "oauth_meta":
    case "oauth_tiktok": {
      const platform = link.purpose === "oauth_meta" ? "META" : "TIKTOK";
      return { kind: "oauth", platform, startPath: `/api/connectors/${platform.toLowerCase()}/start`, chatId: link.chatId, userId: link.userId };
    }
    case "page":
      return { kind: "redirect", path: isSafeInternalPath(p.path) ? p.path : "/" };
    default:
      return { kind: "redirect", path: "/" };
  }
}
