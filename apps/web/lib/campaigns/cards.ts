/**
 * Page Campagnes en cartes : règles pures d'affichage (sans base de données), testées dans cards.test.ts.
 * - filtres par univers et par statut (paramètres d'URL `vertical` et `status`) ;
 * - séparation de nos campagnes et des campagnes pub importées pas encore rattachées ;
 * - ordre d'affichage (actives d'abord), compteurs des filtres, adresses des pastilles de filtre ;
 * - formats compacts des montants et sens du bénéfice.
 * Les chiffres eux-mêmes viennent de `listCampaigns` (lib/campaigns/queries.ts) : rien n'est recalculé ici.
 */
import { UNIVERSES, UNIVERSE_LABELS, toUniverse, type Universe } from "@/lib/universe";

export const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED", "DRAFT", "ENDED"] as const;
export type CampaignStatusKey = (typeof CAMPAIGN_STATUSES)[number];

/** Libellés des pastilles de statut (pluriel, une campagne étant féminine). */
export const STATUS_FILTER_LABELS: Record<CampaignStatusKey, string> = {
  ACTIVE: "Actives",
  PAUSED: "En pause",
  DRAFT: "Brouillons",
  ENDED: "Terminées",
};

/** Filtre d'univers : un univers, « sans univers » (`none`) ou tous (chaîne vide). */
export type UniverseFilter = Universe | "none" | "";
export type CampaignFilters = { vertical: UniverseFilter; status: CampaignStatusKey | "" };

export const UNIVERSE_FILTER_OPTIONS: ReadonlyArray<{ value: UniverseFilter; label: string }> = [
  { value: "", label: "Tous" },
  ...UNIVERSES.map((u) => ({ value: u as UniverseFilter, label: UNIVERSE_LABELS[u] })),
  { value: "none", label: "Sans univers" },
];

export const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: CampaignStatusKey | "";
  label: string;
}> = [
  { value: "", label: "Tous" },
  ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] })),
];

/** Statut au singulier dans une phrase (« Aucune campagne Casino terminée »). */
const STATUS_IN_SENTENCE: Record<CampaignStatusKey, string> = {
  ACTIVE: "active",
  PAUSED: "en pause",
  DRAFT: "en brouillon",
  ENDED: "terminée",
};

/**
 * Titre de l'état vide quand les filtres ne laissent aucune campagne : une phrase qui dit ce qui est filtré
 * (« Aucune campagne terminée », « Aucune campagne Casino en pause », « Aucune campagne sans univers »).
 */
export function noMatchTitle(f: CampaignFilters): string {
  const universe =
    f.vertical === "none"
      ? "sans univers"
      : f.vertical
        ? UNIVERSE_LABELS[f.vertical as Universe]
        : null;
  const status = f.status ? STATUS_IN_SENTENCE[f.status] : null;
  return ["Aucune campagne", universe, status].filter(Boolean).join(" ");
}

type Param = string | string[] | undefined;
function one(v: Param): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function isStatus(v: string): v is CampaignStatusKey {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(v);
}

/** Lit les filtres de l'adresse ; une valeur inconnue revient à « tous ». */
export function parseCampaignFilters(sp: { vertical?: Param; status?: Param }): CampaignFilters {
  const v = one(sp.vertical).trim();
  const s = one(sp.status).trim().toUpperCase();
  const vertical: UniverseFilter = v.toLowerCase() === "none" ? "none" : (toUniverse(v) ?? "");
  return { vertical, status: isStatus(s) ? s : "" };
}

/** Vrai si au moins un filtre est posé. */
export function hasCampaignFilters(f: CampaignFilters): boolean {
  return f.vertical !== "" || f.status !== "";
}

type Filterable = { vertical: string | null; status: string };

