/**
 * Statistiques : mots affichés, sens favorable et format de chaque chiffre (fonctions pures, testées dans
 * display.test.ts). Vocabulaire du client (docs/REFONTE-UX.md) : le mot courant est affiché, le terme technique
 * (FTD, NGR, CPL, CPA, ROAS, LTV) passe au survol (`term`). Les chiffres eux-mêmes viennent de
 * `lib/dashboard/queries.ts` et `daily.ts` : rien n'est recalculé ici.
 */
import type { Favorable } from "@/components/admin/stat-card-logic";
import { fmtTimes, formatValue, type ChartFormat } from "@/components/charts/chart-logic";
import { exactMoney, groupMoney, groupMoneyDigits } from "@/lib/campaigns/cards";
import { fmtNum } from "@/lib/format";
import type { CohortRow, Derived, FunnelStep, HourRow, StatTotals } from "./metrics";

export type MetricKey = keyof StatTotals | keyof Derived;

export type MetricView = {
  /** Mot du client. */
  label: string;
  /** Terme technique au survol. */
  term?: string;
  favorable: Favorable;
  format: ChartFormat;
  /** Compte entier (axe sans décimale). */
  integer?: boolean;
};

/** Tous les chiffres des statistiques journalières et leurs indicateurs dérivés. */
export const METRIC_VIEWS: Record<MetricKey, MetricView> = {
  spend: { label: "Dépense pub", favorable: "down", format: "money" },
  entryClicks: { label: "Clics sur les pubs", favorable: "up", format: "number", integer: true },
  requests: { label: "Demandes d'adhésion", favorable: "up", format: "number", integer: true },
  approved: { label: "Acceptés", favorable: "up", format: "number", integer: true },
  joined: { label: "Membres entrés", favorable: "up", format: "number", integer: true },
  left: { label: "Départs", favorable: "down", format: "number", integer: true },
  offerClicks: { label: "Clics sur les offres", favorable: "up", format: "number", integer: true },
  registrations: { label: "Inscriptions", favorable: "up", format: "number", integer: true },
  ftds: {
    label: "Premiers dépôts",
    term: "FTD",
    favorable: "up",
    format: "number",
    integer: true,
  },
  deposits: { label: "Dépôts", favorable: "up", format: "number", integer: true },
  depositAmount: { label: "Montant déposé", favorable: "up", format: "money" },
  ngr: { label: "Revenu net", term: "NGR", favorable: "up", format: "money" },
  cpl: { label: "Coût par membre", term: "CPL", favorable: "down", format: "money" },
  cpa: { label: "Coût par inscription", term: "CPA", favorable: "down", format: "money" },
  costPerFtd: {
    label: "Coût par premier dépôt",
    term: "coût par FTD",
    favorable: "down",
    format: "money",
  },
  roas: { label: "Retour sur dépense pub", term: "ROAS", favorable: "up", format: "ratio" },
  profit: { label: "Bénéfice", favorable: "up", format: "money" },
};

/** Ordre du détail d'une campagne (volet) : le parcours, puis l'argent, puis les rapports. */
export const DETAIL_ORDER: MetricKey[] = [
  "spend",
  "entryClicks",
  "requests",
  "approved",
  "joined",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
  "depositAmount",
  "ngr",
  "cpl",
  "cpa",
  "costPerFtd",
  "roas",
  "profit",
];

/** Valeur d'un chiffre (totaux ou indicateur dérivé). */
export function metricValue(t: StatTotals, d: Derived, key: MetricKey): number | null {
  return key in t ? t[key as keyof StatTotals] : d[key as keyof Derived];
}

/** Valeur affichée d'un chiffre : « 1 234 », « 1 234 € » (sans centimes à partir de 100 €), « 1,80× », « — ». */
export function fmtMetric(key: MetricKey, v: number | null | undefined): string {
  return formatValue(v, METRIC_VIEWS[key].format);
}

/** Valeur exacte (volet de détail) : montants au centime. */
export function fmtMetricExact(key: MetricKey, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return METRIC_VIEWS[key].format === "money" ? exactMoney(v) : fmtMetric(key, v);
}

export { fmtTimes };

/**
 * Variation à afficher (cartes, volets, cellules). Un pourcentage calculé sur une base négative (bénéfice ou revenu
 * net d'avant en perte) a un sens trompeur : passer de −1,74 € à 323 € donne « −18 661 % », en rouge. Dans ce cas,
 * pas de pourcentage (« Pas de comparaison possible ») : la valeur d'avant reste écrite à côté. Le calcul
 * (`deltaPct`) ne change pas ; seule la présentation l'écarte.
 */
export function comparableDelta(
  delta: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (delta === null || delta === undefined) return null;
  if (typeof previous === "number" && previous < 0) return null;
  return delta;
}

