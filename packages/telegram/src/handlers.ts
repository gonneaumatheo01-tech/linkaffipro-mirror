import type { Bot } from "grammy";
import type { BotIdentity, TelegramDeps } from "./ports";
import type { AssistantDeps } from "./assistant/deps";
import { registerAssistantHandlers } from "./handlers/assistant";
import { registerCoreHandlers } from "./handlers/core";
import { registerJoinFlowHandlers } from "./handlers/join-flow";
import { registerOfferHandlers } from "./handlers/offers";
import { registerReactionHandlers } from "./handlers/reactions";

export { updateTypeOf } from "./handlers/core";

/**
 * Enregistre tous les handlers d'un bot. Ordre : journalisation (core) d'abord, puis les commandes
 * spécialisées (`/start g…`, `/start o…`) AVANT le `/start` générique de core.
 * Phase 17 : un bot en mode assistant de conversation garde seulement la journalisation (sans texte) et le statut du
 * bot, puis les handlers de l'assistant (`handlers/assistant.ts`) ; `assistantDeps` : dépendances simulées des tests.
 */
export function registerHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  opts: { extended?: boolean; assistantDeps?: AssistantDeps } = {},
): void {
  registerCoreHandlers(bot, identity, deps, {
    beforeStart: (b) => {
      if (opts.extended === false) return;
      registerJoinFlowHandlers(b, identity, undefined, deps);
      registerOfferHandlers(b, identity);
      registerReactionHandlers(b, identity, deps);
    },
    assistant: (b) => registerAssistantHandlers(b, identity, opts.assistantDeps),
  });
}
