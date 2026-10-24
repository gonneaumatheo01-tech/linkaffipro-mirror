/**
 * Seuils des alertes métier (même contrat que `apps/worker/src/maintenance/alert-rules.ts`) et interrupteurs « Alerte
 * activée » (règle commune `@linkaffipro/core`, alert-switches), tous dans le `Setting` `alerts.thresholds`.
 */
import {
  ALERT_KIND_LABELS,
  ALERT_SETTINGS_KEY,
  SWITCHABLE_ALERT_KINDS,
  disabledAlertKinds,
  type AlertSwitches,
  type SwitchableAlertKind,
} from "@linkaffipro/core";

export const ALERT_THRESHOLDS_KEY = ALERT_SETTINGS_KEY;

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

/** Nom de la case « Alerte activée » de chaque alerte dans le formulaire (valeur `on` quand elle est cochée). */
export const ALERT_SWITCH_FIELDS: Record<SwitchableAlertKind, string> = {
  registrations_drop: "registrationsDropEnabled",
  spend_no_conversion: "spendNoConversionEnabled",
  channel_leak: "channelLeakEnabled",
  agents_channel_drop: "agentsChannelDropEnabled",
  agents_persona_drop: "agentsPersonaDropEnabled",
  agents_media_low: "agentsMediaLowEnabled",
  ads_spend_spike: "adsSpendSpikeEnabled",
  ads_conversion_drop: "adsConversionDropEnabled",
  ads_cost_over_threshold: "adsCostOverThresholdEnabled",
  ads_budget_exhausted: "adsBudgetExhaustedEnabled",
};

/** Interrupteurs envoyés par le formulaire : une case décochée n'est pas envoyée, donc désactivée. */
export function switchesFromForm(form: { get(name: string): unknown }): AlertSwitches {
  const out = {} as AlertSwitches;
  for (const kind of SWITCHABLE_ALERT_KINDS)
    out[kind] = form.get(ALERT_SWITCH_FIELDS[kind]) === "on";
  return out;
}

/**
 * Nouvelle valeur du réglage : l'ancienne valeur (toute autre clé est gardée), les seuils validés et les interrupteurs.
 */
export function alertSettingsValue(
  previous: unknown,
  thresholds: AlertThresholds,
  switches: AlertSwitches,
): Record<string, unknown> {
  const base =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return { ...base, ...parseThresholds(thresholds), enabled: { ...switches } };
}

/** Message affiché après l'enregistrement : les seuils, puis ce qui est désactivé. */
export function thresholdsSavedMessage(
  thresholds: AlertThresholds,
  switches: AlertSwitches,
): string {
  const off = disabledAlertKinds(switches).map((kind) => `« ${ALERT_KIND_LABELS[kind]} »`);
  const state =
    off.length === 0
      ? "Toutes les alertes sont activées."
      : off.length === SWITCHABLE_ALERT_KINDS.length
        ? "Toutes les alertes sont désactivées : elles ne vous seront plus envoyées."
        : off.length === 1
          ? `Alerte désactivée : ${off[0]}, elle ne vous sera plus envoyée.`
          : `Alertes désactivées : ${off.join(", ")}, elles ne vous seront plus envoyées.`;
  const n = (x: number) => x.toLocaleString("fr-FR");
  return `Alertes enregistrées : chute des inscriptions ${n(thresholds.registrationsDropPct)} %, dépense sans inscription ${n(thresholds.spendNoConversionEur)} €, départs ${n(thresholds.channelLeakPct)} %. ${state} Effet au prochain passage (5 minutes).`;
}
