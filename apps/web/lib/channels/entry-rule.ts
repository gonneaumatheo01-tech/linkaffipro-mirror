import type { ApprovalMode, ExpireAction, GateMode } from "@linkaffipro/db";

/**
 * « Qui peut entrer et quand » (fiche canal) : règles d'affichage pures de la règle d'adhésion par défaut d'un canal.
 * - trois choix principaux (tout de suite / après un délai / après avoir rejoint ces canaux) ↔ champs de la règle ;
 * - champs envoyés à l'action serveur existante `saveRuleAction` (mêmes noms qu'avant : `mode`, `delayPreset`,
 *   `delayCustomSeconds`, `gateMode`, `gateChannelIds`, `reminderAfterMinutes`, `maxReminders`, `expireAfterHours`,
 *   `expireAction`, `sendAcceptedMessage`) ;
 * - phrases de résumé (fiche et liste des canaux).
 * Aucune dépendance serveur : utilisable dans les composants client et testé sans base.
 */

export type EntryChoice = "now" | "delay" | "gate";

export const ENTRY_CHOICES: ReadonlyArray<{ key: EntryChoice; title: string; help: string }> = [
  {
    key: "now",
    title: "Tout de suite",
    help: "Chaque demande est acceptée dès qu'elle arrive.",
  },
  {
    key: "delay",
    title: "Après un délai",
    help: "Le bot accueille la personne, puis l'accepte après le délai choisi.",
  },
  {
    key: "gate",
    title: "Après avoir rejoint ces canaux",
    help: "La personne rejoint d'abord d'autres canaux, puis elle est acceptée.",
  },
];

/** Clés de délai comprises par `saveRuleAction` (`DELAY_PRESETS` de l'action), plus « custom » (en secondes). */
export type DelayPresetKey = "immediate" | "1m" | "10m" | "1h" | "1d" | "2d" | "custom";

export const DELAY_PRESETS: ReadonlyArray<{
  key: Exclude<DelayPresetKey, "custom">;
  label: string;
  seconds: number;
}> = [
  { key: "immediate", label: "Tout de suite", seconds: 0 },
  { key: "1m", label: "1 minute", seconds: 60 },
  { key: "10m", label: "10 minutes", seconds: 600 },
  { key: "1h", label: "1 heure", seconds: 3600 },
  { key: "1d", label: "1 jour", seconds: 86400 },
  { key: "2d", label: "2 jours", seconds: 172800 },
];

/** Délai le plus long accepté par l'action serveur (30 jours). */
export const MAX_DELAY_SECONDS = 30 * 86400;

export type DelayUnit = "seconds" | "minutes" | "hours" | "days";

export const DELAY_UNITS: ReadonlyArray<{ key: DelayUnit; label: string; seconds: number }> = [
  { key: "seconds", label: "secondes", seconds: 1 },
  { key: "minutes", label: "minutes", seconds: 60 },
  { key: "hours", label: "heures", seconds: 3600 },
  { key: "days", label: "jours", seconds: 86400 },
];

/** Valeurs par défaut d'une règle (celles de la base et de l'ancien formulaire). */
export const RULE_DEFAULTS = {
  reminders: "60, 1440",
  maxReminders: 2,
  expireAfterHours: 0,
  expireAction: "KEEP" as ExpireAction,
  sendAcceptedMessage: true,
} as const;

/** Ce qu'il faut d'une règle d'adhésion pour l'afficher (ligne `ApprovalRule` relue). */
export type EntryRule = {
  mode: ApprovalMode;
  delaySeconds: number;
  gateMode: GateMode;
  gateChannelIds: string[];
  reminderAfterMinutes: number[];
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
  /** Une règle inactive est ignorée par le bot (comme une absence de règle). */
  isActive?: boolean;
};

