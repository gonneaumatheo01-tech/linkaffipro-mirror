/**
 * Fabrique du client de l'assistant IA. Par défaut : SDK officiel Anthropic (paquet @linkaffipro/ai).
 * Les tests la remplacent par un client simulé (`setAiClientFactory`) : aucun appel réseau, aucune clé réelle.
 */
import { createAnthropicClient, type AiClient } from "@linkaffipro/ai";

export type AiClientFactory = (apiKey: string) => AiClient;

const defaultFactory: AiClientFactory = (apiKey) => createAnthropicClient(apiKey);
let factory: AiClientFactory = defaultFactory;

/** Client à utiliser pour un appel (la clé est déjà déchiffrée par l'appelant ; ne jamais la journaliser). */
export function aiClientFor(apiKey: string): AiClient {
  return factory(apiKey);
}

/** Tests : remplace la fabrique ; `null` remet le client réel. */
export function setAiClientFactory(next: AiClientFactory | null): void {
  factory = next ?? defaultFactory;
}
