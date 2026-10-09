/** Niveau de dépense d'un membre (chantier E : à implémenter et tester). */
export const SPEND_LEVELS = ["AUCUN", "INSCRIT", "DEPOSANT", "REGULIER", "VIP"] as const;
export type SpendLevel = (typeof SPEND_LEVELS)[number];
export const SPEND_LEVEL_LABELS: Record<SpendLevel, string> = { AUCUN: "Aucun", INSCRIT: "Inscrit", DEPOSANT: "Déposant", REGULIER: "Régulier", VIP: "VIP" };
