import { Api, GrammyError } from "grammy";
import { TELEGRAM_ALLOWED_UPDATES, encrypt, randomToken, type Vertical } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { evictBot } from "./factory.js";

export function webhookUrlFor(botId: string, baseUrl = process.env.APP_BASE_URL): string {
  if (!baseUrl) throw new Error("APP_BASE_URL manquante");
  return `${baseUrl.replace(/\/$/, "")}/api/telegram/${botId}`;
}

export type RegisterResult = {
  botId: string;
  username: string;
  name: string;
  created: boolean;
  webhook: Awaited<ReturnType<Api["getWebhookInfo"]>>;
};

/**
 * Enregistre un bot à partir de son jeton : getMe, chiffrement, enregistrement en base, pose du webhook.
 * Code commun à l'interface (page Bots) et au script `pnpm bots:register`.
 */
export async function registerBotFromToken(
  token: string,
  vertical: Vertical,
  opts: { userId?: string | null } = {},
): Promise<RegisterResult> {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(trimmed)) throw new Error("Format de jeton invalide");
  const api = new Api(trimmed);
  let me;
  try {
    me = await api.getMe();
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 401) throw new Error("Jeton refusé par Telegram (401)");
    throw err;
  }
  const username = me.username ?? String(me.id);
  const existing = await prisma.bot.findUnique({ where: { telegramBotId: BigInt(me.id) } });
  const webhookSecret = existing?.webhookSecret ?? randomToken(32);
  const bot = await prisma.bot.upsert({
    where: { telegramBotId: BigInt(me.id) },
    create: {
      telegramBotId: BigInt(me.id),
      name: me.first_name,
      username,
      tokenEncrypted: encrypt(trimmed),
      vertical,
      webhookSecret,
      isActive: true,
    },
    update: { name: me.first_name, username, tokenEncrypted: encrypt(trimmed), vertical, isActive: true, lastError: null },
  });
  evictBot(bot.id);
  const webhook = await setWebhookForBot(bot.id);
  await audit({
    userId: opts.userId ?? null,
    action: existing ? "bot.updated" : "bot.created",
    entityType: "Bot",
    entityId: bot.id,
    metadata: { username, vertical },
  });
  return { botId: bot.id, username, name: me.first_name, created: !existing, webhook };
}

/** (Re)pose le webhook d'un bot à partir de APP_BASE_URL et renvoie getWebhookInfo. */
export async function setWebhookForBot(botId: string) {
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
  const { decrypt } = await import("@linkaffipro/core");
  const api = new Api(decrypt(bot.tokenEncrypted));
  const url = webhookUrlFor(bot.id);
  try {
    await api.setWebhook(url, {
      allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      secret_token: bot.webhookSecret,
      drop_pending_updates: false,
    });
    const info = await api.getWebhookInfo();
    await prisma.bot.update({ where: { id: botId }, data: { lastError: info.last_error_message ?? null } });
    return info;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.bot.update({ where: { id: botId }, data: { lastError: message } });
    throw err;
  }
}

export async function getWebhookInfoForBot(botId: string) {
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
  const { decrypt } = await import("@linkaffipro/core");
  const api = new Api(decrypt(bot.tokenEncrypted));
  return api.getWebhookInfo();
}

/** Repose les webhooks de tous les bots actifs. */
export async function setAllWebhooks(): Promise<Array<{ username: string; url?: string; error?: string }>> {
  const bots = await prisma.bot.findMany({ where: { isActive: true } });
  const out: Array<{ username: string; url?: string; error?: string }> = [];
  for (const b of bots) {
    try {
      const info = await setWebhookForBot(b.id);
      out.push({ username: b.username, url: info.url, error: info.last_error_message });
    } catch (err) {
      out.push({ username: b.username, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
