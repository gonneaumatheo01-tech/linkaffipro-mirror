/**
 * Libellés français des paris (phase 23, règles pures) : statistiques, ligues, bookmakers, sélections. Les
 * identifiants restent ceux du fournisseur (`oddID` SportsGameOdds) ; seul l'affichage est traduit.
 */

/** `oddID` découpé : `{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}`. */
export type ParsedMarketId = { statId: string; entity: string; period: string; betType: string; side: string };

export function parseMarketId(marketId: string): ParsedMarketId | null {
  const parts = marketId.split("-");
  if (parts.length !== 5 || parts.some((p) => !p)) return null;
  const [statId, entity, period, betType, side] = parts as [string, string, string, string, string];
  return { statId, entity, period, betType, side };
}

/** Entité d'équipe ou de match (sinon un joueur : identifiant propre au fournisseur). */
export const TEAM_ENTITIES = new Set(["home", "away", "all"]);

const STAT_LABELS: Record<string, string> = {
  points: "Buts",
  shots_onGoal: "Tirs cadrés",
  shots: "Tirs",
  corners: "Corners",
  cards: "Cartons",
  yellowCards: "Cartons jaunes",
  redCards: "Cartons rouges",
  fouls: "Fautes",
  offsides: "Hors-jeu",
};

export function statLabel(statId: string): string {
  return STAT_LABELS[statId] ?? statId.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

const LEAGUE_LABELS: Record<string, string> = {
  EPL: "Premier League",
  LA_LIGA: "Liga",
  BUNDESLIGA: "Bundesliga",
  IT_SERIE_A: "Serie A",
  FR_LIGUE_1: "Ligue 1",
  UEFA_CHAMPIONS_LEAGUE: "Ligue des champions",
  UEFA_EUROPA_LEAGUE: "Ligue Europa",
  MLS: "MLS",
};

export function leagueLabel(leagueId: string): string {
  return LEAGUE_LABELS[leagueId] ?? leagueId.replace(/_/g, " ");
}

const BOOKMAKER_LABELS: Record<string, string> = {
  sportaza: "Sportaza",
  "5gringos": "5Gringos",
  bet365: "bet365",
  unibet: "Unibet",
  pinnacle: "Pinnacle",
  williamhill: "William Hill",
  betclic: "Betclic",
  winamax: "Winamax",
};

export function bookmakerLabel(key: string): string {
  return BOOKMAKER_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Nombre à la française (« 1,95 », « 8,5 »). */
export function frNumber(n: number, digits = 2): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Cote affichée : toujours deux décimales (« 2,00 »). */
export function frOdds(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Joueur (`LIONEL_MESSI_1_MLS`) → « Lionel Messi » quand le fournisseur ne donne pas de nom. */
export function prettyPlayer(id: string): string {
  // Le nom s'arrête au premier numéro (suivi de la ligue).
  const parts = id.split("_");
  const stop = parts.findIndex((w) => /^\d+$/.test(w));
  return (stop >= 0 ? parts.slice(0, stop) : parts)
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export type MarketTeams = { homeTeam: string; awayTeam: string; playerName?: string | null };

/** Libellé du marché (« Tirs cadrés (total du match) », « Tirs cadrés (Arsenal) »). */
export function marketLabelOf(marketId: string, teams: MarketTeams): string {
  const p = parseMarketId(marketId);
  if (!p) return marketId;
  const stat = statLabel(p.statId);
  const half = p.period === "1h" ? ", 1re mi-temps" : p.period === "2h" ? ", 2e mi-temps" : "";
  if (p.betType === "ml" || p.betType === "ml3way") return `Résultat du match${p.period === "reg" ? " (temps réglementaire)" : ""}${half}`;
  if (p.betType === "sp") return `Handicap ${stat.toLowerCase()}${half}`;
  const who =
    p.entity === "all" ? "total du match" : p.entity === "home" ? teams.homeTeam : p.entity === "away" ? teams.awayTeam : (teams.playerName ?? prettyPlayer(p.entity));
  if (p.betType === "yn" && p.statId === "points" && !TEAM_ENTITIES.has(p.entity)) return `Buteur (${who})${half}`;
  return `${stat} (${who})${half}`;
}

/** Libellé de la sélection (« Plus de 8,5 », « Oui », « Arsenal », « Match nul »). */
export function selectionLabelOf(marketId: string, line: number | null, teams: MarketTeams): string {
  const p = parseMarketId(marketId);
  if (!p) return marketId;
  if (p.betType === "ou") return `${p.side === "under" ? "Moins de" : "Plus de"} ${line === null ? "?" : frNumber(line)}`;
  if (p.betType === "yn") return p.side === "no" ? "Non" : "Oui";
  if (p.side === "draw") return "Match nul";
  const team = p.side === "home" ? teams.homeTeam : p.side === "away" ? teams.awayTeam : p.side;
  if (p.betType === "sp" && line !== null) return `${team} (${line > 0 ? "+" : ""}${frNumber(line)})`;
  return team;
}
