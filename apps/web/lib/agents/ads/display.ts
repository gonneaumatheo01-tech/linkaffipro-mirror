/**
 * Agent Ads à l'écran (`/agents/ads`, phase 24) : période, mots des chiffres, parcours d'une campagne, meilleures et
 * pires pubs, preuves des recommandations en phrases, gestes permis. Fonctions pures, testées (ads.test.ts).
 *
 * Les chiffres viennent tous de `computeAdsAnalysis` (moteur, `@linkaffipro/agents`) : rien n'est recalculé ici,
 * sauf les taux d'une étape à l'autre du parcours (simple division des chiffres reçus, pour l'affichage).
 * L'agent ne change jamais rien chez Meta ou TikTok : « Fait » veut dire « je l'ai fait moi-même ».
 */
import type { AdsAnalysis, AdsMetrics, AdsPeriod, AdsRow } from "@linkaffipro/agents";
import { METRIC_VIEWS, type MetricView } from "@/lib/dashboard/display";
import { formatValue } from "@/components/charts/chart-logic";
import { isDayKey } from "@/lib/periods";

export const ADS_PATH = "/agents/ads";

// ---------------------------------------------------------------- période

export const ADS_PERIODS = ["yesterday", "7d", "28d"] as const satisfies readonly AdsPeriod[];

export const ADS_PERIOD_LABELS: Record<AdsPeriod, string> = {
  yesterday: "Hier",
  "7d": "7 derniers jours",
  "28d": "28 derniers jours",
};

/** Période lue dans l'adresse (`?periode=`) ; 7 jours par défaut (assez de jours pour juger une pub). */
export function parseAdsPeriod(v: unknown): AdsPeriod {
  const s = Array.isArray(v) ? v[0] : v;
  return (ADS_PERIODS as readonly string[]).includes(s as string) ? (s as AdsPeriod) : "7d";
}

/** Filtres des pages Statistiques pour les mêmes jours (lien « Voir le détail ») ; repli sur la période la plus proche. */
export function statsPeriodParams(a: Pick<AdsAnalysis, "period" | "from" | "to">): Record<string, string> {
  const from = a.from.slice(0, 10);
  const to = a.to.slice(0, 10);
  if (isDayKey(from) && isDayKey(to)) return { range: "custom", from, to };
  return { range: a.period === "28d" ? "30d" : a.period };
}

export function statsHref(path: string, a: Pick<AdsAnalysis, "period" | "from" | "to">, extra: Record<string, string> = {}): string {
  return `${path}?${new URLSearchParams({ ...statsPeriodParams(a), ...extra }).toString()}`;
}

// ---------------------------------------------------------------- chiffres

export type AdsMetricKey = keyof AdsMetrics;

/**
 * Chiffre des pages Statistiques qui porte la même valeur qu'un chiffre de l'Agent Ads (le moteur lit `DailyStat` :
 * `landingVisits` = `entryClicks`, `telegramJoins` = `requests`, `members` = `joined`) : même mot des deux côtés.
 * Un chiffre absent d'ici n'a pas d'équivalent dans Statistiques et porte un mot à lui (règle : un mot = un chiffre).
 */
export const ADS_STATS_EQUIVALENT: Partial<Record<AdsMetricKey, keyof typeof METRIC_VIEWS>> = {
  spend: "spend",
  landingVisits: "entryClicks",
  telegramJoins: "requests",
  members: "joined",
  offerClicks: "offerClicks",
  registrations: "registrations",
  ftds: "ftds",
  deposits: "deposits",
  commissions: "commissions",
  gains: "gains",
  roas: "roas",
  costPerMember: "cpl",
  costPerRegistration: "cpa",
  costPerFtd: "costPerFtd",
};

/** Mot du client, terme au survol, sens favorable et format de chaque chiffre (mêmes mots que Statistiques). */
export const ADS_METRIC_VIEWS: Record<AdsMetricKey, MetricView> = {
  spend: METRIC_VIEWS.spend,
  impressions: { label: "Affichages de la pub", term: "impressions", favorable: "up", format: "number", integer: true },
  // Clics comptés par la régie (Meta / TikTok) : pas le même chiffre que « Clics sur les pubs » de Statistiques
  // (passages par nos liens, `entryClicks`, ici `landingVisits`).
  adClicks: { label: "Clics comptés par Meta / TikTok", term: "clics de la régie", favorable: "up", format: "number", integer: true },
  landingVisits: METRIC_VIEWS.entryClicks,
  telegramJoins: METRIC_VIEWS.requests,
  members: METRIC_VIEWS.joined,
  offerClicks: METRIC_VIEWS.offerClicks,
  registrations: METRIC_VIEWS.registrations,
  ftds: METRIC_VIEWS.ftds,
  deposits: METRIC_VIEWS.deposits,
  commissions: METRIC_VIEWS.commissions,
  gains: METRIC_VIEWS.gains,
  roas: METRIC_VIEWS.roas,
  costPerMember: METRIC_VIEWS.cpl,
  costPerRegistration: METRIC_VIEWS.cpa,
  costPerFtd: METRIC_VIEWS.costPerFtd,
};

