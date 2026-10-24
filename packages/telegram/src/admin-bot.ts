/**
 * Bot du dialogue admin (`notifyAdmin`, `pnpm tg:send`, messager des agents, rapports, alertes, demandes, validations,
 * aperçus, bilans). Phase 26 : UNE seule fonction, `adminBot()` :
 * 1. le Boss (`role: ADMIN`) actif, le plus récent s'il y en avait plusieurs ;
 * 2. sinon le repli d'avant la phase 26 : bot casino de canal actif, en mode normal, le plus ancien — jamais un
 *    assistant de conversation (phase 17) ni le bot fantôme d'un compte réel (phase 18 : faux jeton, Telegram répond
 *    404). Le plus ancien d'abord, pour que l'admin parle toujours au même bot avant la création du Boss.
 */
import { prisma as sharedPrisma, type Bot as BotRow } from "@linkaffipro/db";

/** Repli (avant tout Boss) : bot casino de canal, actif, normal, jamais un bot fantôme. */
export const ADMIN_BOT_WHERE = {
  vertical: "CASINO" as const,
  isActive: true,
  mode: "STANDARD" as const,
  role: "CHANNEL" as const,
  userbotAccounts: { none: {} },
  NOT: { username: { startsWith: "userbot_" } },
};

export const ADMIN_BOT_ORDER = { createdAt: "asc" as const };

/** Le Boss : bot `role: ADMIN` actif, en mode normal, jamais un bot fantôme. */
export const BOSS_BOT_WHERE = {
  role: "ADMIN" as const,
  isActive: true,
  mode: "STANDARD" as const,
  userbotAccounts: { none: {} },
  NOT: { username: { startsWith: "userbot_" } },
};

/** Le plus récent d'abord : un Boss remplacé est désactivé, mais en cas de doublon le dernier enregistré gagne. */
export const BOSS_BOT_ORDER = { createdAt: "desc" as const };

/** Sous-ensemble Prisma utilisé (tests : faux client). */
export type AdminBotDb = {
  bot: {
    findFirst(args: { where: Record<string, unknown>; orderBy: Record<string, "asc" | "desc"> }): Promise<BotRow | null>;
  };
};

export type AdminBotChoice = BotRow & {
  /** Vrai Boss (`role: ADMIN`) ; faux = bot de repli (bot casino de canal qui fait office de Boss). */
  isBoss: boolean;
};

async function sharedDb(): Promise<AdminBotDb> {
  return sharedPrisma as unknown as AdminBotDb;
}

/** Bot du dialogue admin (voir l'en-tête). Ne lève pas pour une base vide : `null`. */
export async function adminBot(db?: AdminBotDb): Promise<AdminBotChoice | null> {
  const client = db ?? (await sharedDb());
  const boss = await client.bot.findFirst({ where: BOSS_BOT_WHERE, orderBy: BOSS_BOT_ORDER });
  if (boss) return { ...boss, isBoss: true };
  const fallback = await client.bot.findFirst({ where: ADMIN_BOT_WHERE, orderBy: ADMIN_BOT_ORDER });
  return fallback ? { ...fallback, isBoss: false } : null;
}
