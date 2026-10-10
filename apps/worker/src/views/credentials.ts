import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { parseTelegramUserApi, TELEGRAM_SESSION_ID, TELEGRAM_USER_API_SETTING, type MtprotoCredentials } from "@linkaffipro/mtproto";

/** Identifiants d'application Telegram (Setting `telegram.userApi`), déchiffrés ; null si non configurés. */
export async function loadUserApiCredentials(): Promise<MtprotoCredentials | null> {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } });
  const parsed = parseTelegramUserApi(row?.value);
  if (!parsed) return null;
  try {
    return { apiId: parsed.apiId, apiHash: decrypt(parsed.apiHashEncrypted) };
  } catch {
    return null;
  }
}

export type ActiveSession = { id: string; session: string; creds: MtprotoCredentials };

/** Session ACTIVE déchiffrée + identifiants ; null (avec raison) si rien n'est utilisable. */
export async function loadActiveSession(): Promise<{ active: ActiveSession | null; reason: string | null }> {
  const row = await prisma.telegramUserSession.findUnique({ where: { id: TELEGRAM_SESSION_ID } });
  if (!row || row.status === "DISCONNECTED") return { active: null, reason: "compte Telegram non connecté" };
  if (row.status !== "ACTIVE") return { active: null, reason: `compte Telegram non prêt (${row.status})` };
  const creds = await loadUserApiCredentials();
  if (!creds) return { active: null, reason: "application Telegram (api_id / api_hash) non configurée" };
  if (!row.sessionEncrypted) return { active: null, reason: "session Telegram vide" };
  try {
    return { active: { id: row.id, session: decrypt(row.sessionEncrypted), creds }, reason: null };
  } catch {
    return { active: null, reason: "session Telegram illisible (clé de chiffrement changée ?)" };
  }
}