export function fmtAds(key: AdsMetricKey, v: number | null | undefined): string {
  return formatValue(v, ADS_METRIC_VIEWS[key].format);
}

// ---------------------------------------------------------------- parcours

/**
 * Étapes du parcours, de l'affichage de la pub au premier dépôt : celles du moteur (`FUNNEL_STEPS` de
 * `@linkaffipro/agents`, goulot compris), dans son ordre. Recopiées (pas importées) pour que les pages qui simulent le
 * moteur dans leurs tests restent simples ; ads.test.ts vérifie qu'elles sont identiques.
 */
export const FUNNEL_STEPS: AdsMetricKey[] = [
  "impressions",
  "adClicks",
  "landingVisits",
  "telegramJoins",
  "offerClicks",
  "registrations",
  "ftds",
];

/** Noms possibles du goulot écrits par le moteur (clé du chiffre ou de l'étape). */
const BOTTLENECK_ALIASES: Record<string, AdsMetricKey> = {
  impression: "impressions",
  click: "adClicks",
  clicks: "adClicks",
  adclick: "adClicks",
  visit: "landingVisits",
  visits: "landingVisits",
  landing: "landingVisits",
  join: "telegramJoins",
  joins: "telegramJoins",
  telegram: "telegramJoins",
  members: "telegramJoins",
  member: "telegramJoins",
  offer: "offerClicks",
  offerclick: "offerClicks",
  registration: "registrations",
  ftd: "ftds",
  ftds: "ftds",
  firstdeposit: "ftds",
};

/** Étape visée par le goulot (`AdsRow.bottleneck`), ou null si inconnue. */
export function bottleneckStep(b: string | null | undefined): AdsMetricKey | null {
  if (!b) return null;
  const head = b.split(/[→>\-_:]/)[0]?.trim() ?? b;
  for (const k of [b, head]) {
    if ((FUNNEL_STEPS as string[]).includes(k)) return k as AdsMetricKey;
    const alias = BOTTLENECK_ALIASES[k.toLowerCase().replace(/[^a-z]/g, "")];
    if (alias) return alias;
  }
  return null;
}

export type FunnelStepView = {
  key: AdsMetricKey;
  label: string;
  term?: string;
  value: number;
  /** Part gardée depuis l'étape d'avant (null pour la première, ou si l'étape d'avant vaut 0). */
  rate: number | null;
  /** Étape la plus faible d'après le moteur. */
  weakest: boolean;
};

/**
 * Parcours d'une ligne : chaque étape, sa valeur et la part gardée depuis l'étape d'avant. Les étapes à zéro au
 * début (pas d'affichages remontés sans connecteur, pas de page d'atterrissage) sont retirées : la première étape
 * affichée est la première qui a un chiffre.
 */
export function funnelSteps(row: Pick<AdsRow, "current" | "bottleneck">): FunnelStepView[] {
  const weak = bottleneckStep(row.bottleneck);
  const first = FUNNEL_STEPS.findIndex((k) => (row.current[k] ?? 0) > 0);
  if (first < 0) return [];
  const keys = FUNNEL_STEPS.slice(first);
  return keys.map((key, i) => {
    const value = row.current[key] ?? 0;
    const prev = i > 0 ? (row.current[keys[i - 1]!] ?? 0) : null;
    const v = ADS_METRIC_VIEWS[key];
    return {
      key,
      label: v.label,
      term: v.term,
      value,
      rate: prev && prev > 0 ? value / prev : null,
      weakest: weak === key,
    };
  });
}

// ---------------------------------------------------------------- classements


/**
 * Meilleures et pires pubs de la période : seulement celles qui ont assez de données (les autres sont « à
 * surveiller »), classées par gains, puis par retour sur dépense. Une pub n'est jamais à la fois dans les deux listes.
 */
export function rankAds(rows: readonly AdsRow[], n = 5): { best: AdsRow[]; worst: AdsRow[]; young: AdsRow[] } {
  const ads = rows.filter((r) => r.level === "ad");
  const judged = ads.filter((r) => r.enoughData);
  const sorted = [...judged].sort(
    (a, b) => b.current.gains - a.current.gains || (b.current.roas ?? -Infinity) - (a.current.roas ?? -Infinity),
  );
  const best = sorted.slice(0, n);
  const taken = new Set(best.map((r) => r.id));
  const worst = [...sorted]
    .reverse()
    .filter((r) => !taken.has(r.id))
    .slice(0, n);
  const young = ads.filter((r) => !r.enoughData).sort((a, b) => b.current.spend - a.current.spend);
  return { best, worst, young };
}

