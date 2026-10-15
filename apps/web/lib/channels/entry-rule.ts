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
export type DelayPresetKey = "immediate" | "1m" | "5m" | "10m" | "1h" | "1d" | "2d" | "custom";

export type DelayPreset = {
  key: Exclude<DelayPresetKey, "custom">;
  label: string;
  seconds: number;
};

/** Délais de « Après un délai » (« Tout de suite » n'y est pas proposé : c'est le premier choix). */
export const DELAY_PRESETS: readonly DelayPreset[] = [
  { key: "immediate", label: "Tout de suite", seconds: 0 },
  { key: "1m", label: "1 minute", seconds: 60 },
  { key: "5m", label: "5 minutes", seconds: 300 },
  { key: "10m", label: "10 minutes", seconds: 600 },
  { key: "1h", label: "1 heure", seconds: 3600 },
  { key: "1d", label: "1 jour", seconds: 86400 },
  { key: "2d", label: "2 jours", seconds: 172800 },
];

/**
 * « Puis accepter » de « Après avoir rejoint ces canaux » (phase 11) : le délai part du moment où tous les canaux sont
 * rejoints (vu par le bot tout seul depuis la phase 14, ou au clic sur « ✅ J'ai rejoint »).
 * Une valeur enregistrée hors de ces choix (ex. 10 minutes) s'affiche en « Sur mesure », sans être perdue.
 */
export const GATE_DELAY_PRESETS: readonly DelayPreset[] = [
  { key: "immediate", label: "Tout de suite", seconds: 0 },
  { key: "5m", label: "5 minutes", seconds: 300 },
  { key: "1h", label: "1 heure", seconds: 3600 },
  { key: "1d", label: "1 jour", seconds: 86400 },
];

/** Libellé du délai sur mesure (un nombre et une unité). */
export const CUSTOM_DELAY_LABEL = "Sur mesure";

/** Délai le plus long accepté par l'action serveur (30 jours). */
export const MAX_DELAY_SECONDS = 30 * 86400;

export type DelayUnit = "seconds" | "minutes" | "hours" | "days";

export const DELAY_UNITS: ReadonlyArray<{ key: DelayUnit; label: string; seconds: number }> = [
  { key: "seconds", label: "secondes", seconds: 1 },
  { key: "minutes", label: "minutes", seconds: 60 },
  { key: "hours", label: "heures", seconds: 3600 },
  { key: "days", label: "jours", seconds: 86400 },
];

/**
 * Rappels d'une nouvelle règle (phase 14) : 4 minutes, tant que Telegram laisse encore le bot écrire à la personne
 * (5 minutes après sa demande), puis 1 heure. Les règles déjà enregistrées gardent leurs rappels.
 */
export const NEW_RULE_REMINDERS = "4, 60";

/** Anciens rappels par défaut (avant la phase 14) : 1 heure puis 1 jour. */
export const LEGACY_REMINDERS = "60, 1440";

/** Valeurs par défaut d'une nouvelle règle. */
export const RULE_DEFAULTS = {
  reminders: NEW_RULE_REMINDERS,
  maxReminders: 2,
  expireAfterHours: 0,
  expireAction: "KEEP" as ExpireAction,
  sendAcceptedMessage: true,
  sendWelcome: true,
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
  /**
   * Message privé à l'arrivée de la demande (phase 11 ; absent = oui). Toujours envoyé quand des canaux sont à
   * rejoindre : il porte leurs boutons.
   */
  sendWelcome?: boolean;
  /** Une règle inactive est ignorée par le bot (comme une absence de règle). */
  isActive?: boolean;
};

