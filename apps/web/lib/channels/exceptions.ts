import {
  SOURCE_KINDS,
  exceptionCondition,
  orderRules,
  pickRuleForProvenance,
  placeNewRule,
  shadowingRule,
  type RuleScope,
  type ScopedRule,
  type SourceKind,
} from "@linkaffipro/core";
import {
  channelList,
  delayLabel,
  effectiveDelay,
  freshReminders,
  hasGate,
  presetForSeconds,
  splitDelay,
  stateDelaySeconds,
  type EntryFormState,
  type EntryRule,
} from "./entry-rule";

/**
 * « Exceptions selon la provenance » (fiche canal → « Qui peut entrer et quand », phase 11) : règles d'affichage et de
 * saisie pures, testées sans base. La résolution elle-même (quelle règle s'applique à qui) vient de
 * `packages/core/src/provenance.ts`, la même que celle du bot.
 * - menu « Si la personne vient… » (clé `channel:<id>` / `kind:<type>` / `link:<id>` / `affiliate:<id>`) ↔ portée et
 *   cible de la règle ; phase 13 : affiliés Link Affi (n'importe quel affilié, un affilié précis, une campagne
 *   d'affilié précise = le lien LINKAFFI de la campagne) ;
 * - textes : condition, libellé enregistré (« Venu de « Tir Cadré » »), phrase de résumé, délai court ;
 * - garde-fous : pas deux exceptions pour la même provenance, exception masquée (« jamais utilisée ») ;
 * - ordre : déplacement dans un même niveau seulement, numéros 10, 20, 30…
 */

/** Portée d'une exception (toute règle qui n'est pas la règle par défaut). */
export type ExceptionScope = Exclude<RuleScope, "DEFAULT">;

/** Ce que vise une exception : un lien précis, un de nos canaux, un type de provenance, ou un affilié Link Affi. */
export type ExceptionTarget = {
  scope: ExceptionScope;
  sourceChannelId: string | null;
  sourceKind: SourceKind | null;
  inviteLinkId: string | null;
  /** Affilié Link Affi précis (exception `SOURCE_KIND` = LINKAFFI_AFFILIATE, phase 13). */
  linkaffiAffiliateId: string | null;
};

/** Une exception telle que l'écran la montre (ligne `ApprovalRule` relue, sérialisable). */
export type ExceptionItem = ScopedRule & {
  scope: ExceptionScope;
  /** Libellé enregistré (« Venu de « Tir Cadré » ») ; l'écran recalcule la condition avec les noms du moment. */
  label: string | null;
  rule: EntryRule;
  updatedAt: string;
};

/** Noms affichés : titres de nos canaux et noms des liens, par identifiant. */
export type NameMaps = {
  titles: Readonly<Record<string, string>>;
  linkNames: Readonly<Record<string, string>>;
  /** Noms des affiliés Link Affi par identifiant Link Affi (phase 13). */
  affiliateNames?: Readonly<Record<string, string>>;
  /** Liens des campagnes Telegram d'affiliés (LINKAFFI), par identifiant de lien : campagne et affilié. */
  affiliateLinks?: Readonly<Record<string, { campaignName: string; affiliateName: string }>>;
};

/** Niveaux des exceptions, du plus précis au plus général (même ordre que le bot). */
export const EXCEPTION_LEVELS: readonly ExceptionScope[] = [
  "INVITE_LINK",
  "SOURCE_CHANNEL",
  "SOURCE_KIND",
];

/** Titre de chaque niveau dans la liste des exceptions. */
export const LEVEL_TITLES: Record<ExceptionScope, string> = {
  INVITE_LINK: "Venues d'un lien précis",
  SOURCE_CHANNEL: "Venues d'un de nos canaux",
  SOURCE_KIND: "Selon le type de provenance",
};

/** Phrase d'aide sous le titre « Exceptions selon la provenance ». */
export const EXCEPTIONS_HELP =
  "Un lien précis passe avant un de nos canaux, qui passe avant un type de provenance. Dans chaque groupe, la première exception qui correspond s'applique.";

