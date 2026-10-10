/**
 * Groupe de membres d'un envoi (le `Segment` de `@linkaffipro/core`), en langage courant (fonctions pures, testées) :
 * - phrase affichée dans la liste, sur la fiche et dans le récapitulatif (« Membres du canal « Casino VIP », de niveau
 *   « VIP » ») ;
 * - phrase du compteur (« 1 240 membres recevront ce message ») ;
 * - lecture du groupe préparé par la liste des membres (paramètres d'adresse de `broadcastLink`).
 * Aucune règle de ciblage ici : le groupe reste lu et appliqué par `parseSegment` / `buildMemberWhere` du core.
 */
import {
  SPEND_LEVELS,
  SPEND_LEVEL_LABELS,
  parseSegment,
  type Segment,
  type SpendLevel,
} from "@linkaffipro/core";
import { fmtNum } from "@/lib/format";
import { languageName } from "@/lib/members/filters";
import { statusLabel } from "@/lib/status-badges";

/** Statuts d'adhésion proposés dans « Statut dans le canal » (ceux du formulaire d'avant). */
export const GROUP_STATUSES = [
  "APPROVED",
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "LEFT",
  "KICKED",
  "EXPIRED",
] as const;

/** Durées proposées pour « Rien fait depuis » (jours). */
export const INACTIVE_DAY_CHOICES = [3, 7, 14, 30, 60, 90] as const;

/** Une ligne d'aide par niveau de dépense (les seuils exacts se règlent dans Réglages). */
export const SPEND_LEVEL_HINTS: Record<SpendLevel, string> = {
  AUCUN: "pas encore inscrit",
  INSCRIT: "inscrit, sans dépôt",
  DEPOSANT: "a déjà déposé",
  REGULIER: "dépose souvent",
  VIP: "gros déposant",
};

/** Un critère du groupe = une clé du `Segment`. */
export type CriterionKey =
  | "channelIds"
  | "campaignIds"
  | "inviteLinkIds"
  | "spendLevels"
  | "clickedCategoryIds"
  | "inactiveDays"
  | "membershipStatuses"
  | "languages"
  | "tags";
export type ListCriterionKey = Exclude<CriterionKey, "inactiveDays">;

/** Les critères rangés par question, dans l'ordre de la liste des membres. */
export const GROUP_QUESTIONS: ReadonlyArray<{ title: string; keys: CriterionKey[] }> = [
  { title: "D'où ils viennent", keys: ["channelIds", "campaignIds", "inviteLinkIds"] },
  { title: "Ce qu'ils ont fait", keys: ["spendLevels", "clickedCategoryIds", "inactiveDays"] },
  { title: "Qui ils sont", keys: ["membershipStatuses", "languages", "tags"] },
];

/**
 * Libellés de chaque critère : bouton « + … », titre du bloc, une ligne d'aide et ce qu'il reste à faire tant que le
 * bloc est vide (« choisissez une durée »).
 */
export const CRITERIA: Record<
  CriterionKey,
  { add: string; title: string; help: string; missing: string }
> = {
  channelIds: {
    add: "Canaux",
    title: "Membres de ces canaux",
    help: "Ceux qui ont demandé à rejoindre au moins un de ces canaux.",
    missing: "cochez au moins un canal",
  },
  campaignIds: {
    add: "Campagne",
    title: "Venus de ces campagnes",
    help: "Arrivés par un lien d'entrée d'une de ces campagnes.",
    missing: "cochez au moins une campagne",
  },
  inviteLinkIds: {
    add: "Pub",
    title: "Venus de ces pubs",
    help: "Arrivés par le lien d'entrée d'une de ces pubs.",
    missing: "cochez au moins une pub",
  },
  spendLevels: {
    add: "Niveau de dépense",
    title: "Niveau de dépense",
    help: "Calculé d'après leurs comptes joueurs (seuils réglables dans Réglages).",
    missing: "cochez au moins un niveau",
  },
  clickedCategoryIds: {
    add: "A cliqué une catégorie",
    title: "Ont cliqué un message de ces catégories",
    help: "Un bouton d'un message de canal rangé dans une de ces catégories.",
    missing: "cochez au moins une catégorie",
  },
  inactiveDays: {
    add: "Rien fait depuis",
    title: "Rien fait depuis",
    help: "Aucune activité vue par nos bots depuis ce nombre de jours.",
    missing: "choisissez une durée",
  },
  membershipStatuses: {
    add: "Statut dans le canal",
    title: "Statut dans le canal",
    help: "Où en est leur demande (sur les canaux choisis plus haut, s'il y en a).",
    missing: "cochez au moins un statut",
  },
  languages: {
    add: "Langue",
    title: "Langue de leur Telegram",
    help: "Au moins une de ces langues.",
    missing: "cochez au moins une langue",
  },
  tags: {
    add: "Étiquette",
    title: "Avec ces étiquettes",
    help: "Au moins une de ces étiquettes.",
    missing: "choisissez au moins une étiquette",
  },
};