/** Meilleure et pire pub d'hier (résumé du jour) ; null quand rien n'est assez mûr. */
export function bestAndWorst(rows: readonly AdsRow[]): { best: AdsRow | null; worst: AdsRow | null } {
  const { best, worst } = rankAds(rows, 1);
  return { best: best[0] ?? null, worst: worst[0] ?? null };
}

/** Campagnes de la période, de la plus grosse dépense à la plus petite. */
export function campaignRows(rows: readonly AdsRow[]): AdsRow[] {
  return rows.filter((r) => r.level === "campaign").sort((a, b) => b.current.spend - a.current.spend);
}

/** Campagne choisie pour le parcours (`?campagne=`), sinon la plus grosse dépense. */
export function pickCampaign(rows: readonly AdsRow[], id: unknown): AdsRow | null {
  const list = campaignRows(rows);
  return list.find((r) => r.id === id) ?? list[0] ?? null;
}

/** Une phrase sous une pub : « 120 € dépensés, 3 inscriptions, gains 45 € ». */
export function adLine(r: Pick<AdsRow, "current">): string {
  const c = r.current;
  const parts = [`${fmtAds("spend", c.spend)} dépensés`, `${c.registrations.toLocaleString("fr-FR")} inscription${c.registrations > 1 ? "s" : ""}`];
  if (c.roas !== null) parts.push(`retour sur dépense pub ${fmtAds("roas", c.roas)}`);
  parts.push(`gains ${fmtAds("gains", c.gains)}`);
  return parts.join(", ");
}

// ---------------------------------------------------------------- recommandations

export type AdsAction = "STOP" | "SCALE" | "TEST" | "WATCH";
export const ADS_ACTIONS: readonly AdsAction[] = ["STOP", "SCALE", "TEST", "WATCH"];

export function parseAdsAction(v: unknown): AdsAction | null {
  return ADS_ACTIONS.includes(v as AdsAction) ? (v as AdsAction) : null;
}

/** Ce que le client fait lui-même chez Meta / TikTok pour chaque action. */
export const ADS_ACTION_HOWTO: Record<AdsAction, string> = {
  STOP: "Mettez cette pub en pause dans le gestionnaire de pubs (Meta ou TikTok).",
  SCALE: "Montez le budget petit à petit (20 à 30 % à la fois) dans le gestionnaire de pubs.",
  TEST: "Créez une variante dans le gestionnaire de pubs, à côté de celle qui marche.",
  WATCH: "Rien à faire pour l'instant : l'agent attend d'avoir assez de chiffres.",
};

/** Ordre d'affichage : à arrêter d'abord (argent perdu), puis à augmenter, à tester, à surveiller. */
const ACTION_ORDER: Record<string, number> = { STOP: 0, SCALE: 1, TEST: 2, WATCH: 3 };

export type AdsRecommendationView = {
  id: string;
  target: string;
  targetId: string;
  action: string | null;
  evidence: unknown;
  expectedGain: string | null;
  status: string;
  comment: string | null;
  doneAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  /** Nom de la cible (campagne, groupe, pub), résolu par la requête. */
  targetLabel: string;
  /** Campagne de la cible (lien vers sa fiche, onglet Pubs). */
  campaignId: string | null;
  vertical: string | null;
};