/** Clé du menu d'un affilié Link Affi précis (identifiant Link Affi encodé : il peut contenir n'importe quoi). */
export function affiliateKey(affiliateId: string): string {
  return `affiliate:${encodeURIComponent(affiliateId)}`;
}

/** Clé du menu « Si la personne vient… » pour une exception (null : cible absente). */
export function provenanceKey(
  t: Pick<ScopedRule, "scope" | "sourceChannelId" | "sourceKind" | "inviteLinkId"> &
    Partial<Pick<ScopedRule, "linkaffiAffiliateId">>,
): string | null {
  switch (t.scope) {
    case "SOURCE_CHANNEL":
      return t.sourceChannelId ? `channel:${t.sourceChannelId}` : null;
    case "SOURCE_KIND":
      if (t.sourceKind === "LINKAFFI_AFFILIATE")
        return t.linkaffiAffiliateId ? affiliateKey(t.linkaffiAffiliateId) : null;
      return t.sourceKind ? `kind:${t.sourceKind}` : null;
    case "INVITE_LINK":
      return t.inviteLinkId ? `link:${t.inviteLinkId}` : null;
    default:
      return null;
  }
}

/** Clé du menu → portée et cible de l'exception (null : clé illisible). */
export function targetOfKey(key: string): ExceptionTarget | null {
  const none = {
    sourceChannelId: null,
    sourceKind: null,
    inviteLinkId: null,
    linkaffiAffiliateId: null,
  };
  const affiliate = /^affiliate:(.{1,400})$/.exec(key.trim());
  if (affiliate) {
    let id: string;
    try {
      id = decodeURIComponent(affiliate[1]!).trim();
    } catch {
      return null;
    }
    if (!id || id.length > 128) return null;
    return {
      ...none,
      scope: "SOURCE_KIND",
      sourceKind: "LINKAFFI_AFFILIATE",
      linkaffiAffiliateId: id,
    };
  }
  const m = /^(channel|kind|link):([A-Za-z0-9_-]{1,64})$/.exec(key.trim());
  if (!m) return null;
  const [, type, value] = m as unknown as [string, string, string];
  if (type === "channel") return { ...none, scope: "SOURCE_CHANNEL", sourceChannelId: value };
  if (type === "link") return { ...none, scope: "INVITE_LINK", inviteLinkId: value };
  // Un affilié précis s'écrit `affiliate:<id>` : « kind:LINKAFFI_AFFILIATE » sans affilié ne vise personne.
  if (value === "LINKAFFI_AFFILIATE") return null;
  return SOURCE_KINDS.includes(value as SourceKind)
    ? { ...none, scope: "SOURCE_KIND", sourceKind: value as SourceKind }
    : null;
}

/** Ce qu'il faut d'une règle pour écrire sa condition. */
type TargetLike = Pick<ScopedRule, "scope" | "sourceChannelId" | "sourceKind" | "inviteLinkId"> &
  Partial<Pick<ScopedRule, "linkaffiAffiliateId">>;

/**
 * Espaces insécables à l'intérieur des guillemets français (les textes du paquet commun ont des espaces ordinaires :
 * le navigateur pourrait couper la ligne juste après « ou juste avant »).
 */
export function frQuotes(text: string): string {
  return text.replace(/\u00ab /g, "\u00ab\u00a0").replace(/ \u00bb/g, "\u00a0\u00bb");
}

/** Condition d'une campagne d'affilié précise : « de la campagne « Casino VIP » de l'affilié « Paul » ». */
function affiliateCampaignCondition(c: { campaignName: string; affiliateName: string }): string {
  return `de la campagne « ${c.campaignName} » de l'affilié « ${c.affiliateName} »`;
}

