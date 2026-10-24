/**
 * Interrupteurs des alertes sur les chiffres (Réglages → Alertes) : chacune des trois alertes à seuil peut être coupée.
 * Stockés dans le même `Setting` que les seuils (`alerts.thresholds`), sous la clé `enabled` :
 * `{ registrations_drop: boolean, spend_no_conversion: boolean, channel_leak: boolean }`. Une clé absente ou qui n'est
 * pas un booléen vaut « activée » (réglage d'avant les interrupteurs, valeur abîmée). Règle unique pour le site
 * (formulaire) et le worker (passage d'alertes : une alerte coupée n'est plus évaluée, et une alerte ouverte de ce type
 * se ferme au passage suivant). Les autres alertes (bot, synchro, sauvegarde…) ne se coupent pas.
 */

/** Clé du `Setting` qui porte les seuils et les interrupteurs. */
export const ALERT_SETTINGS_KEY = "alerts.thresholds";

/** Types d'alerte qui peuvent être désactivés (`Alert.kind`). */
export const SWITCHABLE_ALERT_KINDS = [
  "registrations_drop",
  "spend_no_conversion",
  "channel_leak",
  // Équipe Algorithme (phase 21) : canal qui décroche, profil de conversation qui ne convertit plus.
  "agents_channel_drop",
  "agents_persona_drop",
  // Équipe Casino (phase 22) : thème d'un canal sous le seuil de vidéos non utilisées.
  "agents_media_low",
  // Agent Ads (phase 24) : dépense anormale, chute des inscriptions, coût trop élevé, budget du jour atteint.
  "ads_spend_spike",
  "ads_conversion_drop",
  "ads_cost_over_threshold",
  "ads_budget_exhausted",
] as const;

export type SwitchableAlertKind = (typeof SWITCHABLE_ALERT_KINDS)[number];

/** `true` = alerte activée. */
export type AlertSwitches = Record<SwitchableAlertKind, boolean>;

/** Par défaut, tout est activé. */
export const DEFAULT_ALERT_SWITCHES: Readonly<AlertSwitches> = Object.freeze({
  registrations_drop: true,
  spend_no_conversion: true,
  channel_leak: true,
  agents_channel_drop: true,
  agents_persona_drop: true,
  agents_media_low: true,
  ads_spend_spike: true,
  ads_conversion_drop: true,
  ads_cost_over_threshold: true,
  ads_budget_exhausted: true,
});

/** Ce type d'alerte a-t-il un interrupteur ? */
export function isSwitchableAlertKind(kind: string): kind is SwitchableAlertKind {
  return (SWITCHABLE_ALERT_KINDS as readonly string[]).includes(kind);
}

/**
 * Lit les interrupteurs depuis la valeur JSON du réglage (`value.enabled`). Seul un `false` explicite désactive une
 * alerte : clé absente, `null`, texte ou nombre = activée.
 */
export function parseAlertSwitches(value: unknown): AlertSwitches {
  const enabled =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { enabled?: unknown }).enabled
      : undefined;
  const raw =
    enabled && typeof enabled === "object" && !Array.isArray(enabled)
      ? (enabled as Record<string, unknown>)
      : {};
  const out = { ...DEFAULT_ALERT_SWITCHES };
  for (const kind of SWITCHABLE_ALERT_KINDS) out[kind] = raw[kind] !== false;
  return out;
}

/** Une alerte de ce type peut-elle être créée ? Toujours oui pour les types sans interrupteur. */
export function isAlertKindEnabled(switches: AlertSwitches, kind: string): boolean {
  return isSwitchableAlertKind(kind) ? switches[kind] : true;
}

/** Types désactivés, dans l'ordre de `SWITCHABLE_ALERT_KINDS`. */
export function disabledAlertKinds(switches: AlertSwitches): SwitchableAlertKind[] {
  return SWITCHABLE_ALERT_KINDS.filter((kind) => !switches[kind]);
}
