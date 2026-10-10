/**
 * Réglage partagé site/worker : identifiants de l'application Telegram (my.telegram.org).
 * Stocké dans `Setting` clé `telegram.userApi` = { apiId, apiHashEncrypted } ; le hash est chiffré par l'appelant
 * (`encrypt` de @linkaffipro/core) : ce paquet ne connaît pas la clé de chiffrement.
 */
export const TELEGRAM_USER_API_SETTING = "telegram.userApi";
/** Identifiant unique de la ligne `TelegramUserSession` (un seul compte connecté). */
export const TELEGRAM_SESSION_ID = "main";

export type TelegramUserApiSetting = { apiId: number; apiHashEncrypted: string };

export const TELEGRAM_SESSION_STATUSES = ["PENDING_CODE", "PENDING_PASSWORD", "ACTIVE", "ERROR", "DISCONNECTED"] as const;
export type TelegramSessionStatus = (typeof TELEGRAM_SESSION_STATUSES)[number];

/** Lit la valeur JSON du réglage ; null si absente ou mal formée. */
export function parseTelegramUserApi(value: unknown): TelegramUserApiSetting | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { apiId?: unknown; apiHashEncrypted?: unknown };
  const apiId = typeof v.apiId === "string" ? Number(v.apiId) : v.apiId;
  if (typeof apiId !== "number" || !Number.isInteger(apiId) || apiId <= 0) return null;
  if (typeof v.apiHashEncrypted !== "string" || !v.apiHashEncrypted) return null;
  return { apiId, apiHashEncrypted: v.apiHashEncrypted };
}

/** Normalise un numéro saisi : espaces, points et tirets retirés, « 00 » → « + ». Retourne null si invalide. */
export function normalizePhone(raw: string): string | null {
  let s = String(raw ?? "").replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  return s;
}

/** Masque un numéro pour l'affichage : indicatif et deux derniers chiffres visibles (+33 6 •• •• •• 12). */
export function maskPhone(phone: string): string {
  const s = String(phone ?? "").replace(/\s/g, "");
  if (s.length < 6) return "••••";
  const head = s.slice(0, 3);
  const tail = s.slice(-2);
  const middle = "•".repeat(Math.max(2, s.length - 5));
  return `${head} ${middle} ${tail}`;
}

/** Vérifie la forme d'un `api_hash` (32 caractères hexadécimaux). */
export function isValidApiHash(hash: string): boolean {
  return /^[0-9a-f]{32}$/i.test(String(hash ?? "").trim());
}
