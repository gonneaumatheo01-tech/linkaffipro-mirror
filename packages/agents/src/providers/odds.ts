/** Fournisseur de cotes (phase 23 : Paris sportifs). Interface seulement en phase 19. */
export type OddsQuery = { sport: string; league?: string; from: Date; to: Date };
export type OddsEvent = { id: string; home: string; away: string; startAt: Date; markets: Record<string, number> };
export type OddsProvider = { name: string; events(q: OddsQuery): Promise<{ events: OddsEvent[]; costCents: number }> };
