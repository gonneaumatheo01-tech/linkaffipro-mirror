/** Chef Casino : Médiathèque → Rédaction → Planification → Contrôle → Publication. */
import type { Chain } from "./chain";

export const casinoChain: Chain = {
  teamKey: "casino",
  post: ["mediatheque", "redaction", "planification", "controle", "publication"],
  active: true,
};
