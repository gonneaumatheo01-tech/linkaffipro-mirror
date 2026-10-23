/** Chef Dating : Médiathèque → Média IA (phase 20, sauté) → Rédaction → Planification → Contrôle → Publication. */
import type { Chain } from "./chain";

export const datingChain: Chain = {
  teamKey: "dating",
  post: ["mediatheque", "media-ia", "redaction", "planification", "controle", "publication"],
  active: true,
};
