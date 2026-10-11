/**
 * Relances prêtes à l'emploi (Membres → Relances automatiques) : les six cartes, leurs réglages (délai, message,
 * canaux, seuil), la reconnaissance d'une règle existante et la construction de la règle à enregistrer.
 * Fonctions pures, sans base ni Telegram (testées dans cards.test.ts).
 *
 * Forme enregistrée :
 * - cartes sans condition (bienvenue, inactifs, VIP) : liste d'actions (`actions`, `graph` vide), comme avant ;
 * - cartes avec condition (clic sans inscription, inscrit sans dépôt, merci au premier dépôt) : parcours à branches
 *   (`graph`, construit par `templateGraph` du core).
 * Une règle déjà enregistrée sous forme de graphe le reste (sinon les membres en attente seraient arrêtés).
 */
import {
  AUTOMATION_TEMPLATE_DEFS,
  AUTOMATION_TEMPLATE_KEYS,
  graphNextNodeId,
  graphToLinear,
  graphTriggerNode,
  isAutomationTemplateKey,
  parseActions,
  parseConditions,
  parseGraph,
  templateGraph,
  textLength,
  TELEGRAM_TEXT_MAX,
  validateGraph,
  validateTelegramHtml,
  formatWaitHours,
  type AutomationAction,
  type AutomationConditions,
  type AutomationGraph,
  type AutomationTemplateKey,
  type AutomationTriggerKey,
  type GraphConditionKind,
  type SpendLevel,
} from "@linkaffipro/core";
import { entriesToButtons, linesToButtons, toButtonEntry, type ButtonRows } from "./node-form";

export type CardKey = AutomationTemplateKey;
export type CardMessage = Omit<Extract<AutomationAction, { type: "send_message" }>, "type">;

/** Réglages d'une carte : 2 ou 3 visibles (délai ou seuil, message, canaux), bot et média dans « Avancé ». */
export type CardSettings = {
  /** Attente avant le message (heures) ; null = tout de suite. */
  hours: number | null;
  /** « Rien fait depuis… » : nombre de jours sans activité. */
  inactiveDays: number | null;
  /** « Dépôts au-delà d'un seuil » : niveau de dépense qui déclenche le message. */
  level: SpendLevel | null;
  message: CardMessage;
  /** Canaux concernés ; vide = tous les canaux. */
  channelIds: string[];
};

/** Réglage principal d'une carte (en plus du message et des canaux). */
export type CardDelayKind = "hours" | "inactiveDays" | "level" | "none";

export type CardDef = {
  key: CardKey;
  /** Nom donné à la règle créée par la carte. */
  ruleName: string;
  /** Une phrase : ce que fait la carte. */
  description: string;
  delayKind: CardDelayKind;
  /** Libellé du réglage principal. */
  delayLabel: string;
  /** Valeurs proposées (heures, jours ou niveaux). */
  delayChoices: Array<number | null | SpendLevel>;
  /** Condition vérifiée avant le message (cartes à branches) ; null = message direct. */
  condition: GraphConditionKind | null;
  defaults: CardSettings;
};

const msg = (text: string): CardMessage => ({
  text,
  buttons: undefined,
  mediaAssetId: null,
  botId: null,
});
const base = { hours: null, inactiveDays: null, level: null, channelIds: [] } as const;