export function sortRecommendations<T extends Pick<AdsRecommendationView, "action" | "createdAt">>(recs: readonly T[]): T[] {
  return [...recs].sort(
    (a, b) =>
      (ACTION_ORDER[a.action ?? ""] ?? 9) - (ACTION_ORDER[b.action ?? ""] ?? 9) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

const TARGET_LABELS: Record<string, string> = { CAMPAIGN: "Campagne", ADSET: "Groupe de pubs", AD: "Pub" };

export function adsTargetLabel(target: string): string {
  return TARGET_LABELS[target] ?? "Pub";
}

/** « Fait » et « Refuser » : seulement sur une recommandation à décider ; managers compris. */
export function canMarkRecommendation(status: string): boolean {
  return status === "PROPOSED";
}

export const COMMENT_MAX = 500;

/** Commentaire facultatif du client : espaces retirés, 500 caractères au plus, null si vide. */
export function cleanComment(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, COMMENT_MAX) : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cut(s: string, max = 240): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Chiffres connus d'une preuve, avec leur mot (les clés du moteur, en plus des chiffres de `AdsMetrics`). */
const EVIDENCE_EXTRA: Array<[string, string, "money" | "ratio" | "int" | "pct"]> = [
  ["days", "jours observés", "int"],
  ["observationDays", "jours observés", "int"],
  ["daysOverThreshold", "jours au-dessus du seuil", "int"],
  ["threshold", "seuil", "money"],
  ["targetCostPerRegistration", "coût par inscription visé", "money"],
  ["minRoas", "retour sur dépense pub minimal", "ratio"],
  ["minSpend", "dépense minimale", "money"],
  ["budgetUsed", "budget utilisé", "pct"],
];

function evidenceNumber(key: string, v: number): string | null {
  if (key in ADS_METRIC_VIEWS) return `${ADS_METRIC_VIEWS[key as AdsMetricKey].label.toLowerCase()} ${fmtAds(key as AdsMetricKey, v)}`;
  const extra = EVIDENCE_EXTRA.find(([k]) => k === key);
  if (!extra) return null;
  const [, label, kind] = extra;
  const text =
    kind === "money"
      ? formatValue(v, "money")
      : kind === "ratio"
        ? formatValue(v, "ratio")
        : kind === "pct"
          ? `${(v <= 1 ? v * 100 : v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`
          : v.toLocaleString("fr-FR");
  return kind === "int" ? `${text} ${label}` : `${label} ${text}`;
}

/**
 * Preuves en phrases courtes : texte du moteur d'abord (`summary`, `text`, `reason`, `lines`), puis les chiffres
 * qu'il a joints (à plat, ou dans `metrics` / `current`), la période et la comparaison. Lecture tolérante.
 */
export function adsEvidenceLines(e: unknown): string[] {
  if (typeof e === "string") return e ? [cut(e)] : [];
  if (!isObj(e)) return [];
  const out: string[] = [];
  for (const k of ["summary", "text", "reason", "why"]) if (typeof e[k] === "string" && e[k]) out.push(cut(e[k] as string));
  if (Array.isArray(e.lines)) for (const l of e.lines) if (typeof l === "string" && l) out.push(cut(l));
  const sources = [e, isObj(e.metrics) ? e.metrics : null, isObj(e.current) ? e.current : null].filter(isObj);
  const nums: string[] = [];
  const seen = new Set<string>();
  for (const src of sources)
    for (const [k, v] of Object.entries(src)) {
      const n = num(v);
      if (n === null || seen.has(k)) continue;
      const t = evidenceNumber(k, n);
      if (t) {
        nums.push(t);
        seen.add(k);
      }
    }
  if (nums.length) out.push(cut(nums.join(", "), 400));
  const from = typeof e.from === "string" ? e.from : null;
  const to = typeof e.to === "string" ? e.to : null;
  if (from && to) out.push(`Période : du ${dayText(from)} au ${dayText(to)}.`);
  if (typeof e.comparison === "string" && e.comparison) out.push(cut(e.comparison));
  return out.slice(0, 6);
}

function dayText(s: string): string {
  const k = s.slice(0, 10);
  if (!isDayKey(k)) return s;
  const [y, m, d] = k.split("-");
  return `${d}/${m}/${y}`;
}

export const MARK_WORDS: Record<"DONE" | "REJECTED", { button: string; done: string }> = {
  DONE: { button: "Fait", done: "Noté : vous l'avez fait. L'agent en tiendra compte dans ses prochains chiffres." },
  REJECTED: { button: "Refuser", done: "Recommandation refusée : l'agent ne la reproposera pas telle quelle." },
};

/** Phrase quand aucun connecteur Meta / TikTok n'est branché (avec le lien vers Réglages → Connecteurs). */
export const NO_CONNECTOR_SENTENCE =
  "Aucun connecteur Meta ou TikTok branché : les chiffres sont tirés des coûts importés ou saisis.";
export const CONNECTORS_HREF = "/settings/connectors";

/**
 * Rapport archivé quotidien ou hebdomadaire : `stats.kind` du moteur (« weekly » / « daily »), sinon d'après la clé
 * (`weekStart` « AAAA-MM-JJ » seul = semaine, avec un suffixe « :daily » ou « d: » = jour).
 */
export function reportKind(r: { weekStart: string; stats: unknown }): "daily" | "weekly" {
  const k = isObj(r.stats) ? r.stats.kind : null;
  if (k === "weekly" || k === "daily") return k;
  if (typeof k === "string" && /week|hebdo/i.test(k)) return "weekly";
  if (typeof k === "string" && /day|jour|quoti/i.test(k)) return "daily";
  return /^\d{4}-\d{2}-\d{2}$/.test(r.weekStart) && !/day|jour/i.test(r.weekStart) ? "weekly" : "daily";
}
