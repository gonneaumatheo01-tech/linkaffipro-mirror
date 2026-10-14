/**
 * Filtres de la liste des membres, en langage courant (fonctions pures, testées).
 * - lecture et écriture des paramètres d'adresse (les anciens restent valides : q, channelId, status, inviteLinkId,
 *   campaignId, level, language, tag, since, until, sort, page) ;
 * - nouveaux filtres : `deposited=1` (ont déposé), `ftd=today|7d|30d|month` (premier dépôt dans la période),
 *   `inactive=7|30` (rien fait depuis N jours), `universe=CASINO|SPORTS|DATING`, `affiliateId=<id Link Affi>`
 *   (membres amenés par un affilié Link Affi, phase 13) ;
 * - phrases affichées (« Venus de la campagne « Casino octobre » »), pastilles de raccourcis, lien vers
 *   « Écrire à un groupe » avec les filtres qui s'y traduisent, et la phrase qui dit lesquels ne le sont pas.
 */
import { SPEND_LEVELS, SPEND_LEVEL_LABELS, type SpendLevel } from "@linkaffipro/core";
import { fmtDayKey, isDayKey } from "@/lib/periods";
import { statusLabel } from "@/lib/status-badges";
import { UNIVERSES, UNIVERSE_LABELS, toUniverse, type Universe } from "@/lib/universe";

export const MEMBERS_PATH = "/members";
export const BROADCAST_NEW_PATH = "/members/broadcasts/new";
/**
 * Statuts qu'« Écrire à un groupe » sait reprendre (mêmes valeurs que `GROUP_STATUSES` de `@/lib/broadcasts/group`,
 * vérifié par un test ; recopiés ici pour éviter une importation circulaire).
 */
export const BROADCAST_STATUSES = [
  "APPROVED",
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "LEFT",
  "KICKED",
  "EXPIRED",
] as const;

/** Périodes du filtre « premier dépôt » (clés de `@/lib/periods`). */
export const MEMBER_FTD_PERIODS = ["today", "7d", "30d", "month"] as const;
export type MemberFtdPeriod = (typeof MEMBER_FTD_PERIODS)[number];

/** Phrases du filtre « premier dépôt ». */
export const FTD_PERIOD_LABELS: Record<MemberFtdPeriod, string> = {
  today: "Premier dépôt aujourd'hui",
  "7d": "Premier dépôt ces 7 derniers jours",
  "30d": "Premier dépôt ces 30 derniers jours",
  month: "Premier dépôt ce mois-ci",
};

/** Durées proposées pour « rien fait depuis » (toute valeur de 1 à 365 jours reste acceptée dans l'adresse). */
export const MEMBER_INACTIVE_CHOICES = [7, 30] as const;
const MAX_INACTIVE_DAYS = 365;

export type MemberSort = "lastSeen" | "firstSeen" | "name";

export const SORT_LABELS: Record<MemberSort, string> = {
  lastSeen: "Dernière activité",
  firstSeen: "Arrivée",
  name: "Nom",
};

export type MemberFilters = {
  q: string;
  channelId: string;
  status: string;
  inviteLinkId: string;
  /** Campagne (la nôtre) : membres arrivés par un de ses liens d'entrée. */
  campaignId: string;
  level: SpendLevel | "";
  language: string;
  /** Étiquette (nom exact du registre ou posée par une relance automatique). */
  tag: string;
  since: string;
  until: string;
  /** A déposé au moins une fois (un de ses comptes joueurs a un dépôt). */
  deposited: boolean;
  /** Premier dépôt dans la période (jours de Paris). */
  ftd: MemberFtdPeriod | "";
  /** Rien fait depuis N jours : même règle que « Écrire à un groupe » (dernière activité Telegram). */
  inactive: number | "";
  /** Univers d'un des canaux du membre. */
  universe: Universe | "";
  /** Affilié Link Affi qui a amené le membre (identifiant Link Affi, `Member.linkaffiAffiliateId`). */
  affiliateId: string;
  sort: MemberSort;
  page: number;
};