/** Accord simple : « 1 canal », « 7 canaux » (singulier jusqu'à 1, comme en français). */
function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n > 1 ? many : one}`;
}

/**
 * Chiffres d'une même grille de cartes : les montants à une seule précision (règle « une précision d'arrondi par
 * groupe » de docs/DESIGN-SYSTEM.md : à l'euro dès que l'un d'eux atteint 100 €, au centime sinon), les autres
 * chiffres comme `fmtMetric`. `values` : tous les montants affichés ensemble (période et, si on compare, période
 * précédente). Le montant exact reste au survol (`fmtMetricExact`).
 */
export function metricGroupFormatter(
  values: ReadonlyArray<{ key: MetricKey; value: number | null | undefined }>,
): (key: MetricKey, v: number | null | undefined) => string {
  const digits = groupMoneyDigits(
    values.filter((e) => METRIC_VIEWS[e.key].format === "money").map((e) => e.value),
  );
  return (key, v) =>
    METRIC_VIEWS[key].format === "money" ? groupMoney(v, digits) : fmtMetric(key, v);
}

/**
 * Mini-courbe d'une carte : rien quand la période n'a aucune valeur (une ligne plate à zéro n'apprend rien et
 * ajoute du bruit), la série sinon.
 */
export function trendOrNone(values: readonly number[] | null | undefined): number[] | undefined {
  if (!values || values.length === 0 || values.every((v) => v === 0)) return undefined;
  return [...values];
}

// ——— Vue d'ensemble ———

/** Libellés des chiffres de la vue d'ensemble (clés de `loadDashboard`). */
export function overviewLabel(key: string): MetricView {
  return (
    METRIC_VIEWS[key as MetricKey] ?? {
      label: key,
      favorable: "up",
      format: "number",
      integer: true,
    }
  );
}

/** Ligne « En ce moment » sous le titre de la vue d'ensemble : bots, canaux et membres, accordés. */
export function activeSummary(n: { bots: number; channels: number; members: number }): string {
  return (
    `En ce moment : ${plural(n.bots, "bot actif", "bots actifs")}, ` +
    `${plural(n.channels, "canal actif", "canaux actifs")}, ` +
    `${plural(n.members, "membre vu", "membres vus")} par vos bots.`
  );
}

// ——— Pubs : tableau par campagne (5 colonnes) ———

/** Colonnes du tableau par campagne : le reste des chiffres est dans le volet de détail de la ligne. */
export const ADS_COLUMNS = [
  { key: "name", header: "Campagne", className: "max-md:whitespace-normal" },
  { key: "spend", header: "Dépense pub", align: "right" },
  { key: "joined", header: "Membres entrés", align: "right", hideOnMobile: true },
  { key: "ftds", header: "Premiers dépôts", term: "FTD", align: "right" },
  {
    key: "roas",
    header: "Retour sur dépense pub",
    term: "ROAS",
    align: "right",
    hideOnMobile: true,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  header: string;
  term?: string;
  align?: "left" | "right";
  hideOnMobile?: boolean;
  className?: string;
}>;

/**
 * Tri demandé par une ancienne adresse (`sort`, `dir` de l'onglet Campagnes) : appliqué s'il vise une colonne du
 * tableau, sinon ordre par défaut (dépense, de la plus forte à la plus faible).
 */
export function adsDefaultSort(
  sort: string,
  dir: string,
): { key: string; direction: "asc" | "desc" } {
  const keys: readonly string[] = ADS_COLUMNS.map((c) => c.key);
  const legacy: Record<string, string> = { entered: "joined" };
  const k = legacy[sort] ?? sort;
  if (keys.includes(k)) return { key: k, direction: dir === "asc" ? "asc" : "desc" };
  return { key: "spend", direction: "desc" };
}

/** Phrase sous le nombre de membres : « 2,10 € par membre » (« — » sans membre ou sans dépense). */
export function costPerMemberNote(d: Pick<Derived, "cpl">): string | null {
  return d.cpl === null ? null : `${fmtMetric("cpl", d.cpl)} par membre`;
}

/** Phrase sous le retour sur dépense pub, à l'euro près : « 420 € de bénéfice » / « 97 € de perte ». */
export function profitNote(profit: number): string | null {
  if (!Number.isFinite(profit) || Math.round(profit) === 0) return null;
  const amount = groupMoney(Math.abs(profit), 0);
  return profit > 0 ? `${amount} de bénéfice` : `${amount} de perte`;
}

/**
 * Montants d'une même colonne à une seule précision : sans centimes dès que l'un d'eux atteint 100 €
 * (« 530 € » … « 0 € », jamais « 0,00 € » sous « 530 € »), avec centimes sinon.
 */
export function moneyColumn(
  values: ReadonlyArray<number | null | undefined>,
): (v: number | null | undefined) => string {
  const digits = groupMoneyDigits(values);
  return (v) => groupMoney(v, digits);
}

// ——— Parcours ———

/**
 * Nom de chaque étape du parcours, en mots du client : le même mot que partout ailleurs dans les statistiques
 * (`METRIC_VIEWS` : cartes, volets, graphiques), un seul libellé par chiffre.
 */
const FUNNEL_KEYS = [
  "entryClicks",
  "requests",
  "approved",
  "joined",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
] as const satisfies ReadonlyArray<keyof StatTotals>;

export const FUNNEL_LABELS: Record<string, { label: string; term?: string }> = Object.fromEntries(
  FUNNEL_KEYS.map((k) => {
    const v = METRIC_VIEWS[k];
    return [k, v.term ? { label: v.label, term: v.term } : { label: v.label }];
  }),
);

export function funnelLabel(step: Pick<FunnelStep, "key" | "label">): {
  label: string;
  term?: string;
} {
  return FUNNEL_LABELS[step.key] ?? { label: step.label };
}

/**
 * La plus grosse perte du parcours (entre deux étapes non vides), pour la phrase en tête de page. Les dépôts
 * suivent les premiers dépôts (un joueur peut déposer plusieurs fois) : cette dernière marche ne compte pas.
 */
export function biggestDrop(
  steps: readonly FunnelStep[],
): { from: FunnelStep; to: FunnelStep; loss: number } | null {
  let best: { from: FunnelStep; to: FunnelStep; loss: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    if (to.key === "deposits") continue;
    if (from.value <= 0 || to.loss === null || to.loss <= 0) continue;
    if (!best || to.loss > best.loss) best = { from, to, loss: to.loss };
  }
  return best;
}

/**
 * Précision sous une étape du parcours : « 80,7 % de l'étape d'avant » ; au-delà de 100 % (un membre clique
 * plusieurs offres, un joueur dépose plusieurs fois) : « ×3,9 par rapport à l'étape d'avant ».
 */
export function stepNote(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  if (rate <= 100) return `${fmtPercent(rate)} de l'étape d'avant`;
  const times = (rate / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `×${times} par rapport à l'étape d'avant`;
}

/** Pourcentage à la française (« 18,5 % ») depuis un pourcentage déjà calculé. */
export function fmtPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

// ——— Membres dans le temps ———

/** Part d'un nombre dans la semaine : « 18 % » (arrondi), « — » sans membre. */
export function shareOf(part: number, total: number): string {
  if (!(total > 0)) return "—";
  return `${Math.round((part / total) * 100)} %`;
}

/** Semaines dans l'ordre du temps (le tableau les reçoit de la plus récente à la plus ancienne). */
export function cohortsChronological(rows: readonly CohortRow[]): CohortRow[] {
  return [...rows].sort((a, b) => a.week.localeCompare(b.week));
}

// ——— Canaux ———

/** Croissance nette affichée avec son signe : « +12 », « −3 », « 0 ». */
export function fmtSigned(n: number): string {
  if (n === 0) return "0";
  const abs = formatValue(Math.abs(n), "number");
  return n > 0 ? `+${abs}` : `−${abs}`;
}

/** Somme jour par jour de plusieurs séries de même longueur (croissance nette de tous les canaux affichés). */
export function sumSeries(series: ReadonlyArray<readonly number[]>, length: number): number[] {
  const out = Array.from({ length }, () => 0);
  for (const s of series) for (let i = 0; i < length; i++) out[i]! += s[i] ?? 0;
  return out;
}

/** Clics par message à la française (« 2,4 »). */
export function fmtPerPost(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** « 2,4 clics par message », « 1,5 clic par message » (pluriel à partir de 2). */
export function perPostText(n: number): string {
  return `${fmtPerPost(n)} clic${n >= 2 ? "s" : ""} par message`;
}

/** Précision sous une barre : « 5 messages · 12 clics ». */
export function postsClicksNote(posts: number, clicks: number): string {
  return `${plural(posts, "message", "messages")} · ${plural(clicks, "clic", "clics")}`;
}

/** Heure de Paris en toutes lettres : « 21 h », « 9 h ». */
export function hourLabel(hour: number): string {
  return `${hour} h`;
}

/**
 * Barres des meilleurs horaires d'envoi (page Canaux) : les `limit` premières heures, dans l'ordre reçu (les
 * meilleures d'abord, voir `bestHours`), avec leurs messages et leurs clics.
 */
export function hourBars(
  hours: readonly HourRow[],
  limit = 8,
): Array<{ key: string; label: string; value: number; valueText: string; note: string }> {
  return hours.slice(0, limit).map((h) => ({
    key: String(h.hour),
    label: hourLabel(h.hour),
    value: h.clicksPerPost,
    valueText: perPostText(h.clicksPerPost),
    note: postsClicksNote(h.posts, h.clicks),
  }));
}

// ——— Jours ———

const dayShortFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Libellé court d'un jour `AAAA-MM-JJ` (« 4 oct. »), pour les axes, les bulles et les tableaux. */
export function dayLabel(key: string): string {
  return dayShortFmt.format(new Date(`${key}T12:00:00Z`));
}

export function dayLabels(keys: readonly string[]): string[] {
  return keys.map(dayLabel);
}
