/**
 * Chef Paris sportifs (phase 23) : Cotes et sélection → Capture → Rédaction → Contrôle (cote re-vérifiée) →
 * Publication immédiate. Pas de Planification : un pari ne se programme pas. Le plan du jour du Grand Chef ne crée
 * rien pour cette équipe : ses missions BET viennent des passages du Chef (`sports/passage.ts`).
 */
import type { Chain } from "./chain";

export const sportsChain: Chain = {
  teamKey: "sports",
  post: ["cotes", "capture", "redaction", "controle", "publication"],
  active: true,
};