/** Clés de filtre (tout sauf le tri et la page). */
export type MemberFilterKey = Exclude<keyof MemberFilters, "sort" | "page">;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const TRUE_VALUES = new Set(["1", "true", "on", "oui"]);

export function parseMemberFilters(sp: SP): MemberFilters {
  const level = one(sp.level);
  const sort = one(sp.sort);
  const ftd = one(sp.ftd);
  const inactive = Number(one(sp.inactive));
  return {
    q: one(sp.q).trim(),
    channelId: one(sp.channelId),
    status: one(sp.status),
    inviteLinkId: one(sp.inviteLinkId),
    campaignId: one(sp.campaignId),
    level: (SPEND_LEVELS as readonly string[]).includes(level) ? (level as SpendLevel) : "",
    language: one(sp.language).trim().toLowerCase(),
    tag: one(sp.tag).trim(),
    since: one(sp.since),
    until: one(sp.until),
    deposited: TRUE_VALUES.has(one(sp.deposited).toLowerCase()),
    ftd: (MEMBER_FTD_PERIODS as readonly string[]).includes(ftd) ? (ftd as MemberFtdPeriod) : "",
    inactive:
      Number.isInteger(inactive) && inactive > 0 && inactive <= MAX_INACTIVE_DAYS ? inactive : "",
    universe: toUniverse(one(sp.universe)) ?? "",
    affiliateId: one(sp.affiliateId).trim().slice(0, 128),
    sort: sort === "firstSeen" || sort === "name" ? sort : "lastSeen",
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

/** Paramètres d'adresse des filtres (valeurs vides, page 1 et tri par défaut omis), dans un ordre stable. */
export function filterEntries(
  f: MemberFilters,
  overrides: Partial<MemberFilters> = {},
): Array<[string, string]> {
  const merged = { ...f, ...overrides };
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(merged)) {
    if (v === "" || v === undefined || v === false) continue;
    if (k === "page" && v === 1) continue;
    if (k === "sort" && v === "lastSeen") continue;
    out.push([k, v === true ? "1" : String(v)]);
  }
  return out;
}

export function filtersToQuery(f: MemberFilters, overrides: Partial<MemberFilters> = {}): string {
  const s = new URLSearchParams(filterEntries(f, overrides)).toString();
  return s ? `?${s}` : "";
}

/**
 * Lien vers la liste avec ces filtres (retour en page 1 sauf page précisée). Jamais l'adresse nue : `/members` sans
 * paramètre ramène aux filtres mémorisés sur l'appareil (`RememberFilters`) ; une liste sans filtre s'écrit donc
 * `/members?sort=lastSeen`, sinon retirer le dernier filtre le ferait revenir.
 */
export function membersHref(f: MemberFilters, overrides: Partial<MemberFilters> = {}): string {
  const q = filtersToQuery(f, { page: 1, ...overrides });
  return `${MEMBERS_PATH}${q || "?sort=lastSeen"}`;
}

/** Valeurs de tous les filtres vidés (le tri est gardé). */
export function clearedFilters(): Pick<MemberFilters, MemberFilterKey> {
  return { ...EMPTY };
}

/** Valeur « vide » de chaque filtre (pour le retirer). */
const EMPTY: Pick<MemberFilters, MemberFilterKey> = {
  q: "",
  channelId: "",
  status: "",
  inviteLinkId: "",
  campaignId: "",
  level: "",
  language: "",
  tag: "",
  since: "",
  until: "",
  deposited: false,
  ftd: "",
  inactive: "",
  universe: "",
  affiliateId: "",
};

export const FILTER_KEYS = Object.keys(EMPTY) as MemberFilterKey[];

/** Champs cachés d'un formulaire GET qui doit conserver les autres filtres et le tri (jamais la page). */
export function hiddenFilterFields(
  f: MemberFilters,
  exclude: ReadonlyArray<keyof MemberFilters>,
): Array<[string, string]> {
  const skip = new Set<string>([...exclude, "page"]);
  return filterEntries(f).filter(([k]) => !skip.has(k));
}

/** Nombre de filtres actifs (dates d'arrivée comptées pour un seul filtre). */
export function activeFilterCount(
  f: MemberFilters,
  keys: readonly MemberFilterKey[] = FILTER_KEYS,
): number {
  let n = 0;
  for (const k of keys) {
    if (k === "until" && keys.includes("since") && f.since) continue;
    if (f[k] !== EMPTY[k]) n++;
  }
  return n;
}

export function hasMemberFilters(f: MemberFilters): boolean {
  return activeFilterCount(f) > 0;
}

/** Nom d'une langue en français (« fr » → « Français », « pt-br » → « Portugais (Brésil) ») ; le code sinon. */
export function languageName(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  try {
    const name = new Intl.DisplayNames(["fr"], { type: "language" }).of(c);
    if (!name || name.toLowerCase() === c.toLowerCase()) return c;
    return name.charAt(0).toLocaleUpperCase("fr") + name.slice(1);
  } catch {
    return c;
  }
}

export type FilterNames = {
  channels?: Record<string, string>;
  campaigns?: Record<string, string>;
  inviteLinks?: Record<string, string>;
  /** Noms des affiliés Link Affi par identifiant. */
  affiliates?: Record<string, string>;
};

export type ActiveFilter = {
  /** Filtre concerné (`since` porte aussi `until` : une seule pastille pour les dates d'arrivée). */
  key: MemberFilterKey;
  /** Phrase affichée (« Ont déposé », « Venus de la campagne « Casino octobre » »). */
  label: string;
  /** Lien qui retire ce filtre. */
  removeHref: string;
};

function arrivalLabel(since: string, until: string): string {
  const day = (v: string) => (isDayKey(v) ? fmtDayKey(v) : v);
  if (since && until) return `Arrivés du ${day(since)} au ${day(until)}`;
  if (since) return `Arrivés depuis le ${day(since)}`;
  return `Arrivés jusqu'au ${day(until)}`;
}

/** Phrase d'un filtre actif (sans le lien) ; null si le filtre est vide. */
export function filterLabel(
  f: MemberFilters,
  key: MemberFilterKey,
  names: FilterNames = {},
): string | null {
  switch (key) {
    case "q":
      return f.q ? `Recherche : « ${f.q} »` : null;
    case "deposited":
      return f.deposited ? "Ont déposé" : null;
    case "ftd":
      return f.ftd ? FTD_PERIOD_LABELS[f.ftd] : null;
    case "inactive":
      return f.inactive ? `Rien fait depuis ${f.inactive} jour${f.inactive > 1 ? "s" : ""}` : null;
    case "universe":
      return f.universe ? `Univers : ${UNIVERSE_LABELS[f.universe]}` : null;
    case "campaignId":
      return f.campaignId
        ? `Venus de la campagne « ${names.campaigns?.[f.campaignId] ?? "inconnue"} »`
        : null;
    case "affiliateId":
      return f.affiliateId
        ? `Amenés par l'affilié « ${names.affiliates?.[f.affiliateId] ?? f.affiliateId} »`
        : null;
    case "inviteLinkId":
      return f.inviteLinkId
        ? `Venus de la pub « ${names.inviteLinks?.[f.inviteLinkId] ?? "inconnue"} »`
        : null;
    case "channelId":
      return f.channelId ? `Canal : ${names.channels?.[f.channelId] ?? "inconnu"}` : null;
    case "tag":
      return f.tag ? `Étiquette : ${f.tag}` : null;
    case "status":
      return f.status ? `Statut : ${statusLabel("membership", f.status)}` : null;
    case "level":
      return f.level ? `Niveau : ${SPEND_LEVEL_LABELS[f.level]}` : null;
    case "language":
      return f.language ? `Langue : ${languageName(f.language)}` : null;
    case "since":
    case "until":
      return f.since || f.until ? arrivalLabel(f.since, f.until) : null;
  }
}

/** Ordre d'affichage des pastilles de filtres actifs : du plus parlant au plus technique. */
const DISPLAY_ORDER: MemberFilterKey[] = [
  "q",
  "deposited",
  "ftd",
  "inactive",
  "universe",
  "campaignId",
  "affiliateId",
  "inviteLinkId",
  "channelId",
  "tag",
  "status",
  "level",
  "language",
  "since",
];

/** Filtres actifs en phrases, chacun avec son lien « retirer » (le reste des filtres et le tri sont conservés). */
export function describeMemberFilters(f: MemberFilters, names: FilterNames = {}): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  for (const key of DISPLAY_ORDER) {
    const label = filterLabel(f, key, names);
    if (!label) continue;
    const cleared: Partial<MemberFilters> =
      key === "since" ? { since: "", until: "" } : { [key]: EMPTY[key] };
    out.push({ key, label, removeHref: membersHref(f, cleared) });
  }
  return out;
}