/** La campagne passe-t-elle les filtres ? */
export function matchesCampaignFilters(row: Filterable, f: CampaignFilters): boolean {
  if (f.status && row.status !== f.status) return false;
  if (f.vertical === "none") return toUniverse(row.vertical) === null;
  if (f.vertical) return toUniverse(row.vertical) === f.vertical;
  return true;
}

/** Campagnes qui passent les filtres (ordre conservé). */
export function filterCampaigns<T extends Filterable>(rows: readonly T[], f: CampaignFilters): T[] {
  return rows.filter((r) => matchesCampaignFilters(r, f));
}

/**
 * Sépare nos campagnes des campagnes pub importées d'un compte connecté et pas encore rattachées
 * (`importedFrom` non nul) : ces dernières vont dans la section repliée « Campagnes pub à rattacher ».
 */
export function splitImportedShells<T extends { importedFrom: string | null }>(
  rows: readonly T[],
): { campaigns: T[]; shells: T[] } {
  const campaigns: T[] = [];
  const shells: T[] = [];
  for (const r of rows) (r.importedFrom ? shells : campaigns).push(r);
  return { campaigns, shells };
}

/** Rang d'affichage d'un statut : actives, en pause, brouillons, terminées, puis l'inconnu. */
export function statusRank(status: string): number {
  const i = (CAMPAIGN_STATUSES as readonly string[]).indexOf(status);
  return i === -1 ? CAMPAIGN_STATUSES.length : i;
}

/** Tri stable par statut (l'ordre d'origine, du plus récent au plus ancien, est gardé dans chaque statut). */
export function sortByStatus<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => statusRank(a.row.status) - statusRank(b.row.status) || a.index - b.index)
    .map((x) => x.row);
}

/**
 * Nombre de campagnes derrière chaque pastille de filtre. Le compte d'univers tient compte du statut choisi et
 * inversement, pour que chaque pastille annonce ce qu'on verra en cliquant dessus.
 */
export function filterCounts(
  rows: readonly Filterable[],
  f: CampaignFilters,
): { vertical: Record<string, number>; status: Record<string, number> } {
  const vertical: Record<string, number> = {};
  const status: Record<string, number> = {};
  for (const o of UNIVERSE_FILTER_OPTIONS)
    vertical[o.value] = filterCampaigns(rows, { ...f, vertical: o.value }).length;
  for (const o of STATUS_FILTER_OPTIONS)
    status[o.value] = filterCampaigns(rows, { ...f, status: o.value }).length;
  return { vertical, status };
}

/**
 * Adresse de la page Campagnes avec les paramètres conservés (période, comparaison, filtres) et un changement :
 * une valeur vide retire le paramètre. Les messages de retour (`ok`, `error`) ne sont jamais recopiés.
 */
export function campaignsHref(
  current: Record<string, string | undefined>,
  patch: Record<string, string>,
  path = "/campaigns",
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...patch })) {
    if (k === "ok" || k === "error" || !v) continue;
    p.set(k, v);
  }
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Vrai si l'adresse porte au moins un réglage de liste (période, comparaison, filtre…) : le bouton « Réinitialiser »
 * n'est montré que dans ce cas. Les messages de retour (`ok`, `error`) et la page ne comptent pas, comme dans
 * `RememberFilters` ; sans aucun réglage dans l'adresse, rien n'est mémorisé non plus (sinon `RememberFilters`
 * redirige vers l'adresse mémorisée).
 */
export function hasFilterParams(sp: Record<string, Param>): boolean {
  return Object.entries(sp).some(([k, v]) => !["ok", "error", "page"].includes(k) && one(v) !== "");
}

/** Une seule valeur par paramètre (la première), pour recopier une adresse. */
export function flatParams(sp: Record<string, Param>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s) out[k] = s;
  }
  return out;
}

// `signDisplay: "negative"` : un montant arrondi à zéro ne garde pas de signe (« 0 € », jamais « −0 € »).
const money0 = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  signDisplay: "negative",
});
const money2 = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "negative",
});