/** État du formulaire « Qui peut entrer et quand ». */
export type EntryFormState = {
  choice: EntryChoice;
  /** Validation à la main (mode MANUAL), dans « Avancé ». */
  manual: boolean;
  delayPreset: DelayPresetKey;
  customAmount: number;
  customUnit: DelayUnit;
  gateIds: string[];
  gateMode: "REQUIRED" | "SOFT";
  /** Minutes après la demande, séparées par des virgules (« 60, 1440 »). */
  reminders: string;
  maxReminders: number;
  /** Heures ; 0 = jamais. */
  expireAfterHours: number;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
};

/** Relit une valeur JSON de la base (`gateChannelIds`, `reminderAfterMinutes`). */
export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export function minuteList(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
}

/** Ligne `ApprovalRule` de la base → `EntryRule` (JSON relu prudemment). */
export function entryRuleFromRow(row: {
  mode: ApprovalMode;
  delaySeconds: number;
  gateMode: GateMode;
  gateChannelIds: unknown;
  reminderAfterMinutes: unknown;
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
  isActive: boolean;
}): EntryRule {
  return {
    mode: row.mode,
    delaySeconds: Math.max(0, row.delaySeconds),
    gateMode: row.gateMode,
    gateChannelIds: stringList(row.gateChannelIds),
    reminderAfterMinutes: minuteList(row.reminderAfterMinutes),
    maxReminders: Math.max(0, row.maxReminders),
    expireAfterHours: row.expireAfterHours,
    expireAction: row.expireAction,
    sendAcceptedMessage: row.sendAcceptedMessage,
    isActive: row.isActive,
  };
}

/** Le bot applique-t-il cette règle ? (absente ou inactive = validation à la main, sans message privé) */
export function isRuleInForce(rule: EntryRule | null | undefined): rule is EntryRule {
  return Boolean(rule) && rule!.isActive !== false;
}

/** Délai réellement appliqué (le mode « Immédiat » ignore le délai enregistré). */
export function effectiveDelay(rule: Pick<EntryRule, "mode" | "delaySeconds">): number {
  return rule.mode === "IMMEDIATE" ? 0 : Math.max(0, rule.delaySeconds);
}

/** Des canaux à rejoindre s'appliquent-ils (même règle que le bot : `hasGate`) ? */
export function hasGate(rule: Pick<EntryRule, "gateMode" | "gateChannelIds">): boolean {
  return rule.gateMode !== "NONE" && rule.gateChannelIds.length > 0;
}

/** Clé de délai pour une durée en secondes (« custom » si ce n'est pas un des délais proposés). */
export function presetForSeconds(seconds: number): DelayPresetKey {
  return DELAY_PRESETS.find((p) => p.seconds === seconds)?.key ?? "custom";
}

/** Durée → nombre et unité les plus lisibles (5 400 s → 90 minutes ; 7 200 s → 2 heures). */
export function splitDelay(seconds: number): { amount: number; unit: DelayUnit } {
  const s = Math.max(0, Math.round(seconds));
  if (s > 0 && s % 86400 === 0) return { amount: s / 86400, unit: "days" };
  if (s > 0 && s % 3600 === 0) return { amount: s / 3600, unit: "hours" };
  if (s > 0 && s % 60 === 0) return { amount: s / 60, unit: "minutes" };
  return { amount: s, unit: "seconds" };
}