export type QuickChip = { key: string; label: string; href: string; selected: boolean };

/** Raccourcis « Activité » : un clic ajoute le filtre, un second clic le retire. */
export function activityChips(f: MemberFilters): QuickChip[] {
  const inactive = (n: number): QuickChip => ({
    key: `inactive-${n}`,
    label: `Rien fait depuis ${n} jours`,
    selected: f.inactive === n,
    href: membersHref(f, { inactive: f.inactive === n ? "" : n }),
  });
  return [
    {
      key: "deposited",
      label: "Ont déposé",
      selected: f.deposited,
      href: membersHref(f, { deposited: !f.deposited }),
    },
    {
      key: "ftd-7d",
      label: "Premier dépôt ces 7 jours",
      selected: f.ftd === "7d",
      href: membersHref(f, { ftd: f.ftd === "7d" ? "" : "7d" }),
    },
    ...MEMBER_INACTIVE_CHOICES.map(inactive),
  ];
}

/** Raccourcis « Univers » : Tous, Casino, Paris sportifs, Rencontres (un seul à la fois). */
export function universeChips(f: MemberFilters): Array<QuickChip & { universe: Universe | null }> {
  return [
    {
      key: "all",
      universe: null,
      label: "Tous",
      selected: !f.universe,
      href: membersHref(f, { universe: "" }),
    },
    ...UNIVERSES.map((u) => ({
      key: u,
      universe: u,
      label: UNIVERSE_LABELS[u],
      selected: f.universe === u,
      href: membersHref(f, { universe: u }),
    })),
  ];
}

