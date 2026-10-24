import { Api, GrammyError } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { splitMessage } from "./admin-chat";
import { adminBot } from "./admin-bot";

/**
 * Envoie un message HTML à l'administrateur par Telegram (même mécanisme que `pnpm tg:send`) :
 * identifiant mémorisé dans `Setting` `admin.telegramUserId`, bot du dialogue admin (`adminBot()` : le Boss, sinon le
 * bot casino de repli), jeton déchiffré en mémoire.
 * Renvoie false (sans lever) si l'identifiant ou le bot manquent ; lève sur un refus Telegram.
 */
export async function notifyAdmin(text: string): Promise<boolean> {
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  const adminId = setting && typeof setting.value === "string" ? BigInt(setting.value) : null;
  if (!adminId) return false;
  // Phase 26 : le Boss s'il existe, sinon le repli (jamais un assistant de conversation ni un bot fantôme).
  const bot = await adminBot();
  if (!bot) return false;
  const api = new Api(decrypt(bot.tokenEncrypted));
  for (const part of splitMessage(text)) {
    try {
      await api.sendMessage(Number(adminId), part, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch (err) {
      if (err instanceof GrammyError && /parse entities/i.test(err.description)) {
        await api.sendMessage(Number(adminId), part, { link_preview_options: { is_disabled: true } });
      } else if (err instanceof GrammyError) {
        throw new Error(`Telegram a refusé l'envoi (${err.error_code}) : ${err.description}`);
      } else throw err;
    }
  }
  return true;
}
