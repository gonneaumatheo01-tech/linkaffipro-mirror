import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { decrypt } from "@linkaffipro/core";
import type { BotIdentity, BotMode, TelegramDeps } from "./ports";
import { registerHandlers } from "./handlers";

export type BotRecordLike = BotIdentity & { tokenEncrypted: string };

/** Construit l'objet botInfo attendu par grammY à partir de l'enregistrement en base (évite un appel getMe). */
export function botInfoFromRecord(rec: BotIdentity): UserFromGetMe {
  return {
    id: Number(rec.telegramBotId),
    is_bot: true,
    first_name: rec.name,
    username: rec.username,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

/** Crée une instance grammY pour un bot (jeton déchiffré en mémoire seulement) avec ses handlers. */
export function createBot(rec: BotRecordLike, deps: TelegramDeps): Bot {
  const token = decrypt(rec.tokenEncrypted);
  const bot = new Bot(token, { botInfo: botInfoFromRecord(rec) });
  registerHandlers(bot, rec, deps);
  return bot;
}

type CachedBot = { bot: Bot; tokenEncrypted: string; mode: BotMode; personaId: string | null };

/**
 * Cache d'instances par id de bot, invalidé si le jeton chiffré, le mode ou la persona changent (phase 17 : un bot passé
 * en mode assistant n'a plus les mêmes handlers). Un appelant qui ne connaît pas le mode ou la persona (lecture des
 * droits, API seule : champ absent) réutilise l'instance en cache telle quelle.
 */
const cache = new Map<string, CachedBot>();

/** L'instance en cache convient-elle à cet enregistrement ? (fonction pure, testée) */
export function cachedBotMatches(
  hit: Pick<CachedBot, "tokenEncrypted" | "mode" | "personaId">,
  rec: Pick<BotRecordLike, "tokenEncrypted" | "mode" | "personaId">,
): boolean {
  if (hit.tokenEncrypted !== rec.tokenEncrypted) return false;
  if (rec.mode !== undefined && hit.mode !== rec.mode) return false;
  if (rec.personaId !== undefined && hit.personaId !== (rec.personaId ?? null)) return false;
  return true;
}

export function getOrCreateBot(rec: BotRecordLike, deps: TelegramDeps): Bot {
  const hit = cache.get(rec.id);
  if (hit && cachedBotMatches(hit, rec)) return hit.bot;
  const bot = createBot(rec, deps);
  cache.set(rec.id, {
    bot,
    tokenEncrypted: rec.tokenEncrypted,
    mode: rec.mode ?? "STANDARD",
    personaId: rec.personaId ?? null,
  });
  return bot;
}

export function evictBot(botId: string): void {
  cache.delete(botId);
}