/** Les six cartes, dans l'ordre d'affichage (parcours d'un membre : arrivée → clic → inscription → dépôt). */
export const CARD_DEFS: Record<CardKey, CardDef> = {
  welcome: {
    key: "welcome",
    ruleName: "Bienvenue",
    description: "Le bot écrit un mot d'accueil en privé à chaque nouveau membre.",
    delayKind: "hours",
    delayLabel: "Quand l'envoyer",
    delayChoices: [null, 1, 3, 24],
    condition: null,
    defaults: {
      ...base,
      channelIds: [],
      message: msg(
        "Bienvenue {prenom} ! Merci d'avoir rejoint {canal}. Les meilleures offres du moment sont épinglées en haut du canal.",
      ),
    },
  },
  offer_no_signup: {
    key: "offer_no_signup",
    ruleName: "Relance après un clic sans inscription",
    description:
      "Le membre a cliqué sur une offre mais ne s'est pas inscrit : le bot le relance une fois.",
    delayKind: "hours",
    delayLabel: "Relancer après",
    delayChoices: [6, 12, 24, 48],
    condition: "registered",
    defaults: {
      ...base,
      channelIds: [],
      hours: 24,
      message: msg(
        "Bonjour {prenom}, vous avez regardé notre offre sans aller jusqu'à l'inscription. Elle est toujours disponible : une minute suffit pour en profiter.",
      ),
    },
  },
  signup_no_deposit: {
    key: "signup_no_deposit",
    ruleName: "Relance des inscrits sans dépôt",
    description: "Le membre s'est inscrit mais n'a pas encore déposé : le bot le relance une fois.",
    delayKind: "hours",
    delayLabel: "Relancer après",
    delayChoices: [24, 48, 72, 168],
    condition: "deposited",
    defaults: {
      ...base,
      channelIds: [],
      hours: 48,
      message: msg(
        "Bonjour {prenom}, votre compte est bien créé ! Il ne reste qu'une étape pour profiter du bonus de bienvenue : votre premier dépôt.",
      ),
    },
  },
  inactive_7d: {
    key: "inactive_7d",
    ruleName: "Relance des membres inactifs",
    description: "Le membre n'a rien fait depuis plusieurs jours : le bot lui donne des nouvelles.",
    delayKind: "inactiveDays",
    delayLabel: "Sans rien faire depuis",
    delayChoices: [3, 7, 14, 30],
    condition: null,
    defaults: {
      ...base,
      channelIds: [],
      inactiveDays: 7,
      message: msg(
        "Bonjour {prenom}, cela fait un moment ! De nouvelles offres sont arrivées sur {canal} : venez y jeter un œil.",
      ),
    },
  },
  first_deposit_thanks: {
    key: "first_deposit_thanks",
    ruleName: "Merci au premier dépôt",
    description: "Le bot remercie le membre dès son premier dépôt (pas aux suivants).",
    delayKind: "none",
    delayLabel: "",
    delayChoices: [],
    condition: "deposit_count_gte",
    defaults: {
      ...base,
      channelIds: [],
      message: msg(
        "Merci {prenom} ! Votre premier dépôt est bien pris en compte. Bonne chance, et n'hésitez pas si vous avez une question.",
      ),
    },
  },
  vip: {
    key: "vip",
    ruleName: "Message VIP",
    description: "Quand un membre atteint un niveau de dépôts, le bot lui envoie un message VIP.",
    delayKind: "level",
    delayLabel: "Seuil",
    delayChoices: ["REGULIER", "VIP"],
    condition: null,
    defaults: {
      ...base,
      channelIds: [],
      level: "VIP",
      message: msg(
        "Bravo {prenom}, vous faites désormais partie de nos membres VIP ! Des offres réservées vous seront proposées en priorité.",
      ),
    },
  },
};

export const CARD_KEYS: readonly CardKey[] = AUTOMATION_TEMPLATE_KEYS;

/** Libellé d'un niveau de dépense comme seuil (« Niveau VIP »). */
export const LEVEL_THRESHOLD_LABELS: Partial<Record<SpendLevel, string>> = {
  DEPOSANT: "Premier dépôt fait",
  REGULIER: "Membre régulier",
  VIP: "Niveau VIP",
};

/** Délai lisible (« 1 jour », « 2 jours », « 6 h ») ; null = « tout de suite ». */
export function delayText(hours: number | null): string {
  return hours === null ? "tout de suite" : formatWaitHours(hours);
}

function days(n: number): string {
  return `${n} jour${n >= 2 ? "s" : ""}`;
}

