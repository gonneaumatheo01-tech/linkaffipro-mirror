/**
 * Chef Paris sportifs (phase 23) : Cotes → Capture → Rédaction → Planification → Contrôle → Publication. Chaîne
 * déclarée ; sans agent Cotes en phase 19, le plan du jour ne crée aucune mission pour cette équipe.
 */
import type { Chain } from "./chain";

export const sportsChain: Chain = {
  teamKey: "sports",
  post: ["cotes", "capture", "redaction", "planification", "controle", "publication"],
  active: false,
};