/** Nombre et unité → secondes (arrondi, jamais négatif). */
export function delayFromParts(amount: number, unit: DelayUnit): number {
  const per = DELAY_UNITS.find((u) => u.key === unit)?.seconds ?? 1;
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * per)) : 0;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`;
}

/** Durée lisible : « 10 minutes », « 1 heure », « 2 jours », « 90 secondes ». */
export function delayLabel(seconds: number): string {
  const { amount, unit } = splitDelay(seconds);
  switch (unit) {
    case "days":
      return plural(amount, "jour", "jours");
    case "hours":
      return plural(amount, "heure", "heures");
    case "minutes":
      return plural(amount, "minute", "minutes");
    default:
      return plural(amount, "seconde", "secondes");
  }
}

/** Délai de l'état du formulaire, en secondes (« Tout de suite » = 0). */
export function stateDelaySeconds(state: EntryFormState): number {
  if (state.choice === "now") return 0;
  if (state.delayPreset === "custom") return delayFromParts(state.customAmount, state.customUnit);
  return DELAY_PRESETS.find((p) => p.key === state.delayPreset)?.seconds ?? 0;
}

/** État de départ du formulaire : la règle enregistrée, ou « Après un délai de 10 minutes » s'il n'y en a pas. */
export function initialEntryState(rule: EntryRule | null | undefined): EntryFormState {
  if (!rule) {
    return {
      choice: "delay",
      manual: false,
      delayPreset: "10m",
      customAmount: 30,
      customUnit: "minutes",
      gateIds: [],
      gateMode: "REQUIRED",
      reminders: RULE_DEFAULTS.reminders,
      maxReminders: RULE_DEFAULTS.maxReminders,
      expireAfterHours: RULE_DEFAULTS.expireAfterHours,
      expireAction: RULE_DEFAULTS.expireAction,
      sendAcceptedMessage: RULE_DEFAULTS.sendAcceptedMessage,
    };
  }
  const delay = effectiveDelay(rule);
  const gate = hasGate(rule);
  const choice: EntryChoice = gate ? "gate" : delay === 0 ? "now" : "delay";
  const preset = presetForSeconds(delay);
  const custom = splitDelay(delay);
  return {
    choice,
    manual: rule.mode === "MANUAL",
    // « Après un délai » de 0 seconde n'existe pas : on propose 10 minutes si l'équipe y passe.
    delayPreset: choice === "now" ? "10m" : preset,
    customAmount: preset === "custom" ? custom.amount : 30,
    customUnit: preset === "custom" ? custom.unit : "minutes",
    gateIds: gate ? [...rule.gateChannelIds] : [],
    gateMode: rule.gateMode === "SOFT" ? "SOFT" : "REQUIRED",
    reminders: rule.reminderAfterMinutes.join(", "),
    maxReminders: rule.maxReminders,
    expireAfterHours: rule.expireAfterHours ?? 0,
    expireAction: rule.expireAction,
    sendAcceptedMessage: rule.sendAcceptedMessage,
  };
}

/**
 * Changement du choix principal. « Après un délai » sans délai (« Tout de suite » sélectionné) repart sur 10 minutes ;
 * les canaux cochés sont gardés en mémoire si l'on revient au troisième choix.
 */
export function chooseEntry(state: EntryFormState, choice: EntryChoice): EntryFormState {
  if (choice === "delay" && state.delayPreset === "immediate")
    return { ...state, choice, delayPreset: "10m" };
  return { ...state, choice };
}

/** Champs envoyés à `saveRuleAction` (noms et valeurs de l'ancien formulaire). */
export function entryFormFields(state: EntryFormState): Array<[string, string]> {
  const gate = state.choice === "gate";
  const preset: DelayPresetKey = state.choice === "now" ? "immediate" : state.delayPreset;
  const fields: Array<[string, string]> = [
    ["mode", state.manual ? "MANUAL" : state.choice === "now" ? "IMMEDIATE" : "DELAY"],
    ["delayPreset", preset],
    [
      "delayCustomSeconds",
      preset === "custom" ? String(delayFromParts(state.customAmount, state.customUnit)) : "",
    ],
    ["gateMode", gate ? state.gateMode : "NONE"],
  ];
  if (gate) for (const id of state.gateIds) fields.push(["gateChannelIds", id]);
  fields.push(
    ["reminderAfterMinutes", state.reminders],
    ["maxReminders", String(state.maxReminders)],
    ["expireAfterHours", String(state.expireAfterHours)],
    ["expireAction", state.expireAction],
  );
  if (state.sendAcceptedMessage) fields.push(["sendAcceptedMessage", "on"]);
  return fields;
}

/** Règle qu'enregistrerait le formulaire (pour la phrase de résumé en direct). Même lecture que l'action serveur. */
export function ruleFromState(state: EntryFormState): EntryRule {
  const gateIds = state.choice === "gate" ? state.gateIds : [];
  return {
    mode: state.manual ? "MANUAL" : state.choice === "now" ? "IMMEDIATE" : "DELAY",
    delaySeconds: stateDelaySeconds(state),
    gateMode: gateIds.length === 0 ? "NONE" : state.gateMode,
    gateChannelIds: gateIds,
    reminderAfterMinutes: parseReminders(state.reminders),
    maxReminders: state.maxReminders,
    expireAfterHours: state.expireAfterHours > 0 ? state.expireAfterHours : null,
    expireAction: state.expireAction,
    sendAcceptedMessage: state.sendAcceptedMessage,
  };
}

/** Ce qui empêche d'enregistrer (message à afficher), ou null. */
export function entryProblem(state: EntryFormState): string | null {
  if (state.choice === "gate" && state.gateIds.length === 0)
    return "Cochez au moins un canal à rejoindre, ou choisissez une autre façon d'entrer.";
  if (state.choice !== "now" && state.delayPreset === "custom") {
    const s = delayFromParts(state.customAmount, state.customUnit);
    if (state.choice === "delay" && s <= 0) return "Indiquez une durée supérieure à zéro.";
    if (s > MAX_DELAY_SECONDS) return "Le délai ne peut pas dépasser 30 jours.";
  }
  if (!Number.isInteger(state.maxReminders) || state.maxReminders < 0 || state.maxReminders > 10)
    return "Le nombre de rappels doit être compris entre 0 et 10.";
  if (
    !Number.isInteger(state.expireAfterHours) ||
    state.expireAfterHours < 0 ||
    state.expireAfterHours > 1440
  )
    return "L'expiration doit être comprise entre 0 et 1 440 heures (60 jours).";
  return null;
}

/** Nombre de réglages « Avancé » qui s'écartent des valeurs par défaut (affiché quand le bloc est replié). */
export function advancedModifiedCount(state: EntryFormState): number {
  let n = 0;
  if (state.manual) n++;
  if (parseReminders(state.reminders).join(",") !== "60,1440") n++;
  if (state.maxReminders !== RULE_DEFAULTS.maxReminders) n++;
  if (state.expireAfterHours !== RULE_DEFAULTS.expireAfterHours) n++;
  if (state.expireAction !== RULE_DEFAULTS.expireAction) n++;
  if (state.sendAcceptedMessage !== RULE_DEFAULTS.sendAcceptedMessage) n++;
  return n;
}

/** Même lecture des rappels que l'action serveur (« 60, 1440 » → [60, 1440]). */
export function parseReminders(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** Phrase des rappels : « 2 rappels : 1 heure puis 1 jour après la demande. » */
export function remindersSentence(minutes: number[], max: number): string {
  const sent = minutes.slice(0, Math.max(0, max));
  if (sent.length === 0) return "Aucun rappel.";
  const parts = sent.map((m) => delayLabel(m * 60));
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} puis ${parts.at(-1)}`;
  return `${sent.length === 1 ? "1 rappel" : `${sent.length} rappels`} : ${list} après la demande.`;
}

