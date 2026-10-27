/**
 * Phase 31, chantier D — boutons sous les prospects envoyés par Kevin (`prospect:<id>:<action>` : ✅ Contacté,
 * 🤝 Signé, 🔎 Dossier, ⏰ Plus tard, ❌ Pas intéressé, type de deal, rappels) → `prospectButton` (Pipeline). Réponse :
 * le petit message au doigt (`answerCallbackQuery`), puis la réponse de Kevin dans la même conversation. Seuls l'admin
 * et les responsables de l'équipe changent le pipeline (le moteur le vérifie). Rien n'est jamais envoyé à un tiers.
 */
import type { Bot, Context } from "grammy";
import { isProspectCallbackData, prospectButton, type AgentsDeps, type ProspectionKevinDeps } from "@linkaffipro/agents";
import { isBossBot, type BotIdentity, type TelegramDeps } from "../ports";
import { sendBossText, type BossReplyApi } from "../boss/reply";

function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

/** Bouton `prospect:` appuyé (privé, groupe de l'équipe, privé d'un membre). Ne lève jamais. */
export async function onProspectCallback(ctx: Context, agents: AgentsDeps): Promise<void> {
  const cq = ctx.callbackQuery;
  if (!cq?.data) return;
  const chatId = cq.message?.chat.id ?? cq.from.id;
  try {
    const r = await prospectButton(agents as unknown as ProspectionKevinDeps, { data: cq.data, chatId, fromTelegramId: BigInt(cq.from.id) });
    await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
    if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    if (r.reply) await sendBossText(replyApiOf(ctx), chatId, r.reply, r.buttons ? { buttons: r.buttons } : {});
  } catch (err) {
    console.error("[prospection] bouton", (err as Error).message);
    await ctx.answerCallbackQuery().catch(() => undefined);
  }
}

/** Boutons des prospects sur Kevin, en privé (le groupe passe par `boss-group.ts`). À enregistrer avant le dialogue admin. */
export function registerBossProspectionHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  if (!isBossBot(identity)) return;
  bot.on("callback_query:data", async (ctx, next) => {
    if (!isProspectCallbackData(ctx.callbackQuery.data) || !deps.agentsDeps) return next();
    await onProspectCallback(ctx, deps.agentsDeps());
  });
}

export { isProspectCallbackData };
