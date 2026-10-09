/** Niveau de dépense d'un membre, calculé à partir des joueurs rattachés. */
export const SPEND_LEVELS = ["AUCUN", "INSCRIT", "DEPOSANT", "REGULIER", "VIP"] as const;
export type SpendLevel = (typeof SPEND_LEVELS)[number];
export const SPEND_LEVEL_LABELS: Record<SpendLevel, string> = { AUCUN: "Aucun", INSCRIT: "Inscrit", DEPOSANT: "Déposant", REGULIER: "Régulier", VIP: "VIP" };

/** Seuils réglables (Réglages → Connecteurs), stockés dans `Setting` clé `spend.thresholds`. */
export type SpendThresholds = { vip: number; regularDeposits: number };
export const DEFAULT_SPEND_THRESHOLDS: SpendThresholds = { vip: 500, regularDeposits: 3 };

export type SpendInput = {
  /** Au moins un joueur rattaché. */
  hasPlayer: boolean;
  /** Inscription confirmée (registeredAt ou événement REGISTRATION). */
  registered: boolean;
  /** Nombre total de dépôts (FTD compris). */
  depositCount: number;
  /** Dépôts cumulés en EUR. */
  depositTotal: number;
};

/** Lit les seuils depuis une valeur JSON quelconque, avec repli sur les défauts. */
export function parseSpendThresholds(value: unknown): SpendThresholds {
  const v = (value ?? {}) as Partial<Record<keyof SpendThresholds, unknown>>;
  const vip = typeof v.vip === "number" && v.vip > 0 ? v.vip : DEFAULT_SPEND_THRESHOLDS.vip;
  const regularDeposits = typeof v.regularDeposits === "number" && v.regularDeposits > 0 ? v.regularDeposits : DEFAULT_SPEND_THRESHOLDS.regularDeposits;
  return { vip, regularDeposits };
}

/**
 * AUCUN : pas de joueur ; INSCRIT : inscrit sans dépôt ; DÉPOSANT : au moins un dépôt ;
 * RÉGULIER : ≥ `regularDeposits` dépôts ; VIP : dépôts cumulés ≥ `vip`.
 */
export function computeSpendLevel(input: SpendInput, thresholds: SpendThresholds = DEFAULT_SPEND_THRESHOLDS): SpendLevel {
  if (!input.hasPlayer) return "AUCUN";
  const deposits = Math.max(0, input.depositCount);
  const total = Math.max(0, input.depositTotal);
  if (deposits === 0 && total <= 0) return input.registered ? "INSCRIT" : "AUCUN";
  if (total >= thresholds.vip) return "VIP";
  if (deposits >= thresholds.regularDeposits) return "REGULIER";
  return "DEPOSANT";
}

/** Agrège plusieurs joueurs d'un même membre en une seule entrée de calcul. */
export function aggregatePlayers(players: Array<{ registeredAt?: Date | null; depositCount: number; depositTotal: number }>): SpendInput {
  return {
    hasPlayer: players.length > 0,
    registered: players.some((p) => !!p.registeredAt),
    depositCount: players.reduce((s, p) => s + (p.depositCount ?? 0), 0),
    depositTotal: players.reduce((s, p) => s + (p.depositTotal ?? 0), 0),
  };
}
