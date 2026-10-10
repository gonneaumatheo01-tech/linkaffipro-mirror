/**
 * Pages de Statistiques (phase 9) : rubriques, sélecteur commun et adresses. Fonctions pures, testées dans
 * stats-pages.test.ts. Le sélecteur (période avec comparaison, univers, campagne, et le canal dans « Plus de
 * filtres ») vit dans l'adresse : il garde ses valeurs d'une page à l'autre (sous-navigation, retour d'une action).
 */
import { isVertical, type Vertical } from "@linkaffipro/core";
import { universeLabel } from "@/lib/universe";
import {
  parseCompare,
  periodLabelWithDates,
  periodParams,
  previousPeriod,
  resolvePeriod,
  type Period,
} from "@/lib/periods";

export type StatsPageKey = "overview" | "ads" | "funnel" | "channels" | "cohorts";

/**
 * Les cinq pages, dans l'ordre de la sous-navigation. `term` : terme technique au survol des mots `termOn` de la
 * ligne d'aide (« parcours » → entonnoir).
 */
export const STATS_PAGES: ReadonlyArray<{
  key: StatsPageKey;
  path: string;
  label: string;
  title: string;
  term?: string;
  termOn?: string;
  description: string;
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
    title: "Pubs",
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
    title: "Canaux",
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
  },
];

export function statsPage(key: StatsPageKey) {
  return STATS_PAGES.find((p) => p.key === key)!;
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
] as const;

/**
 * Lit le sélecteur dans l'adresse. Ancienne adresse du parcours (`dim=campaign:…`, `channel:…`, `vertical:…`) :
 * le filtre correspondant est rempli s'il est vide, pour que le sélecteur montre ce qui est affiché.
 */
export function parseStatsFilters(sp: StatsSearchParams, now = new Date()): StatsFilters {
  const v = one(sp.vertical);
  const f: StatsFilters = {
    period: resolvePeriod(sp, now),
    compare: parseCompare(sp.compare),
    vertical: isVertical(v) ? v : "",
    campaignId: one(sp.campaignId),
    channelId: one(sp.channelId),
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
  };
}

/**
 * Adresse d'une page des statistiques avec le sélecteur (et des paramètres en plus). La période par défaut
 * (7 derniers jours, sans comparaison) n'est pas écrite : « /stats/ads » plutôt que « /stats/ads?range=7d ».
 */
export function statsHref(
  path: string,
  f: StatsFilters,
  extra: Record<string, string | undefined> = {},
): string {
  const p = new URLSearchParams(statsParams(f));
  if (p.get("range") === "7d") p.delete("range");
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

/** Nombre de filtres rangés dans « Plus de filtres » (aujourd'hui : le canal). */
export function moreFiltersCount(f: Pick<StatsFilters, "channelId">): number {
  return f.channelId ? 1 : 0;
}