/** Phrase de l'expiration, ou null si la demande n'expire jamais. */
export function expirationSentence(
  rule: Pick<EntryRule, "expireAfterHours" | "expireAction">,
): string | null {
  const h = rule.expireAfterHours ?? 0;
  if (h <= 0) return null;
  const after = delayLabel(h * 3600);
  switch (rule.expireAction) {
    case "APPROVE":
      return `Une demande toujours en attente après ${after} est acceptée quand même.`;
    case "DECLINE":
      return `Une demande toujours en attente après ${after} est refusée.`;
    default:
      return `Après ${after}, une demande en attente n'est plus suivie (elle reste en attente dans Telegram).`;
  }
}

/** « « A » », « « A » et « B » », « « A », « B » et « C » », au-delà : « « A », « B » et 3 autres canaux ». */
export function channelList(titles: string[]): string {
  const q = titles.map((t) => `« ${t} »`);
  if (q.length === 0) return "aucun canal";
  if (q.length === 1) return q[0]!;
  if (q.length <= 3) return `${q.slice(0, -1).join(", ")} et ${q.at(-1)}`;
  const rest = q.length - 2;
  return `${q.slice(0, 2).join(", ")} et ${rest} autres canaux`;
}

/** Phrase affichée quand le canal n'a pas de règle (ou une règle inactive). */
export const NO_RULE_SENTENCE =
  "Aucune règle : les demandes attendent votre validation (onglet Demandes).";