/** Titre de la carte, avec le délai réglé (« A cliqué une offre sans s'inscrire sous 1 jour → relance »). */
export function cardTitle(key: CardKey, s?: Pick<CardSettings, "hours" | "inactiveDays">): string {
  const hours = s?.hours ?? CARD_DEFS[key].defaults.hours;
  const inactive = s?.inactiveDays ?? CARD_DEFS[key].defaults.inactiveDays ?? 7;
  switch (key) {
    case "welcome":
      return "Bienvenue quand quelqu'un rejoint un canal";
    case "offer_no_signup":
      return `A cliqué une offre sans s'inscrire sous ${delayText(hours ?? 24)} → relance`;
    case "signup_no_deposit":
      return `Inscrit sans dépôt sous ${delayText(hours ?? 48)} → relance`;
    case "inactive_7d":
      return `Rien fait depuis ${days(inactive)} → relance`;
    case "first_deposit_thanks":
      return "Premier dépôt → merci";
    case "vip":
      return "Dépôts au-delà d'un seuil → message VIP";
  }
}

/** Choix proposés pour le réglage principal ; une valeur actuelle hors liste est ajoutée (rien ne se perd). */
export function delayChoices(
  key: CardKey,
  current: number | null | SpendLevel | undefined,
): Array<{ value: string; label: string }> {
  const def = CARD_DEFS[key];
  const list = [...def.delayChoices];
  if (current !== undefined && !list.includes(current)) list.push(current);
  const label = (v: number | null | SpendLevel): string => {
    if (def.delayKind === "level") return LEVEL_THRESHOLD_LABELS[v as SpendLevel] ?? String(v);
    if (def.delayKind === "inactiveDays") return days(Number(v));
    return v === null
      ? "Tout de suite"
      : delayText(Number(v)).replace(/^\w/, (c) => c.toUpperCase());
  };
  const sorted =
    def.delayKind === "level"
      ? list
      : [...list].sort((a, b) => (a === null ? -1 : b === null ? 1 : Number(a) - Number(b)));
  return sorted.map((v) => ({ value: v === null ? "now" : String(v), label: label(v) }));
}

/** Défauts d'une carte non encore créée (copie : modifiable sans toucher aux constantes). */
export function defaultCardSettings(key: CardKey): CardSettings {
  const d = CARD_DEFS[key].defaults;
  return { ...d, channelIds: [...d.channelIds], message: { ...d.message } };
}

// ---------- Reconnaissance ----------

export type RuleShape = {
  trigger: string;
  conditions: unknown;
  actions: unknown;
  graph?: unknown;
  templateKey?: string | null;
};

/** Conditions permises par une carte : canaux, plus jours d'inactivité (inactifs) ou niveau (VIP). */
function readConditions(
  key: CardKey,
  raw: unknown,
): Pick<CardSettings, "channelIds" | "inactiveDays" | "level"> | null {
  let c: AutomationConditions;
  try {
    c = parseConditions(raw);
  } catch {
    return null;
  }
  if (c.campaignIds?.length || c.languages?.length || c.categoryIds?.length) return null;
  if (key === "inactive_7d") {
    if (!c.inactiveDays) return null;
  } else if (c.inactiveDays !== undefined) return null;
  if (key === "vip") {
    if (c.spendLevels?.length !== 1) return null;
  } else if (c.spendLevels?.length) return null;
  return {
    channelIds: c.channelIds ?? [],
    inactiveDays: key === "inactive_7d" ? (c.inactiveDays ?? null) : null,
    level: key === "vip" ? (c.spendLevels?.[0] ?? null) : null,
  };
}

function messageOf(a: AutomationAction | undefined): CardMessage | null {
  if (a?.type !== "send_message") return null;
  return {
    text: a.text,
    buttons: a.buttons?.length ? a.buttons : undefined,
    mediaAssetId: a.mediaAssetId ?? null,
    botId: a.botId ?? null,
  };
}

/** Liste d'actions d'une carte sans condition : [attendre ?] → message. */
function readLinear(
  actions: AutomationAction[],
): { hours: number | null; message: CardMessage } | null {
  if (actions.length === 1) {
    const m = messageOf(actions[0]);
    return m ? { hours: null, message: m } : null;
  }
  if (actions.length === 2 && actions[0]?.type === "wait") {
    const m = messageOf(actions[1]);
    return m ? { hours: actions[0].hours, message: m } : null;
  }
  return null;
}