/** Liens de tri (le tri se fait sur toute la liste, côté serveur). */
export function sortLinks(
  f: MemberFilters,
): Array<{ sort: MemberSort; label: string; href: string; current: boolean }> {
  return (Object.keys(SORT_LABELS) as MemberSort[]).map((s) => ({
    sort: s,
    label: SORT_LABELS[s],
    href: membersHref(f, { sort: s }),
    current: f.sort === s,
  }));
}

/** Niveaux de dépense qui supposent au moins un dépôt (même règle que `computeSpendLevel`). */
export const DEPOSIT_LEVELS: SpendLevel[] = ["DEPOSANT", "REGULIER", "VIP"];

export type BroadcastLink = {
  href: string;
  /** Filtres qui ne se traduisent pas en groupe de membres (phrases courtes : « la recherche »). */
  dropped: string[];
  /** Au moins un filtre a été repris. */
  carried: boolean;
};

/**
 * Lien vers « Écrire à un groupe » avec les filtres qui se traduisent en groupe de membres (mêmes noms que
 * le `Segment` de `@linkaffipro/core`, listes en paramètres répétés) : channelIds, membershipStatuses, spendLevels,
 * inviteLinkIds, campaignIds, languages, inactiveDays, tags. L'univers devient la liste de ses canaux.
 * Non repris : la recherche, l'affilié, le premier dépôt dans une période, les dates d'arrivée, un statut que l'assistant ne
 * propose pas (Refusé, Acceptation échouée), et la campagne quand un canal, un univers, un statut ou une pub est
 * repris : le groupe lit tous ces critères sur une même demande pour rejoindre, alors que la liste lit la campagne
 * sur n'importe laquelle de ses demandes (le groupe viserait d'autres membres que la liste).
 */
