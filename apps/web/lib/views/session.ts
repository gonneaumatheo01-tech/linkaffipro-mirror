import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  parseTelegramUserApi,
  TELEGRAM_SESSION_ID,
  TELEGRAM_USER_API_SETTING,
  type MtprotoCredentials,
  type TelegramSessionStatus,
} from "@linkaffipro/mtproto";

/** Identifiants d'application Telegram (Setting `telegram.userApi`), déchiffrés ; null si non configurés. */
export async function getTelegramUserApi(): Promise<MtprotoCredentials | null> {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } });
  const parsed = parseTelegramUserApi(row?.value);
  if (!parsed) return null;
  try {
    return { apiId: parsed.apiId, apiHash: decrypt(parsed.apiHashEncrypted) };
  } catch {
    return null;
  }
}

export type TelegramSessionView = {
  status: TelegramSessionStatus;
  phone: string;
  connectedById: string | null;
  connectedByName: string | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** État affichable de la session (sans la session elle-même). */
export async function getTelegramSessionView(): Promise<TelegramSessionView | null> {
  const row = await prisma.telegramUserSession.findUnique({ where: { id: TELEGRAM_SESSION_ID } });
  if (!row) return null;
  const by = row.connectedById
    ? await prisma.user.findUnique({ where: { id: row.connectedById }, select: { name: true } })
    : null;
  return {
    status: row.status as TelegramSessionStatus,
    phone: row.phone,
    connectedById: row.connectedById,
    connectedByName: by?.name ?? null,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Session déchiffrée (réservé aux actions serveur ADMIN) ; jamais renvoyée au navigateur ni journalisée. */
export async function getTelegramSessionSecret(): Promise<{
  status: TelegramSessionStatus;
  phone: string;
  phoneCodeHash: string | null;
  session: string;
} | null> {
  const row = await prisma.telegramUserSession.findUnique({ where: { id: TELEGRAM_SESSION_ID } });
  if (!row || !row.sessionEncrypted) return null;
  return {
    status: row.status as TelegramSessionStatus,
    phone: row.phone,
    phoneCodeHash: row.phoneCodeHash,
    session: decrypt(row.sessionEncrypted),
  };
}

/** Attente FLOOD_WAIT en cours (Setting `views.floodUntil`), ou null. */
export async function getViewsFloodUntil(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: "views.floodUntil" } });
  const iso = (row?.value as { until?: string } | null)?.until;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d <= new Date() ? null : d;
}