const CRITERION_KEYS = GROUP_QUESTIONS.flatMap((q) => q.keys);

/** Critères qui ont une valeur dans le groupe (ordre des questions). */
export function activeCriteria(s: Segment): CriterionKey[] {
  return CRITERION_KEYS.filter((k) =>
    k === "inactiveDays" ? Boolean(s.inactiveDays) : Boolean(s[k]?.length),
  );
}

/** Blocs affichés à l'étape « Qui » : critères qui ont une valeur et critères ajoutés (même vides), sans doublon. */
export function openCriteria(added: readonly CriterionKey[], s: Segment): CriterionKey[] {
  const active = activeCriteria(s);
  return CRITERION_KEYS.filter((k) => active.includes(k) || added.includes(k));
}

/**
 * Blocs ouverts encore vides (« Rien fait depuis » sans durée, « Langue » sans case cochée) : ils ne comptent pas
 * dans le groupe envoyé. L'assistant les signale plutôt que de les ignorer sans prévenir.
 */
export function pendingCriteria(open: readonly CriterionKey[], s: Segment): CriterionKey[] {
  const active = activeCriteria(s);
  return CRITERION_KEYS.filter((k) => open.includes(k) && !active.includes(k));
}

/** « « Rien fait depuis » : choisissez une durée, ou retirez ce critère. » */
export function pendingCriterionError(key: CriterionKey): string {
  const c = CRITERIA[key];
  return `«\u00a0${c.title}\u00a0» : ${c.missing}, ou retirez ce critère.`;
}

/** Récapitulatif du groupe : « Un critère n'est pas encore réglé : il ne compte pas. » (null s'il n'y en a pas). */
export function pendingSentence(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "Un critère n'est pas encore réglé : il ne compte pas."
    : `${fmtNum(n)} critères ne sont pas encore réglés : ils ne comptent pas.`;
}

/** Le groupe sans ce critère. */
export function withoutCriterion(s: Segment, key: CriterionKey): Segment {
  const next = { ...s };
  delete next[key];
  return next;
}

/** Coche ou décoche une valeur d'un critère à choix multiple (liste vide = critère retiré). */
export function toggleValue(
  s: Segment,
  key: ListCriterionKey,
  value: string,
  on: boolean,
): Segment {
  const current = (s[key] as string[] | undefined) ?? [];
  const list = on
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((v) => v !== value);
  if (list.length === 0) return withoutCriterion(s, key);
  return { ...s, [key]: list } as Segment;
}

/** « Rien fait depuis N jours » (null ou 0 = critère retiré). */
export function withInactiveDays(s: Segment, days: number | null): Segment {
  if (!days || !Number.isFinite(days) || days <= 0) return withoutCriterion(s, "inactiveDays");
  return { ...s, inactiveDays: Math.floor(days) };
}

/** Noms affichés des canaux, campagnes, pubs (liens d'entrée) et catégories, par identifiant. */
export type GroupNames = {
  channels?: Record<string, string>;
  campaigns?: Record<string, string>;
  inviteLinks?: Record<string, string>;
  categories?: Record<string, string>;
};