/**
 * Parcours d'une carte : départ → [attendre ?] → message (carte sans condition) ou départ → [attendre ?] → condition
 * (oui → arrêt ou rien ; non → message, puis rien). Aucun autre bloc.
 */
function readGraph(
  key: CardKey,
  graph: AutomationGraph,
): { hours: number | null; message: CardMessage } | null {
  const def = CARD_DEFS[key];
  const start = graphTriggerNode(graph);
  if (!start) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const used = new Set<string>([start.id]);
  let cur = graphNextNodeId(graph, start.id, "next");
  let hours: number | null = null;
  let node = cur ? byId.get(cur) : undefined;
  if (node?.type === "wait") {
    hours = node.hours;
    used.add(node.id);
    cur = graphNextNodeId(graph, node.id, "next");
    node = cur ? byId.get(cur) : undefined;
  }
  let message: CardMessage | null = null;
  let last: string | null = null;
  if (def.condition === null) {
    if (node?.type !== "action") return null;
    message = messageOf(node.action);
    used.add(node.id);
    last = node.id;
  } else {
    if (node?.type !== "condition" || node.condition.kind !== def.condition) return null;
    if (
      key === "first_deposit_thanks" &&
      !(node.condition.kind === "deposit_count_gte" && node.condition.n === 2)
    )
      return null;
    used.add(node.id);
    const yes = graphNextNodeId(graph, node.id, "yes");
    const no = graphNextNodeId(graph, node.id, "no");
    if (yes) {
      if (byId.get(yes)?.type !== "stop") return null;
      used.add(yes);
    }
    const target = no ? byId.get(no) : undefined;
    if (target?.type !== "action") return null;
    message = messageOf(target.action);
    used.add(target.id);
    last = target.id;
  }
  if (!message || !last || graphNextNodeId(graph, last, "next")) return null;
  if (used.size !== graph.nodes.length) return null;
  return { hours, message };
}

/**
 * Réglages d'une règle vue comme la carte `key`, ou null si la règle n'a pas exactement la forme de la carte
 * (déclencheur, filtres, parcours). Une règle à liste n'est lue que pour les cartes sans condition.
 */
export function readCardSettings(key: CardKey, rule: RuleShape): CardSettings | null {
  const def = AUTOMATION_TEMPLATE_DEFS[key];
  if (rule.trigger !== def.trigger) return null;
  const cond = readConditions(key, rule.conditions);
  if (!cond) return null;
  let body: { hours: number | null; message: CardMessage } | null = null;
  if (rule.graph !== null && rule.graph !== undefined) {
    const v = validateGraph(rule.graph);
    if (!v.ok || !v.graph) return null;
    body = readGraph(key, v.graph);
  } else {
    if (CARD_DEFS[key].condition !== null) return null;
    try {
      body = readLinear(parseActions(rule.actions));
    } catch {
      return null;
    }
  }
  if (!body) return null;
  return { ...cond, hours: body.hours, message: body.message };
}

/**
 * Carte d'une règle : celle de `templateKey` si la règle en a encore la forme ; sinon, pour une règle à liste
 * (sans parcours à branches), la première carte sans condition dont elle a exactement la forme ; sinon null
 * (relance « sur mesure »).
 */
export function recognizeCard(rule: RuleShape): CardKey | null {
  if (isAutomationTemplateKey(rule.templateKey))
    return readCardSettings(rule.templateKey, rule) ? rule.templateKey : null;
  if (rule.graph !== null && rule.graph !== undefined) return null;
  for (const key of CARD_KEYS) {
    if (CARD_DEFS[key].condition !== null) continue;
    if (readCardSettings(key, rule)) return key;
  }
  return null;
}

export type CardRule = RuleShape & { id: string; isActive: boolean; updatedAt: Date };

export type CardGroup<R extends CardRule> = {
  key: CardKey;
  /** Règle affichée et réglée par la carte (null : carte pas encore créée). */
  rule: R | null;
  settings: CardSettings;
  /** Autres règles de la même forme (affichées en lien sous la carte). */
  others: R[];
};

/**
 * Range les règles : sous chaque carte (la règle principale = celle créée par la carte, sinon l'active, sinon la
 * plus récente ; les autres en « aussi de ce type »), le reste en « sur mesure » (ordre d'origine conservé).
 */
