/** Seuils des alertes métier (même contrat que `apps/worker/src/maintenance/alert-rules.ts`), `Setting` `alerts.thresholds`. */

export const ALERT_THRESHOLDS_KEY = "alerts.thresholds";

export type AlertThresholds = {
  /** Chute des inscriptions : alerte si les 24 dernières heures sont sous (100 − X) % de la moyenne des 7 jours précédents. */
  registrationsDropPct: number;
  /** Dépense sans conversion : alerte si une pub a coûté plus de X € sur 24 h sans aucune inscription. */
  spendNoConversionEur: number;
  /** Canal qui fuit : alerte si les départs sur 24 h dépassent X % des membres actifs (20 membres minimum). */
  channelLeakPct: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  registrationsDropPct: 50,
  spendNoConversionEur: 50,
  channelLeakPct: 10,
};

/** Lit les seuils depuis la valeur JSON du réglage ; chaque champ absent ou invalide prend sa valeur par défaut. */
export function parseThresholds(value: unknown): AlertThresholds {
  const v = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof AlertThresholds, unknown>
  >;
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : fallback;
  return {
    registrationsDropPct: num(
      v.registrationsDropPct,
      DEFAULT_THRESHOLDS.registrationsDropPct,
      1,
      100,
    ),
    spendNoConversionEur: num(
      v.spendNoConversionEur,
      DEFAULT_THRESHOLDS.spendNoConversionEur,
      0,
      1_000_000,
    ),
    channelLeakPct: num(v.channelLeakPct, DEFAULT_THRESHOLDS.channelLeakPct, 1, 100),
  };
}
