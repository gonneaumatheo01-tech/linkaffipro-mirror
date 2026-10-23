/**
 * Méthodes facultatives d'un fournisseur de cotes, en plus du contrat figé `OddsProvider` : lecture groupée des
 * cotes de plusieurs matchs (un appel au lieu d'un par match) et relecture sans cache (vérification avant l'envoi).
 */
import type { OddsProvider, OddsSelection } from "./odds";

export type BatchOddsProvider = OddsProvider & {
  getMarketsMany?(eventIds: string[], marketTypes: string[]): Promise<Map<string, OddsSelection[]>>;
  /** Relecture qui ignore le cache (Contrôle qualité, publication). */
  getMarketsFresh?(eventId: string, marketTypes: string[]): Promise<OddsSelection[]>;
};

export async function marketsForEvents(p: OddsProvider, eventIds: string[], marketTypes: string[]): Promise<Map<string, OddsSelection[]>> {
  const b = p as BatchOddsProvider;
  if (b.getMarketsMany) return b.getMarketsMany(eventIds, marketTypes);
  const out = new Map<string, OddsSelection[]>();
  for (const id of eventIds) out.set(id, await p.getMarkets(id, marketTypes));
  return out;
}

export async function freshMarkets(p: OddsProvider, eventId: string, marketTypes: string[]): Promise<OddsSelection[]> {
  const b = p as BatchOddsProvider;
  return b.getMarketsFresh ? b.getMarketsFresh(eventId, marketTypes) : p.getMarkets(eventId, marketTypes);
}