/** Condition en français, après « Si la personne vient » : « de « Tir Cadré » », « d'une pub TikTok »… */
export function conditionText(t: TargetLike, names: NameMaps): string {
  const campaign =
    t.scope === "INVITE_LINK" && t.inviteLinkId
      ? names.affiliateLinks?.[t.inviteLinkId]
      : undefined;
  if (campaign) return frQuotes(affiliateCampaignCondition(campaign));
  return frQuotes(exceptionCondition(t, names.titles, names.linkNames, names.affiliateNames ?? {}));
}

/** Libellé enregistré de l'exception (`ApprovalRule.label`) : « Venu de « Tir Cadré » ». */
export function exceptionRuleLabel(t: TargetLike, names: NameMaps): string {
  return `Venu ${conditionText(t, names)}`;
}

/** Ligne d'aide sous « Si la personne vient… » : par où passe la personne visée. */
export function provenanceHelp(
  t: (Pick<ExceptionTarget, "scope" | "sourceKind"> & { inviteLinkId?: string | null }) | null,
  names?: Pick<NameMaps, "affiliateLinks">,
): string {
  if (!t) return "Choisissez d'où vient la personne.";
  if (t.scope === "SOURCE_CHANNEL")
    return "Par le bouton « canal à rejoindre » de ce canal, ou par un lien de partage posté dedans.";
  if (t.scope === "INVITE_LINK")
    return t.inviteLinkId && names?.affiliateLinks?.[t.inviteLinkId]
      ? "Par le lien Link Affi de cette campagne d'affilié seulement."
      : "Par ce lien précis seulement.";
  switch (t.sourceKind) {
    case "LINKAFFI_ANY":
      return "Par le lien Link Affi de n'importe quel affilié (campagnes Telegram créées dans Link Affi).";
    case "LINKAFFI_AFFILIATE":
      return "Par le lien Link Affi d'une des campagnes de cet affilié.";
    case "GATE":
      return "Par le bouton « canal à rejoindre » de n'importe lequel de nos canaux.";
    case "ANY_CHANNEL":
      return "Par le bouton « canal à rejoindre » d'un de nos canaux, ou par un lien de partage posté dans un de nos canaux.";
    case "SHARE":
      return "Par n'importe quel lien de partage de ce canal.";
    default:
      return "Par le lien d'entrée d'une pub (Campagnes → Tous les liens).";
  }
}

/** La personne vient-elle d'un de nos canaux (pas de canaux à rejoindre proposés d'office) ? */
export function isFromOurChannels(t: Pick<ExceptionTarget, "scope" | "sourceKind">): boolean {
  return (
    t.scope === "SOURCE_CHANNEL" ||
    (t.scope === "SOURCE_KIND" && (t.sourceKind === "GATE" || t.sourceKind === "ANY_CHANNEL"))
  );
}

/**
 * Canaux à rejoindre enregistrés pour une exception : jamais le canal lui-même ni, pour une exception « venue de
 * <canal> », ce canal d'origine (il compte comme déjà rejoint), sans doublon.
 */
export function exceptionGateChannelIds(
  t: Pick<ExceptionTarget, "scope" | "sourceChannelId">,
  gateIds: readonly string[],
  channelId: string,
): string[] {
  return [...new Set(gateIds)].filter(
    (id) =>
      id &&
      id !== channelId &&
      !(t.scope === "SOURCE_CHANNEL" && t.sourceChannelId !== null && id === t.sourceChannelId),
  );
}

/** Canaux à rejoindre d'une règle tels que la personne les verra (exigence active seulement). */
function shownGates(item: Pick<ExceptionItem, "scope" | "sourceChannelId" | "rule">): string[] {
  if (!hasGate(item.rule)) return [];
  return item.scope === "SOURCE_CHANNEL"
    ? item.rule.gateChannelIds.filter((id) => id !== item.sourceChannelId)
    : item.rule.gateChannelIds;
}

function titlesOf(ids: readonly string[], titles: Readonly<Record<string, string>>): string {
  return channelList(ids.map((id) => titles[id] ?? "un autre canal"));
}

function canaux(n: number): string {
  return `${n} ${n > 1 ? "canaux" : "canal"}`;
}

