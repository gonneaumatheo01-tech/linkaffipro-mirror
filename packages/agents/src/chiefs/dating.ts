/** Chef Dating : Médiathèque → Média IA (photo, phase 20) → Rédaction → Planification → Contrôle → Publication. */
import type { Chain } from "./chain";

export const datingChain: Chain = {
  teamKey: "dating",
  post: ["mediatheque", "media-ia", "redaction", "planification", "controle", "publication"],
  active: true,
};
