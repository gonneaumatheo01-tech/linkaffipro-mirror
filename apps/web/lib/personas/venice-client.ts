/**
 * Fabrique du client Venice du bouton « Tester » (phase 17). Par défaut : le vrai client de packages/chat
 * (`createVeniceClient`). Les tests la remplacent par un faux client (`setVeniceClientFactory`) : aucun appel réseau,
 * aucune clé réelle.
 */
import { createVeniceClient, type LlmClient } from "@linkaffipro/chat";

export type VeniceClientFactory = (apiKey: string) => LlmClient;

const defaultFactory: VeniceClientFactory = (apiKey) => createVeniceClient(apiKey);
let factory: VeniceClientFactory = defaultFactory;

/** Client pour un appel (la clé est déjà déchiffrée par l'appelant ; ne jamais la journaliser). */
export function veniceClientFor(apiKey: string): LlmClient {
  return factory(apiKey);
}

/** Tests : remplace la fabrique ; `null` remet le vrai client. */
export function setVeniceClientFactory(next: VeniceClientFactory | null): void {
  factory = next ?? defaultFactory;
}