/** Délai court affiché dans la ligne de l'exception : « tout de suite », « après 1 jour », « à valider à la main »… */
export function whenShort(item: Pick<ExceptionItem, "scope" | "sourceChannelId" | "rule">): string {
  const { rule } = item;
  if (rule.mode === "MANUAL") return "à valider à la main";
  const delay = effectiveDelay(rule);
  const gates = shownGates(item);
  const after = delay === 0 ? "tout de suite" : `après ${delayLabel(delay)}`;
  if (gates.length === 0) return after;
  if (rule.gateMode === "REQUIRED")
    return delay === 0
      ? `après avoir rejoint ${canaux(gates.length)}`
      : `${delayLabel(delay)} après avoir rejoint ${canaux(gates.length)}`;
  return `${after}, ${canaux(gates.length)} proposé${gates.length > 1 ? "s" : ""}`;
}

/**
 * Phrase de résumé sous la ligne : « Une personne venue de « Tir Cadré » sera acceptée 1 jour après sa demande. »
 * Le délai après des canaux obligatoires part du moment où la personne les a tous rejoints (vu par le bot, ou à
 * « ✅ J'ai rejoint »).
 */
export function exceptionSentence(
  item: Pick<ExceptionItem, "scope" | "sourceChannelId" | "sourceKind" | "inviteLinkId" | "rule">,
  names: NameMaps,
): string {
  const who = `Une personne venue ${conditionText(item, names)}`;
  const { rule } = item;
  const gates = shownGates(item);
  const list = titlesOf(gates, names.titles);
  if (rule.mode === "MANUAL") {
    const base = `${who} attend votre validation (onglet Demandes).`;
    if (gates.length === 0) return base;
    return rule.gateMode === "REQUIRED"
      ? `${base} Le bot lui demande d'abord de rejoindre ${list}.`
      : `${base} Le bot lui propose aussi de rejoindre ${list}.`;
  }
  const delay = effectiveDelay(rule);
  if (gates.length > 0 && rule.gateMode === "REQUIRED")
    return delay === 0
      ? `${who} sera acceptée dès qu'elle aura rejoint ${list}.`
      : `${who} sera acceptée ${delayLabel(delay)} après avoir rejoint ${list} (à partir du moment où elle les a tous rejoints).`;
  const when = delay === 0 ? "tout de suite" : `${delayLabel(delay)} après sa demande`;
  if (gates.length > 0)
    return `${who} sera acceptée ${when} ; le bot lui propose aussi de rejoindre ${list}.`;
  return `${who} sera acceptée ${when}.`;
}

/**
 * Ce que le bot lui écrit à l'arrivée, quand ce n'est pas l'accueil habituel (null sinon). Même règle que le bot
 * (`welcomeKindFor`) : accueil complet dès que des canaux sont à rejoindre ; rien si le message est coupé ; un court
 * message pour une personne venue du bouton « canal à rejoindre » d'un autre canal.
 */
export function exceptionMessageNote(
  item: Pick<ExceptionItem, "scope" | "sourceChannelId" | "sourceKind" | "rule">,
): string | null {
  if (shownGates(item).length > 0) return null;
  if (item.rule.sendWelcome === false) return "Le bot ne lui écrit pas à son arrivée.";
  if (item.scope === "SOURCE_KIND" && item.sourceKind === "GATE")
    return "Le bot lui envoie seulement un court message : sa demande est bien reçue.";
  if (isFromOurChannels(item))
    return "Venue par le bouton « canal à rejoindre », elle reçoit seulement un court message : sa demande est bien reçue.";
  return null;
}

/** Les deux exceptions visent-elles exactement les mêmes personnes (même portée, même cible) ? */
export function sameTarget(a: TargetLike, b: TargetLike): boolean {
  const k = provenanceKey(a);
  return k !== null && k === provenanceKey(b);
}