/** État du formulaire « Qui peut entrer et quand ». */
export type EntryFormState = {
  choice: EntryChoice;
  /** Validation à la main (mode MANUAL), dans « Avancé ». */
  manual: boolean;
  /** Délai de « Après un délai » (`DELAY_PRESETS`, ou « custom » : `customAmount` + `customUnit`). */
  delayPreset: DelayPresetKey;
  customAmount: number;
  customUnit: DelayUnit;
  /** « Puis accepter » de « Après avoir rejoint ces canaux » (`GATE_DELAY_PRESETS`, ou « custom »). */
  gateDelayPreset: DelayPresetKey;
  gateCustomAmount: number;
  gateCustomUnit: DelayUnit;
  gateIds: string[];
  gateMode: "REQUIRED" | "SOFT";
  /** Minutes après la demande, séparées par des virgules (« 60, 1440 »). */
  reminders: string;
  maxReminders: number;
  /** Heures ; 0 = jamais. */
  expireAfterHours: number;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
  /** Message à l'arrivée de la demande (Avancé). */
  sendWelcome: boolean;
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
  sendWelcome?: boolean;
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
    sendWelcome: row.sendWelcome !== false,
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
export function presetForSeconds(
  seconds: number,
  presets: readonly DelayPreset[] = DELAY_PRESETS,
): DelayPresetKey {
  return presets.find((p) => p.seconds === seconds)?.key ?? "custom";
}

/** Clé « puis accepter » pour une durée (« custom » hors de tout de suite / 5 min / 1 h / 1 jour). */
export function gatePresetForSeconds(seconds: number): DelayPresetKey {
  return presetForSeconds(seconds, GATE_DELAY_PRESETS);
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

/** Clé de délai du choix en cours (« immediate » pour « Tout de suite »). */
function activePreset(state: EntryFormState): DelayPresetKey {
  if (state.choice === "now") return "immediate";
  return state.choice === "gate" ? state.gateDelayPreset : state.delayPreset;
}

/** Délai sur mesure du choix en cours, en secondes. */
function activeCustomSeconds(state: EntryFormState): number {
  return state.choice === "gate"
    ? delayFromParts(state.gateCustomAmount, state.gateCustomUnit)
    : delayFromParts(state.customAmount, state.customUnit);
}

/** Délai de l'état du formulaire, en secondes (« Tout de suite » = 0). */
export function stateDelaySeconds(state: EntryFormState): number {
  const preset = activePreset(state);
  if (preset === "custom") return activeCustomSeconds(state);
  return [...DELAY_PRESETS, ...GATE_DELAY_PRESETS].find((p) => p.key === preset)?.seconds ?? 0;
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
      gateDelayPreset: "immediate",
      gateCustomAmount: 10,
      gateCustomUnit: "minutes",
      gateIds: [],
      gateMode: "REQUIRED",
      reminders: RULE_DEFAULTS.reminders,
      maxReminders: RULE_DEFAULTS.maxReminders,
      expireAfterHours: RULE_DEFAULTS.expireAfterHours,
      expireAction: RULE_DEFAULTS.expireAction,
      sendAcceptedMessage: RULE_DEFAULTS.sendAcceptedMessage,
      sendWelcome: RULE_DEFAULTS.sendWelcome,
    };
  }
  const delay = effectiveDelay(rule);
  const gate = hasGate(rule);
  const choice: EntryChoice = gate ? "gate" : delay === 0 ? "now" : "delay";
  const custom = splitDelay(delay);
  // Chaque choix garde son propre délai : « Après un délai » (10 minutes si rien n'est enregistré : un délai de 0
  // seconde n'existe pas) et « puis accepter » (tout de suite si rien n'est enregistré). Un délai enregistré hors des
  // choix proposés passe en sur mesure, sans être perdu.
  const delayPreset: DelayPresetKey = choice === "delay" ? presetForSeconds(delay) : "10m";
  const gateDelayPreset: DelayPresetKey =
    choice === "gate" ? gatePresetForSeconds(delay) : "immediate";
  return {
    choice,
    manual: rule.mode === "MANUAL",
    delayPreset,
    customAmount: delayPreset === "custom" ? custom.amount : 30,
    customUnit: delayPreset === "custom" ? custom.unit : "minutes",
    gateDelayPreset,
    gateCustomAmount: gateDelayPreset === "custom" ? custom.amount : 10,
    gateCustomUnit: gateDelayPreset === "custom" ? custom.unit : "minutes",
    gateIds: gate ? [...rule.gateChannelIds] : [],
    gateMode: rule.gateMode === "SOFT" ? "SOFT" : "REQUIRED",
    reminders: rule.reminderAfterMinutes.join(", "),
    maxReminders: rule.maxReminders,
    expireAfterHours: rule.expireAfterHours ?? 0,
    expireAction: rule.expireAction,
    sendAcceptedMessage: rule.sendAcceptedMessage,
    sendWelcome: rule.sendWelcome !== false,
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

/**
 * Champs envoyés à `saveRuleAction` (noms et valeurs de l'ancien formulaire, plus `sendWelcome` « on » / « off ») :
 * le délai envoyé est celui du choix en cours (« puis accepter » pour « Après avoir rejoint ces canaux »).
 */
export function entryFormFields(state: EntryFormState): Array<[string, string]> {
  const gate = state.choice === "gate";
  const preset = activePreset(state);
  const fields: Array<[string, string]> = [
    ["mode", state.manual ? "MANUAL" : state.choice === "now" ? "IMMEDIATE" : "DELAY"],
    ["delayPreset", preset],
    ["delayCustomSeconds", preset === "custom" ? String(activeCustomSeconds(state)) : ""],
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
  fields.push(["sendWelcome", state.sendWelcome ? "on" : "off"]);
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
    sendWelcome: state.sendWelcome,
  };
}

/** Ce qui empêche d'enregistrer (message à afficher), ou null. */
export function entryProblem(state: EntryFormState): string | null {
  if (state.choice === "gate" && state.gateIds.length === 0)
    return "Cochez au moins un canal à rejoindre, ou choisissez une autre façon d'entrer.";
  if (state.choice !== "now" && activePreset(state) === "custom") {
    const s = activeCustomSeconds(state);
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

/**
 * Case « Envoyer un message à l'arrivée de la demande » (Avancé) : elle montre toujours ce qui est enregistré, et reste
 * modifiable avec des canaux à rejoindre. Le bot envoie toujours l'accueil complet à une personne qui a des canaux à
 * rejoindre (il porte leurs boutons), mais la case compte pour celles qui n'en ont aucun : avec la règle par défaut,
 * une personne venue du bouton « canal à rejoindre » d'un autre canal n'a pas ses canaux à rejoindre ; décoché, elle ne
 * reçoit aucun message (`welcomeKindFor`, `effectiveGateChannelIds`).
 */
export function welcomeOption(
  state: Pick<EntryFormState, "choice" | "sendWelcome">,
  opts: { variant?: "default" | "exception"; help?: string } = {},
): { checked: boolean; disabled: boolean; help: string } {
  const gate = state.choice === "gate";
  const always =
    "Les personnes qui ont des canaux à rejoindre reçoivent toujours l'accueil (il porte les boutons).";
  return {
    checked: state.sendWelcome,
    disabled: false,
    help: gate
      ? opts.variant === "exception"
        ? `${always} Décoché : une personne qui n'en a finalement aucun à rejoindre (elle vient du seul canal coché) ne reçoit aucun message.`
        : `${always} Décoché : une personne venue du bouton « canal à rejoindre » d'un autre canal ne reçoit aucun message.`
      : (opts.help ??
        "Le message d'accueil de l'onglet « Ce que dit le bot ». Décoché : le bot n'écrit pas à la personne à son arrivée."),
  };
}

/** Nombre de réglages « Avancé » qui s'écartent des valeurs par défaut (affiché quand le bloc est replié). */
export function advancedModifiedCount(state: EntryFormState): number {
  let n = 0;
  if (state.manual) n++;
  // Les rappels d'une nouvelle règle et les anciens rappels par défaut ne comptent pas comme un réglage modifié.
  const reminders = parseReminders(state.reminders).join(",");
  if (
    reminders !== parseReminders(NEW_RULE_REMINDERS).join(",") &&
    reminders !== parseReminders(LEGACY_REMINDERS).join(",")
  )
    n++;
  if (state.maxReminders !== RULE_DEFAULTS.maxReminders) n++;
  if (state.expireAfterHours !== RULE_DEFAULTS.expireAfterHours) n++;
  if (state.expireAction !== RULE_DEFAULTS.expireAction) n++;
  if (state.sendAcceptedMessage !== RULE_DEFAULTS.sendAcceptedMessage) n++;
  if (state.sendWelcome !== RULE_DEFAULTS.sendWelcome) n++;
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
  { minutes: 4, label: "4 minutes" },
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
  /**
   * Canaux de la règle ENREGISTRÉE (par défaut `gateIds`) : les canaux actifs déjà choisis passent en tête, dans
   * l'ordre de la règle (on voit lesquels sont cochés sans faire défiler). Figé pendant la saisie : une case cochée ou
   * décochée ne fait pas sauter la liste.
   */
  pinned: readonly string[] = gateIds,
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
  const order = [...new Set(pinned)];
  const first = order
    .map((id) => active.find((c) => c.id === id))
    .filter((c): c is (typeof active)[number] => !!c);
  const rest = active.filter((c) => !order.includes(c.id));
  return [...missing, ...first, ...rest];
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

/** « 1 exception », « 3 exceptions » (exceptions selon la provenance actives). */
export function exceptionsCountLabel(n: number): string {
  return `${n.toLocaleString("fr-FR")} exception${n > 1 ? "s" : ""}`;
}

/**
 * Résumé court de la liste des canaux, avec les exceptions actives selon la provenance :
 * « Acceptés après 5 minutes · 1 exception ».
 */
export function entryShortWithExceptions(
  rule: EntryRule | null | undefined,
  exceptions: number,
): string {
  const short = entryShort(rule);
  return exceptions > 0 ? `${short} · ${exceptionsCountLabel(exceptions)}` : short;
}

/**
 * Rappels d'une règle copiée (nouvelle exception, phase 14) : les anciens rappels par défaut (1 heure puis 1 jour)
 * deviennent ceux d'une nouvelle règle (4 minutes puis 1 heure) ; des rappels choisis par l'équipe restent tels quels.
 */
export function freshReminders(reminders: string): string {
  const sorted = [...parseReminders(reminders)].sort((a, b) => a - b).join(",");
  return sorted === parseReminders(LEGACY_REMINDERS).join(",") ? NEW_RULE_REMINDERS : reminders;
}

/** À côté du réglage des rappels : ils ne partent qu'avec des canaux obligatoires. */
export const REMINDERS_ONLY_REQUIRED = "Les rappels n'existent qu'avec des canaux obligatoires.";

/** À côté du réglage des rappels : la fenêtre de 5 minutes de Telegram après la demande. */
export const REMINDERS_LATE_NOTE =
  "Après 5 minutes, Telegram ne transmet vos rappels qu'aux personnes qui ont déjà écrit au bot.";

/** Telegram laisse le bot écrire à une personne pendant 5 minutes après sa demande (même sans « Démarrer »). */
export const DM_WINDOW_MINUTES = 5;

/**
 * Lignes d'aide sous les rappels (bloc « Avancé ») : ce qui partira, puis les deux limites (canaux obligatoires
 * seulement ; après 5 minutes, seulement aux personnes qui ont déjà écrit au bot) et, si aucun rappel ne part avant
 * 5 minutes, le conseil de cocher « 4 minutes ».
 */
export function remindersHelp(
  state: Pick<EntryFormState, "manual" | "choice" | "gateMode" | "reminders" | "maxReminders">,
): string[] {
  if (state.manual) return ["Aucun rappel ne part tant que vous validez vous-même chaque demande."];
  if (state.choice !== "gate" || state.gateMode !== "REQUIRED")
    return [`${REMINDERS_ONLY_REQUIRED} Avec ce choix, aucun rappel ne part.`];
  const minutes = parseReminders(state.reminders);
  const sent = minutes.slice(0, Math.max(0, state.maxReminders));
  const lines = [
    remindersSentence(minutes, state.maxReminders),
    REMINDERS_ONLY_REQUIRED,
    REMINDERS_LATE_NOTE,
  ];
  if (sent.length > 0 && !sent.some((m) => m < DM_WINDOW_MINUTES))
    lines.push("Cochez « 4 minutes » : un rappel avant 5 minutes arrive à tout le monde.");
  return lines;
}