/** « A », « A ou B », « A, B ou C ». */
export function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ou ${parts[parts.length - 1]}`;
}

/** « A », « A et B », « A, B et C ». */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

/** Guillemets français avec espaces insécables (« Casino VIP » ne se coupe jamais après le guillemet). */
const quote = (s: string) => `«\u00a0${s}\u00a0»`;

/** Noms entre guillemets ; au-delà de `max`, les premiers puis « et N autres ». */
function namesOf(ids: string[], map: Record<string, string> | undefined, max: number): string {
  const names = ids.map((id) => quote(map?.[id] ?? "introuvable"));
  if (names.length <= max) return joinOr(names);
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")} ou ${rest} autre${rest > 1 ? "s" : ""}`;
}

function days(n: number): string {
  return `${fmtNum(n)} jour${n > 1 ? "s" : ""}`;
}

/** Morceaux de phrase du groupe, dans l'ordre des questions (d'où ils viennent, ce qu'ils ont fait, qui ils sont). */
export function groupParts(s: Segment, names: GroupNames = {}, max = 3): string[] {
  const parts: string[] = [];
  if (s.channelIds?.length)
    parts.push(
      `${s.channelIds.length > 1 ? "des canaux" : "du canal"} ${namesOf(s.channelIds, names.channels, max)}`,
    );
  if (s.campaignIds?.length)
    parts.push(
      `venus ${s.campaignIds.length > 1 ? "des campagnes" : "de la campagne"} ${namesOf(s.campaignIds, names.campaigns, max)}`,
    );
  if (s.inviteLinkIds?.length)
    parts.push(
      `venus ${s.inviteLinkIds.length > 1 ? "des pubs" : "de la pub"} ${namesOf(s.inviteLinkIds, names.inviteLinks, max)}`,
    );
  if (s.membershipStatuses?.length)
    parts.push(
      `au statut ${joinOr(s.membershipStatuses.map((x) => quote(statusLabel("membership", x))))}`,
    );
  if (s.spendLevels?.length)
    parts.push(`de niveau ${joinOr(s.spendLevels.map((l) => quote(SPEND_LEVEL_LABELS[l] ?? l)))}`);
  if (s.clickedCategoryIds?.length)
    parts.push(`qui ont cliqué un message ${namesOf(s.clickedCategoryIds, names.categories, max)}`);
  if (s.inactiveDays) parts.push(`qui n'ont rien fait depuis ${days(s.inactiveDays)}`);
  if (s.languages?.length)
    parts.push(
      `qui parlent ${joinOr(s.languages.map((l) => languageName(l).toLocaleLowerCase("fr") || l))}`,
    );
  if (s.tags?.length) parts.push(`avec l'étiquette ${joinOr(s.tags.map(quote))}`);
  return parts;
}

/**
 * Le groupe en une phrase : « Tous les membres » sans critère, sinon « Membres du canal « A », de niveau « VIP » et
 * qui n'ont rien fait depuis 7 jours ». Les membres qui ne peuvent pas recevoir de message privé du bot sont toujours
 * écartés : c'est dit à côté (voir `reachableSentence`).
 */
export function describeGroup(s: Segment, names: GroupNames = {}, max = 3): string {
  const parts = groupParts(s, names, max);
  return parts.length ? `Membres ${joinAnd(parts)}` : "Tous les membres";
}

/** Nombre de critères du groupe (un par question cochée). */
export function groupCriteriaCount(s: Segment): number {
  return groupParts(s).length;
}

/** « … qui peuvent recevoir un message privé de @bot. » */
export function reachableSentence(botUsername: string | null | undefined): string {
  return botUsername
    ? `Seuls ceux qui peuvent recevoir un message privé de @${botUsername} le recevront.`
    : "Seuls ceux qui peuvent recevoir un message privé du bot le recevront.";
}

/** « 1 240 membres », « 1 membre », « aucun membre ». */
export function membersPhrase(n: number): string {
  if (n <= 0) return "aucun membre";
  return `${fmtNum(n)} membre${n > 1 ? "s" : ""}`;
}

/** Compteur du récapitulatif : « 1 240 membres recevront ce message ». */
export function countSentence(count: number | null): string {
  if (count === null) return "Nombre de membres indisponible pour l'instant.";
  if (count <= 0) return "Aucun membre ne recevrait ce message pour l'instant.";
  return count === 1
    ? "1 membre recevra ce message."
    : `${membersPhrase(count)} recevront ce message.`;
}

