/**
 * Chef Algorithme (phase 21) : Posts → Horaires → Expérimentation → Synthèse. Chaîne déclarée ; aucun agent réel en
 * phase 19, donc aucune mission créée par le plan du jour.
 */
import type { Chain } from "./chain";

export const algoChain: Chain = {
  teamKey: "algo",
  post: ["posts", "horaires", "experimentation", "synthese"],
  active: false,
};