/** Exception déjà enregistrée pour la même provenance (hors `exceptId`, celle qu'on modifie), ou null. */
export function findDuplicate<T extends TargetLike & { id: string }>(
  items: readonly T[],
  target: ExceptionTarget,
  exceptId?: string | null,
): T | null {
  return items.find((i) => i.id !== exceptId && sameTarget(i, target)) ?? null;
}

/** Message quand une exception existe déjà pour cette provenance. */
export function duplicateMessage(target: ExceptionTarget, names: NameMaps): string {
  return `Une exception existe déjà pour les personnes venues ${conditionText(target, names)} : modifiez-la plutôt.`;
}

/**
 * Avertissement « jamais utilisée » : une exception active placée avant, dans le même groupe, s'applique déjà à toutes
 * ses personnes (`shadowingRule`). Null si l'exception peut servir.
 */
export function shadowNote(
  items: readonly ExceptionItem[],
  item: ExceptionItem,
  names: NameMaps,
): string | null {
  const s = shadowingRule(items, item);
  if (!s) return null;
  return `Jamais utilisée : l'exception « ${exceptionRuleLabel(s, names)} », placée avant, s'applique déjà à ces personnes. Montez celle-ci au-dessus, ou désactivez l'autre.`;
}

/** Exceptions groupées par niveau, dans l'ordre de résolution (groupes vides retirés). */
export function groupByLevel<T extends ExceptionItem>(
  items: readonly T[],
): Array<{ scope: ExceptionScope; title: string; items: T[] }> {
  const ordered = orderRules(items);
  return EXCEPTION_LEVELS.map((scope) => ({
    scope,
    title: LEVEL_TITLES[scope],
    items: ordered.filter((i) => i.scope === scope),
  })).filter((g) => g.items.length > 0);
}

/**
 * Monter ou descendre une exception dans son groupe : nouvel ordre des identifiants du groupe, ou null si elle est
 * déjà en tête (ou en fin) de son groupe. Jamais d'un groupe à l'autre : le niveau passe toujours avant l'ordre.
 */
export function moveWithinLevel(
  items: readonly ScopedRule[],
  id: string,
  dir: "up" | "down",
): string[] | null {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const ids = orderRules(items.filter((i) => i.scope === item.scope)).map((i) => i.id);
  const at = ids.indexOf(id);
  const to = dir === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= ids.length) return null;
  [ids[at], ids[to]] = [ids[to]!, ids[at]!];
  return ids;
}

/** L'ordre reçu (glisser-déposer) contient-il exactement les exceptions du groupe, une fois chacune ? */
export function isValidLevelOrder(
  items: readonly Pick<ScopedRule, "id" | "scope">[],
  scope: ExceptionScope,
  ids: readonly string[],
): boolean {
  const level = items.filter((i) => i.scope === scope).map((i) => i.id);
  return (
    ids.length === level.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => level.includes(id))
  );
}

