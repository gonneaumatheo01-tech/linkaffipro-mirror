/**
 * Phase 34, chantier F — entrées propres à Telegram (contrat `../../site/contract.ts`, `BossInputsApi`) : message
 * transféré = contenu (gardé 30 min), fichier CSV / TXT (gardé 30 min), liens d'autorisation signés à usage unique
 * (15 min) et reprise après OAuth (boutons de choix des comptes). Le déroulé de Kevin (chantier A) importe ces noms.
 */
import type { BossInputsApi } from "../../site/contract";
import { createAuthLink } from "./auth-links";
import { documentSummary, peekDocument, takeDocument } from "./documents";
import { forwardedSummary, peekForwarded, takeForwarded } from "./forwarded";
import { readInputs, type InputsDeps } from "./store";

export * from "./store";
export * from "./forwarded";
export * from "./documents";
export * from "./auth-links";
export * from "./oauth-resume";
export * from "./phrases";
export { INPUTS_VARIANTS, OAUTH_ALL_BUTTON } from "./texts";

/**
 * Une ligne SANS contenu pour l'interprète (« Gardé pour cette conversation : un message transféré de @x, 3 lignes,
 * 1 photo ; le fichier joueurs.csv, 120 lignes »), ou null. Jamais le texte transféré ni le contenu du fichier.
 */
export async function bossInputsSummary(deps: InputsDeps, chatId: string): Promise<string | null> {
  const s = await readInputs(deps, chatId);
  const parts: string[] = [];
  if (s.forwarded) parts.push(`un message transféré (${forwardedSummary(s.forwarded)})`);
  if (s.document) parts.push(`le fichier ${s.document.fileName} (${documentSummary(s.document)})`);
  return parts.length ? `Gardé pour cette conversation : ${parts.join(" ; ")}.` : null;
}

/** Les cinq fonctions du contrat, vérifiées contre `BossInputsApi` à la compilation. */
export const BOSS_INPUTS: BossInputsApi = {
  peekForwarded: (deps, chatId) => peekForwarded(deps as InputsDeps, chatId),
  takeForwarded: (deps, chatId) => takeForwarded(deps as InputsDeps, chatId),
  peekDocument: (deps, chatId) => peekDocument(deps as InputsDeps, chatId),
  takeDocument: (deps, chatId) => takeDocument(deps as InputsDeps, chatId),
  createAuthLink: (deps, req) => createAuthLink(deps as InputsDeps, req),
};
