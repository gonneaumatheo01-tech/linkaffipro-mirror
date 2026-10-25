/**
 * Phase 34, chantier F — repère de reprise d'une autorisation Meta / TikTok ouverte par un lien de Kevin : cookie
 * chiffré (AES-256-GCM, `APP_ENCRYPTION_KEY` : illisible et infalsifiable), httpOnly, 15 minutes, limité aux routes
 * des connecteurs. Il porte la conversation Telegram d'origine ; la route de démarrage OAuth n'est pas modifiée, et le
 * retour (callback) ne fait qu'y lire où écrire.
 */
import { decrypt, encrypt } from "@linkaffipro/core";
import { AUTH_LINK_TTL_MS } from "@linkaffipro/agents";

export const KEVIN_OAUTH_COOKIE = "lap_kevin_oauth";
export const KEVIN_OAUTH_COOKIE_PATH = "/api/connectors";

export type KevinOAuthResumeMark = {
  platform: "META" | "TIKTOK";
  chatId: string;
  /** Utilisateur du site lié au lien de Kevin (null : admin sans compte du site lié). */
  linkUserId: string | null;
  exp: number;
};

export function encodeResumeMark(mark: KevinOAuthResumeMark): string {
  return encrypt(JSON.stringify(mark));
}

/** Repère lisible et non expiré, sinon null (falsifié, ancienne clé, expiré). */
export function decodeResumeMark(value: string | null | undefined, now = Date.now()): KevinOAuthResumeMark | null {
  if (!value) return null;
  try {
    const m = JSON.parse(decrypt(value)) as Partial<KevinOAuthResumeMark>;
    if ((m.platform !== "META" && m.platform !== "TIKTOK") || typeof m.chatId !== "string" || !/^-?\d+$/.test(m.chatId)) return null;
    if (typeof m.exp !== "number" || m.exp <= now) return null;
    return { platform: m.platform, chatId: m.chatId, linkUserId: typeof m.linkUserId === "string" ? m.linkUserId : null, exp: m.exp };
  } catch {
    return null;
  }
}

export function newResumeMark(platform: "META" | "TIKTOK", chatId: string, linkUserId: string | null, now = Date.now()): KevinOAuthResumeMark {
  return { platform, chatId, linkUserId, exp: now + AUTH_LINK_TTL_MS };
}

/** Valeur d'un cookie dans l'en-tête `Cookie` d'une requête. */
export function cookieFromRequest(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const RESUME_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: KEVIN_OAUTH_COOKIE_PATH,
  maxAge: Math.floor(AUTH_LINK_TTL_MS / 1000),
};