/** Nouvel ordre d'un groupe après un glisser-déposer : `id` posé à la place de `overId` (null si rien ne change). */
export function dropOrder(ids: readonly string[], id: string, overId: string): string[] | null {
  const from = ids.indexOf(id);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** Numéros d'ordre 10, 20, 30… dans l'ordre donné ; seulement ceux qui changent si `current` est fourni. */
export function sortOrderUpdates(
  orderedIds: readonly string[],
  current?: Readonly<Record<string, number>>,
): Array<{ id: string; sortOrder: number }> {
  return orderedIds
    .map((id, i) => ({ id, sortOrder: (i + 1) * 10 }))
    .filter((u) => !current || current[u.id] !== u.sortOrder);
}

/**
 * Ordre d'un groupe avec une exception nouvelle (ou dont la provenance change) : juste avant la première qui la
 * couvrirait (« n'importe quelle pub » ne masque pas une nouvelle « pub TikTok »), sinon à la fin (`placeNewRule`).
 */
export function placementOrder(sameLevel: readonly ScopedRule[], rule: ScopedRule): string[] {
  return placeNewRule(sameLevel, rule).map((r) => r.id);
}

/** Une option du menu « Si la personne vient… ». */
export type ProvenanceOption = {
  key: string;
  label: string;
  /** Déjà réglée par une autre exception. */
  used?: boolean;
};
export type ProvenanceGroup = { label: string; options: ProvenanceOption[] };

/** Types de provenance proposés dans « Un type de provenance » (les affiliés Link Affi ont leur propre groupe). */
const KIND_OPTIONS: readonly SourceKind[] = SOURCE_KINDS.filter(
  (k) => k !== "LINKAFFI_ANY" && k !== "LINKAFFI_AFFILIATE",
);

/** Lien d'une campagne Telegram d'affilié (LINKAFFI) dans le menu : campagne et affilié. */
export type AffiliateLinkOption = {
  id: string;
  campaignName: string;
  affiliateName: string;
  isActive: boolean;
};

/** Noms des affiliés et des campagnes d'affiliés pour les phrases (`NameMaps`). */
export function affiliateNameMaps(input: {
  affiliates?: ReadonlyArray<{ id: string; name: string }>;
  affiliateLinks?: readonly AffiliateLinkOption[];
}): Required<Pick<NameMaps, "affiliateNames" | "affiliateLinks">> {
  return {
    affiliateNames: Object.fromEntries((input.affiliates ?? []).map((a) => [a.id, a.name])),
    affiliateLinks: Object.fromEntries(
      (input.affiliateLinks ?? []).map((l) => [
        l.id,
        { campaignName: l.campaignName, affiliateName: l.affiliateName },
      ]),
    ),
  };
}

/**
 * Menu « Si la personne vient… » : un de nos canaux (ceux qui envoient leurs membres ici d'abord), un type de
 * provenance, un lien de partage précis, et (phase 13, dès qu'un affilié Link Affi est connu) un affilié Link Affi
 * (n'importe lequel, ou un affilié précis) et une campagne d'affilié précise (liens LINKAFFI de ce canal). L'option en
 * cours reste proposée même si son canal ou son lien a disparu. `used` : clés des autres exceptions (marquées « déjà
 * réglée »).
 */
export function provenanceMenu(input: {
  channelId: string;
  channels: ReadonlyArray<{ id: string; title: string; isActive: boolean }>;
  /** Liens de partage actifs du canal, et liens visés par une exception (tout type). */
  links: ReadonlyArray<{ id: string; name: string; kind: string; isActive: boolean }>;
  /** Canaux dont une règle demande de rejoindre ce canal (ils y envoient leurs membres). */
  senders: readonly string[];
  /** Affiliés Link Affi connus (par leurs campagnes, tous canaux). */
  affiliates?: ReadonlyArray<{ id: string; name: string }>;
  /** Campagnes d'affiliés de ce canal (liens LINKAFFI). */
  affiliateLinks?: readonly AffiliateLinkOption[];
  current?: string | null;
  used: readonly string[];
}): ProvenanceGroup[] {
  const titles = Object.fromEntries(input.channels.map((c) => [c.id, c.title]));
  const linkNames = Object.fromEntries(input.links.map((l) => [l.id, l.name]));
  const affiliates = input.affiliates ?? [];
  const campaignLinks = input.affiliateLinks ?? [];
  const names: NameMaps = { titles, linkNames, ...affiliateNameMaps(input) };
  const used = new Set(input.used);
  const option = (key: string): ProvenanceOption => {
    const target = targetOfKey(key)!;
    return { key, label: conditionText(target, names), ...(used.has(key) ? { used: true } : {}) };
  };
  const senders = new Set(input.senders);
  const channels = input.channels
    .filter((c) => c.id !== input.channelId && c.isActive)
    .sort(
      (a, b) =>
        Number(senders.has(b.id)) - Number(senders.has(a.id)) ||
        a.title.localeCompare(b.title, "fr"),
    )
    .map((c) => option(`channel:${c.id}`));
  const links = input.links
    .filter((l) => l.kind === "SHARE" && l.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((l) => option(`link:${l.id}`));
  const campaignIds = new Set(campaignLinks.map((l) => l.id));
  const campaigns = campaignLinks
    .filter((l) => l.isActive)
    .sort(
      (a, b) =>
        a.affiliateName.localeCompare(b.affiliateName, "fr") ||
        a.campaignName.localeCompare(b.campaignName, "fr"),
    )
    .map((l) => option(`link:${l.id}`));
  const affiliateOptions = [...affiliates]
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((a) => option(affiliateKey(a.id)));
  const current = input.current ? targetOfKey(input.current) : null;
  if (current?.scope === "SOURCE_CHANNEL" && !channels.some((o) => o.key === input.current))
    channels.unshift(option(input.current!));
  if (
    current?.scope === "INVITE_LINK" &&
    current.inviteLinkId &&
    campaignIds.has(current.inviteLinkId)
  ) {
    if (!campaigns.some((o) => o.key === input.current)) campaigns.unshift(option(input.current!));
  } else if (current?.scope === "INVITE_LINK" && !links.some((o) => o.key === input.current))
    links.unshift(option(input.current!));
  if (
    current?.sourceKind === "LINKAFFI_AFFILIATE" &&
    !affiliateOptions.some((o) => o.key === input.current)
  )
    affiliateOptions.unshift(option(input.current!));
  // Groupe des affiliés : dès qu'un affilié ou une campagne est connu (ou que l'exception en cours en vise un).
  const showAffiliates =
    affiliates.length > 0 ||
    campaigns.length > 0 ||
    current?.sourceKind === "LINKAFFI_ANY" ||
    current?.sourceKind === "LINKAFFI_AFFILIATE";
  const groups: ProvenanceGroup[] = [
    { label: "Un de nos canaux", options: channels },
    { label: "Un type de provenance", options: KIND_OPTIONS.map((k) => option(`kind:${k}`)) },
    { label: "Un lien de partage précis", options: links },
    {
      label: "Un affilié Link Affi",
      options: showAffiliates ? [option("kind:LINKAFFI_ANY"), ...affiliateOptions] : [],
    },
    { label: "Une campagne d'affilié précise", options: campaigns },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/**
 * Provenance proposée pour une nouvelle exception : un canal qui envoie ses membres ici, puis le bouton « canal à
 * rejoindre » d'un de nos canaux (s'il y en a un), puis la première provenance encore libre du menu.
 */
export function suggestedProvenance(
  menu: readonly ProvenanceGroup[],
  senders: readonly string[],
): string | null {
  const free = menu.flatMap((g) => g.options).filter((o) => !o.used);
  const has = (key: string) => free.some((o) => o.key === key);
  const first = [
    ...senders.map((id) => `channel:${id}`),
    ...(senders.length > 0 ? ["kind:GATE"] : []),
  ].find(has);
  return first ?? free[0]?.key ?? null;
}

/**
 * Réglages d'une nouvelle exception : copie de la règle par défaut (délai, canaux, réglages avancés), sauf pour une
 * personne venue d'un de nos canaux : aucun canal à rejoindre d'office (pas de chaîne d'un canal à l'autre) ; le délai
 * de « puis accepter » devient alors un simple délai.
 */
export function newExceptionState(
  base0: EntryFormState,
  target: Pick<ExceptionTarget, "scope" | "sourceKind"> | null,
): EntryFormState {
  // Nouvelle règle (phase 14) : les anciens rappels par défaut deviennent 4 minutes puis 1 heure.
  const base = { ...base0, reminders: freshReminders(base0.reminders) };
  if (!target || !isFromOurChannels(target)) return { ...base, gateIds: [...base.gateIds] };
  if (base.choice !== "gate") return { ...base, gateIds: [] };
  const seconds = stateDelaySeconds(base);
  if (seconds === 0) return { ...base, choice: "now", gateIds: [] };
  const preset = presetForSeconds(seconds);
  const custom = splitDelay(seconds);
  return {
    ...base,
    choice: "delay",
    gateIds: [],
    delayPreset: preset,
    customAmount: preset === "custom" ? custom.amount : base.customAmount,
    customUnit: preset === "custom" ? custom.unit : base.customUnit,
  };
}

/** Exceptions qui s'appliquent aux personnes envoyées ici par le bouton « canal à rejoindre » d'un autre canal. */
export type GateSkipExceptions = {
  /** Libellés des exceptions retenues (« Venu de « Tir Cadré » »), dans l'ordre de résolution, sans doublon. */
  labels: string[];
  /** Certaines de ces personnes suivent quand même la règle par défaut (aucune exception ne les vise). */
  defaultToo: boolean;
};

/**
 * Pour chaque canal qui envoie ses membres ici (`senders`, sinon le bouton de n'importe lequel de nos canaux), la règle
 * que le bot appliquera à une personne venue de son bouton « canal à rejoindre » (`pickRuleForProvenance`, comme le
 * bot) : une exception active, ou la règle par défaut. Les exceptions passent toujours avant la règle par défaut : il
 * suffit de chercher parmi elles.
 */
export function gateSenderExceptions(
  exceptions: readonly ExceptionItem[],
  senders: readonly string[],
  names: NameMaps,
): GateSkipExceptions {
  const sources: Array<string | null> = senders.length > 0 ? [...new Set(senders)] : [null];
  const picked: ExceptionItem[] = [];
  let defaultToo = false;
  for (const sourceChannelId of sources) {
    const r = pickRuleForProvenance(exceptions, {
      type: "GATE",
      inviteLinkId: null,
      sourceChannelId,
      adPlatform: null,
    });
    if (!r) defaultToo = true;
    else if (!picked.some((x) => x.id === r.id)) picked.push(r);
  }
  return { labels: orderRules(picked).map((r) => exceptionRuleLabel(r, names)), defaultToo };
}

/** « « A » », « « A » ou « B » », « « A », « B » ou « C » ». */
function orList(labels: readonly string[]): string {
  const q = labels.map((l) => `« ${l} »`);
  return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} ou ${q.at(-1)}`;
}

/**
 * Note de la règle par défaut avec des canaux à rejoindre : une personne envoyée ici par le bouton « canal à
 * rejoindre » d'un autre de nos canaux ne les a pas à rejoindre (même règle que le bot : `effectiveGateChannelIds`), et
 * suit le délai de la règle par défaut, sauf si une exception active la vise (`gateSenderExceptions`).
 */
export function defaultGateSkipNote(
  state: Pick<EntryFormState, "manual"> & { delaySeconds: number },
  gateSkip?: GateSkipExceptions | null,
): string {
  const who =
    "Une personne envoyée ici par le bouton « canal à rejoindre » d'un autre de nos canaux";
  const labels = gateSkip?.labels ?? [];
  if (labels.length > 0 && !gateSkip?.defaultToo)
    return frQuotes(
      labels.length === 1
        ? `${who} ne suit pas cette règle : l'exception ${orList(labels)}, plus bas, s'applique à elle.`
        : `${who} ne suit pas cette règle : selon le canal d'où elle vient, l'exception ${orList(labels)}, plus bas, s'applique à elle.`,
    );
  const then = state.manual
    ? "sa demande attend votre validation"
    : state.delaySeconds === 0
      ? "elle est acceptée tout de suite"
      : `elle est acceptée ${delayLabel(state.delaySeconds)} après sa demande`;
  if (labels.length > 0)
    return frQuotes(
      labels.length === 1
        ? `${who} n'a pas à rejoindre ces canaux : ${then}, sauf si l'exception ${orList(labels)}, plus bas, s'applique à elle.`
        : `${who} n'a pas à rejoindre ces canaux : ${then}, sauf si l'une des exceptions ${orList(labels)}, plus bas, s'applique à elle.`,
    );
  return frQuotes(
    `${who} n'a pas à rejoindre ces canaux : ${then}. Une exception peut en décider autrement.`,
  );
}
