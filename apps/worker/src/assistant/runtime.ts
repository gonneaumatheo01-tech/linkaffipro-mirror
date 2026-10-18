/**
 * Dépendances « extérieures » du worker de l'assistant de conversation (phase 17) : client du modèle (Venice), liste des
 * modèles, horloge, attente et hasard. Réelles en production ; remplaçables dans les tests (faux client Venice, aucune
 * attente réelle) par `configureChatRuntime`, remises à zéro par `resetChatRuntime`.
 */
import {
  createVeniceClient,
  listVeniceModels,
  type LlmClient,
  type VeniceModelInfo,
} from "@linkaffipro/chat";

export type ChatRuntime = {
  /** Client du modèle pour une clé (vide : refus local `no_key`, jamais d'appel). */
  llmFactory(apiKey: string): LlmClient;
  /** Modèles texte de Venice (`GET /models?type=text`). */
  listModels(): Promise<VeniceModelInfo[]>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  random(): number;
};

const realRuntime: ChatRuntime = {
  llmFactory: (apiKey) => createVeniceClient(apiKey),
  listModels: () => listVeniceModels(),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
  random: () => Math.random(),
};

let current: ChatRuntime = realRuntime;

/** Dépendances en cours (réelles hors tests). */
export function chatRuntime(): ChatRuntime {
  return current;
}

/** Remplace une partie des dépendances (tests : faux client Venice, attente immédiate, horloge fixe). */
export function configureChatRuntime(over: Partial<ChatRuntime>): void {
  current = { ...current, ...over };
}

/** Point d'injection du client du modèle (tests d'intégration : faux client Venice, aucun appel réseau). */
export function setChatLlmFactory(factory: (apiKey: string) => LlmClient): void {
  configureChatRuntime({ llmFactory: factory });
}

/** Revient aux dépendances réelles. */
export function resetChatRuntime(): void {
  current = realRuntime;
}
