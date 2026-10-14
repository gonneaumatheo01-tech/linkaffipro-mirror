/**
 * Pages de Statistiques (phase 9) : rubriques, sélecteur commun et adresses. Fonctions pures, testées dans
 * stats-pages.test.ts. Le sélecteur (période avec comparaison, univers, campagne, et le canal et l'affilié Link Affi
 * dans « Plus de filtres ») vit dans l'adresse : il garde ses valeurs d'une page à l'autre (sous-navigation, retour
 * d'une action). L'affilié (phase 13) ne s'applique qu'à la vue d'ensemble (`AFFILIATE_FILTER_PAGES`).
 */
import { isVertical, type Vertical } from "@linkaffipro/core";
import { universeLabel } from "@/lib/universe";
import {
  isDayKey,
  parseCompare,
  parsePeriodKey,
  periodLabelWithDates,
  periodParams,
  previousPeriod,
  resolvePeriod,
  type Period,
  type PeriodKey,
} from "@/lib/periods";

export type StatsPageKey = "overview" | "ads" | "funnel" | "channels" | "cohorts";

/** Période commune par défaut des statistiques (adresse sans `range`). */
export const STATS_DEFAULT_RANGE: PeriodKey = "7d";

/**
 * Les cinq pages, dans l'ordre de la sous-navigation. `label` : mot court de l'onglet ; `title` : titre de la page
 * (le `<h1>`), précisé quand le mot court est aussi une entrée du menu (« Canaux ») ou un onglet d'une campagne
 * (« Pubs »). `term` : terme technique au survol des mots `termOn` de la ligne d'aide (« parcours » → entonnoir).
 * `defaultRange` : période de la page quand l'adresse n'en choisit pas (« Membres dans le temps » compare des
 * semaines : 90 jours, sinon une seule barre).
 */
export const STATS_PAGES: ReadonlyArray<{
  key: StatsPageKey;
  path: string;
  label: string;
  title: string;
  term?: string;
  termOn?: string;
  description: string;
  defaultRange?: PeriodKey;
}> = [
  {
    key: "overview",
    path: "/stats",
    label: "Vue d'ensemble",
    title: "Statistiques",
    description: "Ce que vos canaux et vos campagnes ont donné sur la période.",
  },
  {
    key: "ads",
    path: "/stats/ads",
    label: "Pubs",
    title: "Statistiques des pubs",
    description: "Ce que chaque campagne a coûté et ce qu'elle a rapporté.",
  },
  {
    key: "funnel",
    path: "/stats/funnel",
    label: "Parcours",
    title: "Parcours",
    term: "entonnoir",
    termOn: "parcours",
    description:
      "Du clic sur la pub jusqu'au dépôt : combien de personnes passent chaque étape du parcours.",
  },
  {
    key: "channels",
    path: "/stats/channels",
    label: "Canaux",
    title: "Statistiques des canaux",
    description: "Comment vos canaux grandissent, et quels messages font cliquer.",
  },
  {
    key: "cohorts",
    path: "/stats/cohorts",
    label: "Membres dans le temps",
    title: "Membres dans le temps",
    term: "cohorte",
    termOn: "membres arrivés chaque semaine",
    description:
      "Les membres arrivés chaque semaine : combien s'inscrivent, déposent, et ce qu'ils rapportent.",
    defaultRange: "90d",
  },
];

export function statsPage(key: StatsPageKey) {
  return STATS_PAGES.find((p) => p.key === key)!;
}

/** Période par défaut de la page à l'adresse `path` (7 derniers jours, sauf « Membres dans le temps »). */
export function statsDefaultRange(path: string): PeriodKey {
  return STATS_PAGES.find((p) => p.path === path)?.defaultRange ?? STATS_DEFAULT_RANGE;
}

type Param = string | string[] | undefined;
export type StatsSearchParams = Record<string, Param>;