export function broadcastLink(
  f: MemberFilters,
  channelsByUniverse: Partial<Record<Universe, string[]>> = {},
): BroadcastLink {
  const p = new URLSearchParams();
  const dropped: string[] = [];
  // Critères que le groupe lit sur la même demande que la campagne.
  const sameRequest: string[] = [];
  if (f.channelId) {
    p.append("channelIds", f.channelId);
    sameRequest.push("le canal");
  } else if (f.universe) {
    const ids = channelsByUniverse[f.universe] ?? [];
    if (ids.length) {
      for (const id of ids) p.append("channelIds", id);
      sameRequest.push("l'univers");
    } else dropped.push("l'univers");
  }
  if (f.status) {
    if ((BROADCAST_STATUSES as readonly string[]).includes(f.status)) {
      p.append("membershipStatuses", f.status);
      sameRequest.push("le statut");
    } else dropped.push(`le statut « ${statusLabel("membership", f.status)} »`);
  }
  if (f.level) p.append("spendLevels", f.level);
  else if (f.deposited) for (const l of DEPOSIT_LEVELS) p.append("spendLevels", l);
  if (f.inviteLinkId) {
    p.append("inviteLinkIds", f.inviteLinkId);
    sameRequest.push("la pub");
  }
  if (f.campaignId && sameRequest.length === 0) p.append("campaignIds", f.campaignId);
  if (f.language) p.append("languages", f.language);
  if (f.inactive) p.set("inactiveDays", String(f.inactive));
  if (f.tag) p.append("tags", f.tag);
  if (f.q) dropped.push("la recherche");
  if (f.affiliateId) dropped.push("l'affilié");
  if (f.ftd) dropped.push("le premier dépôt");
  if (f.since || f.until) dropped.push("les dates d'arrivée");
  // En dernier : la phrase porte sa raison (« …, sauf la recherche et la campagne, qui ne s'y combine pas avec le statut »).
  if (f.campaignId && sameRequest.length > 0)
    dropped.push(`la campagne, qui ne s'y combine pas avec ${joinFr(sameRequest, "ou")}`);
  const s = p.toString();
  return {
    href: s ? `${BROADCAST_NEW_PATH}?${s}` : BROADCAST_NEW_PATH,
    dropped,
    carried: s !== "",
  };
}

/**
 * Phrase sous les filtres de la liste : ce qu'« Écrire à un groupe » reprendra ; null sans filtre.
 * (Sans critère repris, tous les filtres actifs sont dans `dropped`.)
 */
export function broadcastNote(link: BroadcastLink): string | null {
  const name = "« Écrire à un groupe »";
  if (link.carried)
    return link.dropped.length
      ? `${name} reprend vos filtres, sauf ${joinFr(link.dropped)}.`
      : `${name} reprend vos filtres.`;
  if (!link.dropped.length) return null;
  return `${name} ne reprend pas ${link.dropped.length > 1 ? "ces filtres" : "ce filtre"} : vous choisirez le groupe vous-même.`;
}

/** « la recherche et le premier dépôt » ; « la recherche, l'univers et les dates d'arrivée » ; « le canal ou la pub ». */
export function joinFr(parts: string[], last: "et" | "ou" = "et"): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${last} ${parts[parts.length - 1]}`;
}
