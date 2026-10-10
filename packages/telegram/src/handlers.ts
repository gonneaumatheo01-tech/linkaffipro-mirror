import type { Bot } from "grammy";
import type { BotIdentity, TelegramDeps } from "./ports";
import { registerCoreHandlers } from "./handlers/core";
import { registerJoinFlowHandlers } from "./handlers/join-flow";
import { registerOfferHandlers } from "./handlers/offers";
import { registerReactionHandlers } from "./handlers/reactions";

export { updateTypeOf } from "./handlers/core";

/**
 * Enregistre tous les handlers d'un bot. Ordre : journalisation (core) d'abord, puis les commandes
 * spécialisées (`/start g…`, `/start o…`) AVANT le `/start` générique de core.
 */
export function registerHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps, opts: { extended?: boolean } = {}): void {
  registerCoreHandlers(bot, identity, deps, {
    beforeStart: (b) => {
      if (opts.extended === false) return;
      registerJoinFlowHandlers(b, identity, undefined, deps);
      registerOfferHandlers(b, identity);
      registerReactionHandlers(b, identity, deps);
    },
  });
}
