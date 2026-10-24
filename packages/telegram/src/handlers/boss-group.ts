import type { Bot, Context } from "grammy";
import type { BotIdentity, TelegramDeps } from "../ports";

/** Types de chat traités par le mode groupe du Boss (section 4 de la phase 26). */
export function isBossGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

/**
 * Point d'accroche du mode groupe d'équipe du Boss (phase 26, section 4 : groupe enregistré par l'admin, membres
 * présentés, mentions). Fait par un autre chantier : pour l'instant RIEN n'est traité (aucune réponse, rien envoyé à
 * l'IA) ; l'update reste journalisée par le middleware du Boss. Ne lève jamais.
 */
export async function handleBossGroupUpdate(ctx: Context, identity: BotIdentity, deps: TelegramDeps): Promise<void> {
  void ctx;
  void identity;
  void deps;
}

/**
 * Sur le Boss, toute update d'un groupe (messages, boutons, ajout ou retrait du bot) passe par
 * `handleBossGroupUpdate` et s'arrête là : aucun autre handler du Boss ne voit un groupe. Les canaux : silence.
 * Enregistré en premier parmi les handlers du Boss.
 */
export function registerBossGroupHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type === "channel") return;
    if (!isBossGroupChat(type)) return next();
    try {
      await handleBossGroupUpdate(ctx, identity, deps);
    } catch (err) {
      console.error("[boss] groupe", identity.username, (err as Error).message);
    }
  });
}