/** Compteur compact sur deux lignes : « 75 membres » (en gras) puis « recevront ce message ». */
export function countLines(count: number | null): { figure: string; rest: string } {
  if (count === null) return { figure: "—", rest: "nombre indisponible pour l'instant" };
  if (count <= 0) return { figure: "Aucun membre", rest: "ne recevrait ce message" };
  return {
    figure: membersPhrase(count),
    rest: count === 1 ? "recevra ce message" : "recevront ce message",
  };
}

/**
 * Étiquettes saisies : séparées par des virgules dès qu'il y en a une (une étiquette peut contenir une espace,
 * « Gros joueur » ; le formulaire en étapes envoie toujours une virgule), sinon par des espaces comme avant
 * (« vip test »).
 */
export function splitTags(raw: string): string[] {
  return (raw.includes(",") ? raw.split(",") : raw.split(/\s+/))
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type SearchParams = Record<string, string | string[] | undefined>;

function listParam(sp: SearchParams, key: string): string[] {
  const v = sp[key];
  const raw = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return raw
    .flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Choix connus du formulaire : un identifiant inconnu (canal supprimé, valeur inventée) n'est pas repris. */
export type GroupChoices = {
  channelIds?: string[];
  campaignIds?: string[];
  inviteLinkIds?: string[];
  clickedCategoryIds?: string[];
};

/**
 * Groupe préparé par la liste des membres (lien « Écrire à un groupe ») : mêmes noms que le `Segment`, listes en
 * paramètres répétés (ou séparées par des virgules). Seules les valeurs connues sont gardées (statuts, niveaux,
 * identifiants des choix proposés) ; `dropped` compte celles qui n'ont pas pu être reprises.
 */
export function segmentFromSearchParams(
  sp: SearchParams,
  choices: GroupChoices = {},
): { segment: Segment; dropped: number; carried: boolean } {
  let dropped = 0;
  const keep = (key: keyof GroupChoices) => {
    const values = listParam(sp, key);
    const allowed = choices[key];
    if (!allowed) return values;
    const set = new Set(allowed);
    const kept = values.filter((v) => set.has(v));
    dropped += values.length - kept.length;
    return kept;
  };
  const statuses = listParam(sp, "membershipStatuses");
  const okStatuses = statuses.filter((x) => (GROUP_STATUSES as readonly string[]).includes(x));
  const levels = listParam(sp, "spendLevels");
  const okLevels = levels.filter((x) => (SPEND_LEVELS as readonly string[]).includes(x));
  dropped += statuses.length - okStatuses.length + levels.length - okLevels.length;
  const inactive = typeof sp.inactiveDays === "string" ? sp.inactiveDays : undefined;
  const segment = parseSegment({
    channelIds: keep("channelIds"),
    campaignIds: keep("campaignIds"),
    inviteLinkIds: keep("inviteLinkIds"),
    clickedCategoryIds: keep("clickedCategoryIds"),
    membershipStatuses: okStatuses,
    spendLevels: okLevels,
    languages: listParam(sp, "languages").map((l) => l.toLowerCase()),
    tags: listParam(sp, "tags"),
    inactiveDays: inactive,
  });
  return { segment, dropped, carried: groupCriteriaCount(segment) > 0 };
}

/** Champs envoyés par le formulaire pour un groupe (mêmes noms qu'avant ; listes en champs répétés). */
export function segmentFormFields(s: Segment): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const list = (key: keyof Segment, values: string[] | undefined) => {
    for (const v of values ?? []) out.push([key, v]);
  };
  list("channelIds", s.channelIds);
  list("membershipStatuses", s.membershipStatuses);
  list("spendLevels", s.spendLevels);
  list("inviteLinkIds", s.inviteLinkIds);
  list("campaignIds", s.campaignIds);
  list("clickedCategoryIds", s.clickedCategoryIds);
  out.push(["languages", (s.languages ?? []).join(",")]);
  out.push(["inactiveDays", s.inactiveDays ? String(s.inactiveDays) : ""]);
  // Virgule finale : une étiquette peut contenir une espace (« Gros joueur ») ; voir `parseSegmentForm`.
  out.push(["tags", s.tags?.length ? `${s.tags.join(",")},` : ""]);
  return out;
}
