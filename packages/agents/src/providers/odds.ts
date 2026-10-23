/**
 * Fournisseur de cotes (phase 23) : SportsGameOdds en principal, faux fournisseur sur fixtures en test et en
 * simulation. Cotes toujours en DÉCIMAL côté agents (le client convertit le format américain du fournisseur).
 */
export type OddsEvent = {
  eventId: string;
  leagueId: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  /** Adresses des bookmakers chez le fournisseur (`links.bookmakers`), si connues. */
  bookmakerLinks?: Record<string, string>;
};

export type OddsSelection = {
  /** `oddID` du fournisseur (PLAYER_ID remplacé par le joueur). */
  marketId: string;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  /** Cote décimale par bookmaker (clé du fournisseur) ; seulement les cotes ouvertes. */
  byBookmaker: Record<string, number>;
  /** Cote « juste » de consensus (sans marge) si le fournisseur la donne. */
  fairOdds: number | null;
};

export type OddsResult = {
  eventId: string;
  finalized: boolean;
  cancelled: boolean;
  homeScore: number | null;
  awayScore: number | null;
  /** Valeur finale par `marketId` (score du marché : tirs cadrés, corners…) quand le fournisseur la donne. */
  marketScores: Record<string, number>;
  stats: Record<string, number>;
};

export type OddsProvider = {
  name: "sportsgameodds" | "fake";
  listEvents(q: { sport: string; leagues: string[]; from: Date; to: Date }): Promise<OddsEvent[]>;
  getMarkets(eventId: string, marketTypes: string[]): Promise<OddsSelection[]>;
  getResult(eventId: string): Promise<OddsResult | null>;
  listBookmakers(): Promise<string[]>;
};