const one = (v: Param): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** Sélecteur commun, lu dans l'adresse. */
export type StatsFilters = {
  period: Period;
  compare: boolean;
  vertical: Vertical | "";
  campaignId: string;
  channelId: string;
  /** Affilié Link Affi (identifiant Link Affi) : ses membres, leurs clics d'offre et ses joueurs (phase 13). */
  affiliateId?: string;
  /**
   * Vrai quand l'adresse ne choisit pas la période (période par défaut de la page) : les liens vers les autres pages
   * ne l'écrivent pas, chacune prend alors la sienne.
   */
  defaultPeriod?: boolean;
};

/** Paramètres du sélecteur (tout le reste de l'adresse est propre à une page ou à un message de retour). */
export const STATS_FILTER_PARAMS = [
  "range",
  "from",
  "to",
  "compare",
  "vertical",
  "campaignId",
  "channelId",
  "affiliateId",
] as const;

/** Pages où le filtre « Affilié » s'applique (les autres le gardent dans l'adresse sans s'en servir). */
export const AFFILIATE_FILTER_PAGES: readonly StatsPageKey[] = ["overview"];

/** L'adresse choisit-elle une période (`range` connu, ou deux dates valides pour une période personnalisée) ? */
function choosesPeriod(sp: StatsSearchParams): boolean {
  const key = parsePeriodKey(sp.range);
  if (key && key !== "custom") return true;
  return isDayKey(one(sp.from)) && isDayKey(one(sp.to));
}

/**
 * Lit le sélecteur dans l'adresse. Sans période dans l'adresse : `defaultRange`, la période par défaut de la page
 * (`statsDefaultRange`). Ancienne adresse du parcours (`dim=campaign:…`, `channel:…`, `vertical:…`) : le filtre
 * correspondant est rempli s'il est vide, pour que le sélecteur montre ce qui est affiché.
 */
export function parseStatsFilters(
  sp: StatsSearchParams,
  now = new Date(),
  defaultRange: PeriodKey = STATS_DEFAULT_RANGE,
): StatsFilters {
  const v = one(sp.vertical);
  const chosen = choosesPeriod(sp);
  const f: StatsFilters = {
    period: resolvePeriod(chosen ? sp : { range: defaultRange }, now),
    compare: parseCompare(sp.compare),
    vertical: isVertical(v) ? v : "",
    campaignId: one(sp.campaignId),
    channelId: one(sp.channelId),
    affiliateId: one(sp.affiliateId).trim().slice(0, 128),
    defaultPeriod: !chosen,
  };
  const dim = parseFunnelDim(one(sp.dim));
  if (dim?.kind === "campaign" && !f.campaignId) f.campaignId = dim.id;
  if (dim?.kind === "channel" && !f.channelId) f.channelId = dim.id;
  if (dim?.kind === "vertical" && !f.vertical) f.vertical = dim.id;
  return f;
}

/** Paramètres d'adresse du sélecteur (dans l'ordre, sans les valeurs vides). */
export function statsParams(f: StatsFilters): Record<string, string> {
  return {
    ...periodParams(f.period, f.compare),
    ...(f.vertical ? { vertical: f.vertical } : {}),
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    ...(f.channelId ? { channelId: f.channelId } : {}),
    ...(f.affiliateId ? { affiliateId: f.affiliateId } : {}),
  };
}

/**
 * Adresse d'une page des statistiques avec le sélecteur (et des paramètres en plus). La période n'est pas écrite
 * quand c'est celle par défaut de la page visée (« /stats/ads » plutôt que « /stats/ads?range=7d »), ni quand
 * l'adresse d'origine n'en choisissait pas (`defaultPeriod`) : de la vue d'ensemble (7 jours par défaut),
 * « Membres dans le temps » s'ouvre sur ses 90 jours.
 */
