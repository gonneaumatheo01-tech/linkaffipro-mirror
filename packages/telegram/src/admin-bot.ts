/**
 * Bot du dialogue admin (`notifyAdmin`, `pnpm tg:send`, aperçus des agents) : bot casino actif en mode normal, jamais
 * un assistant de conversation (phase 17) ni le bot fantôme d'un compte réel (phase 18 : faux jeton, Telegram répond
 * 404). Le plus ancien d'abord, pour que l'admin parle toujours au même bot.
 */
export const ADMIN_BOT_WHERE = {
  vertical: "CASINO" as const,
  isActive: true,
  mode: "STANDARD" as const,
  userbotAccounts: { none: {} },
  NOT: { username: { startsWith: "userbot_" } },
};

export const ADMIN_BOT_ORDER = { createdAt: "asc" as const };