export function groupRulesByCard<R extends CardRule>(
  rules: readonly R[],
): { cards: CardGroup<R>[]; custom: R[] } {
  const matched = new Map<CardKey, R[]>();
  const custom: R[] = [];
  for (const r of rules) {
    const key = recognizeCard(r);
    if (key) matched.set(key, [...(matched.get(key) ?? []), r]);
    else custom.push(r);
  }
  const rank = (key: CardKey, r: R) =>
    [r.templateKey === key ? 0 : 1, r.isActive ? 0 : 1, -r.updatedAt.getTime()] as const;
  const cards = CARD_KEYS.map((key): CardGroup<R> => {
    const list = [...(matched.get(key) ?? [])].sort((a, b) => {
      const ra = rank(key, a);
      const rb = rank(key, b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
    const rule = list[0] ?? null;
    return {
      key,
      rule,
      settings: (rule && readCardSettings(key, rule)) ?? defaultCardSettings(key),
      others: list.slice(1),
    };
  });
  return { cards, custom };
}

// ---------- Construction ----------

export type BuiltCardRule = {
  name: string;
  trigger: AutomationTriggerKey;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  /** null = règle à liste. */
  graph: AutomationGraph | null;
  templateKey: CardKey;
};

/**
 * Règle à enregistrer pour une carte. `existing.graph` : parcours actuel de la règle ; une règle déjà en graphe
 * reste en graphe. Les cartes avec condition sont toujours en graphe (`actions` = liste équivalente, vide ici).
 */
export function buildCardRule(
  key: CardKey,
  s: CardSettings,
  existing?: { graph?: unknown } | null,
): BuiltCardRule {
  const def = CARD_DEFS[key];
  const tpl = AUTOMATION_TEMPLATE_DEFS[key];
  const conditions = parseConditions({
    ...tpl.conditions,
    channelIds: s.channelIds,
    ...(key === "inactive_7d" ? { inactiveDays: s.inactiveDays ?? def.defaults.inactiveDays } : {}),
    ...(key === "vip" ? { spendLevels: [s.level ?? def.defaults.level] } : {}),
  });
  const message: CardMessage = {
    text: s.message.text,
    buttons: s.message.buttons?.length ? s.message.buttons : undefined,
    mediaAssetId: s.message.mediaAssetId ?? null,
    botId: s.message.botId ?? null,
  };
  const hours = def.delayKind === "hours" ? s.hours : null;
  const asGraph =
    def.condition !== null || (existing?.graph !== null && existing?.graph !== undefined);
  if (asGraph) {
    // templateGraph : « null » = délai par défaut de la carte ; une carte sans délai par défaut n'attend pas.
    const graph = templateGraph(key, { message, hours });
    // Jamais un parcours que le worker refuserait (`parseGraph`, comme `parseActions` pour une liste).
    try {
      parseGraph(graph);
    } catch (err) {
      throw new CardInputError(err instanceof Error ? err.message : String(err));
    }
    return {
      name: def.ruleName,
      trigger: tpl.trigger,
      conditions,
      actions: graphToLinear(graph) ?? [],
      graph,
      templateKey: key,
    };
  }
  const actions: AutomationAction[] = [
    ...(hours ? [{ type: "wait" as const, hours }] : []),
    { type: "send_message", ...message },
  ];
  return {
    name: def.ruleName,
    trigger: tpl.trigger,
    conditions,
    actions: parseActions(actions),
    graph: null,
    templateKey: key,
  };
}

/** Erreur de saisie d'une carte (message en français, affiché dans le volet). */
export class CardInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardInputError";
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Boutons du formulaire : `buttonsJson` (lignes saisies champ par champ dans le volet : liens { text, url } et boutons
 * « Offre (campagne) » { kind: "offer", text, campaignId, affiliateCampaignId }), sinon l'ancien champ `buttons` (une
 * ligne par bouton : « Libellé | https://… »).
 */
function buttonsFromForm(
  fd: FormData,
): { ok: true; rows: ButtonRows } | { ok: false; error: string } {
  const raw = fd.get("buttonsJson");
  if (typeof raw !== "string" || !raw.trim()) return linesToButtons(str(fd, "buttons"));
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Boutons illisibles : rechargez la page et recommencez." };
  }
  return entriesToButtons((Array.isArray(list) ? list : []).map(toButtonEntry));
}

/**
 * Lit les réglages d'une carte depuis son formulaire : `delay` (heures, « now »), `inactiveDays`, `level`, `text`,
 * `buttonsJson` (ou `buttons`, voir `buttonsFromForm`), `channelIds` (plusieurs), `botId`, `mediaAssetId`.
 * Lève `CardInputError` si un réglage est invalide.
 */
export function cardSettingsFromForm(key: CardKey, fd: FormData): CardSettings {
  const def = CARD_DEFS[key];
  const text = str(fd, "text");
  if (!text) throw new CardInputError("Écrivez le message que le bot va envoyer.");
  // Longueur visible (comme le compteur de l'éditeur) : un emoji animé compte comme son emoji, pas comme sa balise.
  if (textLength(text) > TELEGRAM_TEXT_MAX)
    throw new CardInputError("Message trop long (4 096 caractères au plus).");
  const html = validateTelegramHtml(text);
  if (!html.ok) throw new CardInputError(`Mise en forme du message à corriger : ${html.error}`);
  const buttons = buttonsFromForm(fd);
  if (!buttons.ok) throw new CardInputError(buttons.error);

  let hours: number | null = null;
  if (def.delayKind === "hours") {
    const raw = str(fd, "delay");
    if (raw === "now" || raw === "") {
      if (def.condition !== null)
        throw new CardInputError("Choisissez après combien de temps relancer.");
    } else {
      const h = Number(raw);
      if (!Number.isFinite(h) || h < 1 || h > 24 * 90)
        throw new CardInputError("Le délai doit être compris entre 1 heure et 90 jours.");
      hours = h;
    }
  }
  let inactiveDays: number | null = null;
  if (def.delayKind === "inactiveDays") {
    const n = Number(str(fd, "inactiveDays"));
    if (!Number.isInteger(n) || n < 1 || n > 365)
      throw new CardInputError("Indiquez un nombre de jours entre 1 et 365.");
    inactiveDays = n;
  }
  let level: SpendLevel | null = null;
  if (def.delayKind === "level") {
    const l = str(fd, "level");
    if (!(l in LEVEL_THRESHOLD_LABELS)) throw new CardInputError("Choisissez le seuil.");
    level = l as SpendLevel;
  }
  const channelIds = [...new Set(fd.getAll("channelIds").map(String).filter(Boolean))];
  return {
    hours,
    inactiveDays,
    level,
    channelIds,
    message: {
      text,
      buttons: buttons.rows.length ? buttons.rows : undefined,
      botId: str(fd, "botId") || null,
      mediaAssetId: str(fd, "mediaAssetId") || null,
    },
  };
}

/** Résumé des canaux d'une carte (« Tous les canaux », « Casino VIP », « 3 canaux »). */
export function channelsText(ids: readonly string[], names: Record<string, string>): string {
  if (ids.length === 0) return "Tous les canaux";
  if (ids.length === 1) return names[ids[0]!] ?? "1 canal";
  if (ids.length === 2) return ids.map((id) => names[id] ?? "canal supprimé").join(" et ");
  return `${ids.length} canaux`;
}

/** Réglage principal en une ligne (« Relancer après : 1 jour », « Seuil : niveau VIP »). */
export function delaySummary(key: CardKey, s: CardSettings): string | null {
  const def = CARD_DEFS[key];
  switch (def.delayKind) {
    case "hours":
      return `${def.delayLabel} : ${delayText(s.hours)}`;
    case "inactiveDays":
      return `${def.delayLabel} : ${days(s.inactiveDays ?? 7)}`;
    case "level":
      return `${def.delayLabel} : ${(LEVEL_THRESHOLD_LABELS[s.level ?? "VIP"] ?? "").replace(/^\w/, (c) => c.toLowerCase())}`;
    case "none":
      return null;
  }
}