export function statsHref(
  path: string,
  f: StatsFilters,
  extra: Record<string, string | undefined> = {},
): string {
  const p = new URLSearchParams(statsParams(f));
  if (f.defaultPeriod || p.get("range") === statsDefaultRange(path)) p.delete("range");
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Paramètres du sélecteur repris d'un formulaire (retour d'une action serveur vers la page) : seules les clés du
 * sélecteur passent, les valeurs sont relues comme dans l'adresse (rien d'autre n'est recopié).
 */
export function statsParamsFromForm(form: Iterable<[string, unknown]>): Record<string, string> {
  const raw: StatsSearchParams = {};
  for (const [k, v] of form)
    if ((STATS_FILTER_PARAMS as readonly string[]).includes(k) && typeof v === "string") raw[k] = v;
  const f = parseStatsFilters(raw);
  const out = statsParams(f);
  if (out.range === "7d") delete out.range;
  return out;
}

// ——— Parcours (ex-entonnoir) ———

type FunnelDim =
  | { kind: "campaign"; id: string }
  | { kind: "channel"; id: string }
  | { kind: "vertical"; id: Vertical };

/** Dimension de l'ancien sélecteur du parcours (`all`, `campaign:<id>`, `channel:<id>`, `vertical:<univers>`). */
export function parseFunnelDim(dim: string): FunnelDim | null {
  const m = /^(campaign|channel|vertical):(.+)$/.exec(dim);
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === "vertical") return isVertical(id) ? { kind, id } : null;
  return { kind: kind as "campaign" | "channel", id: id! };
}

/**
 * Dimension des statistiques journalières montrée par le parcours (une seule à la fois) : la campagne si elle est
 * choisie, sinon le canal, sinon l'univers, sinon tout (même ordre que l'ancien tableau de bord).
 */
export function funnelDimension(
  f: Pick<StatsFilters, "campaignId" | "channelId" | "vertical">,
): string {
  if (f.campaignId) return `campaign:${f.campaignId}`;
  if (f.channelId) return `channel:${f.channelId}`;
  if (f.vertical) return `vertical:${f.vertical}`;
  return "all";
}

/** Ce que montre le parcours, en une phrase : « Parcours de la campagne « TT casino » ». */
export function funnelScopeLabel(
  f: Pick<StatsFilters, "campaignId" | "channelId" | "vertical">,
  names: { campaign?: string; channel?: string },
): string {
  if (f.campaignId) return `Parcours de la campagne « ${names.campaign ?? "inconnue"} »`;
  if (f.channelId) return `Parcours du canal « ${names.channel ?? "inconnu"} »`;
  if (f.vertical) return `Parcours de l'univers ${universeLabel(f.vertical)}`;
  return "Parcours de toutes vos pubs et de tous vos canaux";
}

// ——— Période ———

/**
 * Ligne sous le sélecteur : « 7 derniers jours (4 oct. – 10 oct. 2026) », avec la période précédente quand la
 * comparaison est cochée : « …, comparés au 27 sept. – 3 oct. 2026 ».
 */
export function periodSentence(period: Period, compare: boolean): string {
  const current = periodLabelWithDates(period);
  if (!compare) return current;
  const prev = periodLabelWithDates(previousPeriod(period)).replace(/^Du /, "du ");
  return `${current}, comparés à la période précédente (${prev})`;
}

/** Nombre de filtres rangés dans « Plus de filtres » : le canal, et l'affilié Link Affi. */
export function moreFiltersCount(f: Pick<StatsFilters, "channelId" | "affiliateId">): number {
  return (f.channelId ? 1 : 0) + (f.affiliateId ? 1 : 0);
}

/** Phrase des pages qui ne savent pas filtrer par affilié, quand le filtre est posé (null sinon). */
export function affiliateIgnoredNote(
  page: StatsPageKey,
  f: Pick<StatsFilters, "affiliateId">,
): string | null {
  if (!f.affiliateId || AFFILIATE_FILTER_PAGES.includes(page)) return null;
  return "Le filtre « Affilié » ne s'applique qu'à la vue d'ensemble : cette page montre tous les membres.";
}
