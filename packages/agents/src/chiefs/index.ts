import type { TeamKey } from "../types";
import { algoChain } from "./algo";
import { casinoChain } from "./casino";
import type { Chain } from "./chain";
import { datingChain } from "./dating";
import { sportsChain } from "./sports";

export const CHAINS: Record<TeamKey, Chain> = {
  dating: datingChain,
  casino: casinoChain,
  sports: sportsChain,
  algo: algoChain,
};

export function chainOf(teamKey: TeamKey): Chain {
  return CHAINS[teamKey];
}