/**
 * Phrase de résumé en haut de « Qui peut entrer et quand » :
 * « Les demandes sont acceptées 10 minutes après, sans condition. »
 * `titles` : titre de chaque canal à rejoindre (par identifiant) ; un canal inconnu compte comme « un canal ».
 */
export function entrySentence(
  rule: EntryRule | null | undefined,
  titles: Record<string, string> = {},
): string {
  if (!isRuleInForce(rule)) return NO_RULE_SENTENCE;
  const delay = effectiveDelay(rule);
  const gate = hasGate(rule);
  const named = rule.gateChannelIds.map((id) => titles[id] ?? "un autre canal");
  const list = channelList(named);
  if (rule.mode === "MANUAL") {
    const base = "Les demandes attendent votre validation (onglet Demandes).";
    if (!gate) return base;
    return rule.gateMode === "REQUIRED"
      ? `${base} Le bot demande d'abord de rejoindre ${list}.`
      : `${base} Le bot propose aussi de rejoindre ${list}.`;
  }
  const when = delay === 0 ? "tout de suite" : `${delayLabel(delay)} après`;
  if (!gate) return `Les demandes sont acceptées ${when}, sans condition.`;
  if (rule.gateMode === "REQUIRED")
    return delay === 0
      ? `Les demandes sont acceptées dès que la personne a rejoint ${list}.`
      : `Les demandes sont acceptées ${delayLabel(delay)} après que la personne a rejoint ${list}.`;
  return `Les demandes sont acceptées ${when} ; le bot propose aussi de rejoindre ${list}.`;
}

/** Une phrase courte pour la liste des canaux : « Acceptés après 10 minutes ». */
export function entryShort(rule: EntryRule | null | undefined): string {
  if (!isRuleInForce(rule)) return "Aucune règle : validation à la main";
  if (rule.mode === "MANUAL") return "Validation à la main";
  const delay = effectiveDelay(rule);
  const n = rule.gateChannelIds.length;
  const canaux = `${n} ${n > 1 ? "canaux" : "canal"}`;
  if (!hasGate(rule))
    return delay === 0 ? "Acceptés tout de suite" : `Acceptés après ${delayLabel(delay)}`;
  if (rule.gateMode === "REQUIRED")
    return delay === 0
      ? `Acceptés après avoir rejoint ${canaux}`
      : `Acceptés ${delayLabel(delay)} après avoir rejoint ${canaux}`;
  return delay === 0
    ? `Acceptés tout de suite, ${canaux} proposé${n > 1 ? "s" : ""}`
    : `Acceptés après ${delayLabel(delay)}, ${canaux} proposé${n > 1 ? "s" : ""}`;
}

/** Rappels proposés en pastilles (minutes après la demande), dans le bloc « Avancé ». */
export const REMINDER_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 heure" },
  { minutes: 360, label: "6 heures" },
  { minutes: 1440, label: "1 jour" },
  { minutes: 2880, label: "2 jours" },
];