/**
 * Vrai signe moins (U+2212) à la place du trait d'union d'un nombre négatif formaté : en chiffres tabulaires, le
 * trait d'union d'Inter prend la largeur d'un chiffre et se détache (« - 151,64 € »).
 */
export function withMinusSign(s: string): string {
  return s.replace(/^-|(?<=^[^\d]*)-(?=\d)/, "\u2212");
}

/** À partir de ce montant (en valeur absolue), les montants d'un même groupe s'affichent sans centimes. */
export const ROUND_MONEY_FROM = 100;

/**
 * Nombre de décimales d'un groupe de montants affichés ensemble (la grille des cartes et sa ligne de total, l'en-tête
 * d'une fiche) : 0 dès qu'un des montants atteint 100 € en valeur absolue, 2 sinon. Une seule précision par groupe :
 * « 1 813 € » ne côtoie plus « 558,14 € ». Même seuil sur la liste et sur la fiche ; valeurs absentes ignorées.
 */
export function groupMoneyDigits(values: ReadonlyArray<number | null | undefined>): 0 | 2 {
  return values.some(
    (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) >= ROUND_MONEY_FROM,
  )
    ? 0
    : 2;
}

/** Montant avec le nombre de décimales de son groupe (`groupMoneyDigits`) ; « — » si absent ; vrai signe moins. */
export function groupMoney(n: number | null | undefined, digits: 0 | 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return withMinusSign((digits === 0 ? money0 : money2).format(n));
}

/** Montant exact au centime (survol, volets de détail). */
export function exactMoney(n: number | null | undefined): string {
  return groupMoney(n, 2);
}

/**
 * Montant compact affiché seul (hors d'un groupe) : sans centimes à partir de 100 € (« 260 € »), avec centimes en
 * dessous (« 42,50 € ») ; « — » si absent ; vrai signe moins. Le détail exact reste sur la fiche et dans l'export.
 */
export function compactMoney(n: number | null | undefined): string {
  return groupMoney(n, groupMoneyDigits([n]));
}

/** Nom court de la plateforme des pubs sur une carte (le nom complet reste sur la fiche). */
export const PLATFORM_SHORT_LABELS: Record<string, string> = {
  TIKTOK: "TikTok",
  META: "Meta",
  OTHER: "Autre plateforme",
};

export function platformShortLabel(platform: string | null | undefined): string | null {
  return platform ? (PLATFORM_SHORT_LABELS[platform] ?? platform) : null;
}

/** Sens d'un bénéfice : positif (vert), négatif (rouge) ou nul. */
export function profitTone(n: number | null | undefined): "positive" | "negative" | "neutral" {
  if (n === null || n === undefined || !Number.isFinite(n)) return "neutral";
  // Moins d'un centime : nul (évite un « −0,00 € » rouge).
  if (Math.abs(n) < 0.005) return "neutral";
  return n > 0 ? "positive" : "negative";
}

/** « 1 canal », « 3 canaux » ; « 1 lien », « 2 liens »… (nom au pluriel régulier par défaut). */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`;
}

/** Ligne de contexte d'une carte : « TikTok · 2 canaux · 3 liens d'entrée · 1 offre ». */
export function campaignSummary(c: {
  platformLabel: string | null;
  channels: number;
  links: number;
  offers: number;
}): string {
  return [
    c.platformLabel ?? "Sans pub",
    plural(c.channels, "canal", "canaux"),
    plural(c.links, "lien d'entrée", "liens d'entrée"),
    plural(c.offers, "offre"),
  ].join(" · ");
}

/** Somme des dépenses de campagnes (campagnes pub à rattacher : rien n'est partagé, la somme est juste). */
export function sumSpend(rows: ReadonlyArray<{ metrics: { spend: number } }>): number {
  return rows.reduce((s, r) => s + (Number.isFinite(r.metrics.spend) ? r.metrics.spend : 0), 0);
}