/** Rappel le plus tardif accepté par l'écran (30 jours après la demande). */
export const MAX_REMINDER_MINUTES = 30 * 1440;

/**
 * Coche ou décoche un rappel dans le champ envoyé à l'action serveur (« 60, 1440 ») : sans doublon, du plus tôt au
 * plus tard (le worker envoie les rappels dans l'ordre de la liste).
 */
export function toggleReminder(text: string, minutes: number, on: boolean): string {
  const set = new Set(parseReminders(text));
  if (on) set.add(minutes);
  else set.delete(minutes);
  return [...set].sort((a, b) => a - b).join(", ");
}

/** Pastilles de rappels à afficher : les rappels proposés, puis les autres rappels déjà enregistrés. */
export function reminderChips(
  text: string,
): Array<{ minutes: number; label: string; checked: boolean }> {
  const chosen = new Set(parseReminders(text));
  const presets = REMINDER_PRESETS.map((p) => ({ ...p, checked: chosen.has(p.minutes) }));
  const extra = [...chosen]
    .filter((m) => !REMINDER_PRESETS.some((p) => p.minutes === m))
    .sort((a, b) => a - b)
    .map((m) => ({ minutes: m, label: m === 0 ? "Aussitôt" : delayLabel(m * 60), checked: true }));
  return [...presets, ...extra];
}

/** Canal proposé dans « Les canaux à rejoindre ». `unavailable` : coché dans la règle mais inactif ou supprimé. */
export type GateChannelChoice = {
  id: string;
  title: string;
  vertical: string | null;
  isMediaLibrary: boolean;
  unavailable?: "inactive" | "deleted";
};

/**
 * Liste des canaux à cocher : les canaux actifs, précédés des canaux que la règle demande encore mais qui sont
 * inactifs ou supprimés (cochés, décochables). Le bot continue de les demander tant qu'ils restent dans la règle :
 * l'équipe doit les voir pour pouvoir les retirer, et le compteur « N choisis » correspond aux cases affichées.
 */
export function gateChannelChoices(
  active: ReadonlyArray<Omit<GateChannelChoice, "unavailable">>,
  gateIds: readonly string[],
  /** Canaux de la règle relus en base (actifs ou non) ; un identifiant absent = canal supprimé. */
  known: ReadonlyArray<Omit<GateChannelChoice, "unavailable"> & { isActive: boolean }>,
): GateChannelChoice[] {
  const activeIds = new Set(active.map((c) => c.id));
  const missing: GateChannelChoice[] = [];
  for (const id of new Set(gateIds)) {
    if (activeIds.has(id)) continue;
    const k = known.find((c) => c.id === id);
    if (k) {
      const { isActive, ...rest } = k;
      missing.push(isActive ? rest : { ...rest, unavailable: "inactive" });
    } else
      missing.push({
        id,
        title: "Canal supprimé",
        vertical: null,
        isMediaLibrary: false,
        unavailable: "deleted",
      });
  }
  return [...missing, ...active];
}

/** Unités d'un rappel « Autre délai » (minutes après la demande). */
export const REMINDER_UNITS: ReadonlyArray<{
  key: Exclude<DelayUnit, "seconds">;
  label: string;
  minutes: number;
}> = [
  { key: "minutes", label: "minutes", minutes: 1 },
  { key: "hours", label: "heures", minutes: 60 },
  { key: "days", label: "jours", minutes: 1440 },
];

/** « Autre délai » de rappel → minutes, ou null si la durée n'est pas un nombre entier entre 1 minute et 30 jours. */
export function customReminderMinutes(
  amount: number,
  unit: Exclude<DelayUnit, "seconds">,
): number | null {
  const per = REMINDER_UNITS.find((u) => u.key === unit)?.minutes ?? 1;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const m = Math.round(amount * per);
  return m >= 1 && m <= MAX_REMINDER_MINUTES ? m : null;
}
