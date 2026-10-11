/**
 * Fiche campagne : règles pures d'affichage (onglets, chiffres, libellés), testées dans display.test.ts.
 * Vocabulaire du client (docs/REFONTE-UX.md) : le mot affiché est en français courant, le terme technique
 * (FTD, NGR, CPL, CPA, ROAS, sub-ID) passe au survol (`term`).
 * Les chiffres viennent de `campaignTotals` / `computeMetrics` : rien n'est recalculé ici.
 */
import type { Favorable } from "@/components/admin/stat-card-logic";
import { fmtNum } from "@/lib/format";
import { excerpt } from "@/lib/home/lists";
import { exactMoney, groupMoney, groupMoneyDigits, plural } from "./cards";
import { fmtRatio, type CampaignMetrics } from "./metrics";

// ——— Onglets ———

/**
 * Onglets de la fiche ; `help` résume l'onglet en une phrase (aide de la page, guide d'utilisation) ; `short` : libellé
 * sur téléphone, où les six onglets tiennent en deux rangées de trois boutons (12 caractères au plus).
 */
export const CAMPAIGN_TABS = [
  {
    key: "overview",
    label: "Vue d'ensemble",
    short: "Résumé",
    help: "Ce que la campagne a coûté et rapporté, et les offres Link Affi qu'elle promeut.",
  },
  {
    key: "ads",
    label: "Pubs",
    short: "Pubs",
    help: "La campagne pub TikTok ou Meta (groupes et pubs) et ses dépenses jour par jour.",
  },
  {
    key: "links",
    label: "Liens",
    short: "Liens",
    help: "Un lien d'entrée par pub : collez son adresse dans la pub, chaque clic ouvre l'invitation Telegram.",
  },
  {
    key: "channels",
    label: "Canaux",
    short: "Canaux",
    help: "Les canaux Telegram où arrivent les membres de cette campagne.",
  },
  {
    key: "messages",
    label: "Messages",
    short: "Messages",
    help: "Les messages des canaux de la campagne, et ceux qui portent un bouton Offre vers ses offres.",
  },
  {
    key: "members",
    label: "Membres",
    short: "Membres",
    help: "Les personnes arrivées par les liens d'entrée de la campagne.",
  },
] as const;

export type CampaignTabKey = (typeof CAMPAIGN_TABS)[number]["key"];

/**
 * Onglet demandé par l'adresse (`?tab=`). L'ancien onglet « Offres » (`offers`) est désormais une section de la
 * vue d'ensemble : il y mène, comme toute valeur inconnue.
 */
export function parseCampaignTab(v: unknown): CampaignTabKey {
  const s = Array.isArray(v) ? v[0] : v;
  return CAMPAIGN_TABS.find((t) => t.key === s)?.key ?? "overview";
}

/** Vrai quand l'adresse vise l'ancien onglet Offres (la section « Offres Link Affi » est alors mise en avant). */
export function isLegacyOffersTab(v: unknown): boolean {
  return (Array.isArray(v) ? v[0] : v) === "offers";
}

/** Adresse d'un onglet en gardant la période et la comparaison (jamais les messages de retour ni la page). */
export function campaignTabHref(
  id: string,
  tab: CampaignTabKey,
  keep: Record<string, string | undefined> = {},
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(keep))
    if (v && !["ok", "error", "page", "tab", "others"].includes(k)) p.set(k, v);
  if (tab !== "overview") p.set("tab", tab);
  const q = p.toString();
  return q ? `/campaigns/${id}?${q}` : `/campaigns/${id}`;
}

// ——— Chiffres ———

export type MetricView = {
  key: keyof CampaignMetrics;
  /** Mot du client. */
  label: string;
  /** Terme technique au survol. */
  term?: string;
  /** Une phrase : ce que mesure le chiffre. */
  hint?: string;
  /** Phrase affichée à la place de `hint` quand elle dépend des chiffres (« 9 dépôts, premiers et suivants. »). */
  hintOf?: (m: CampaignMetrics) => string;
  favorable: Favorable;
  format: (m: CampaignMetrics) => string;
  /** Valeur exacte (au survol) quand `format` arrondit. */
  exact?: (m: CampaignMetrics) => string;
};

/** Montant en euros au centime, avec un vrai signe moins (chiffres tabulaires). */
const money = exactMoney;

/**
 * Montant d'une carte de l'en-tête. Les montants de l'en-tête (dépensé, bénéfice) forment un groupe à une seule
 * précision, même règle que la grille des cartes (`groupMoneyDigits`) : sans centimes dès que l'un d'eux atteint
 * 100 € (« 260 € », « 42 € »), avec centimes sinon ; « — » si absent. Le montant exact reste au survol (`exact`).
 * `digits` absent : précision du montant seul.
 */
export function headerMoney(n: number | null | undefined, digits?: 0 | 2): string {
  return groupMoney(n, digits ?? groupMoneyDigits([n]));
}

/** Précision commune des montants de l'en-tête de la fiche. */
export function headerDigits(m: Pick<CampaignMetrics, "spend" | "profit">): 0 | 2 {
  return groupMoneyDigits([m.spend, m.profit]);
}

/** Les 4 chiffres de l'en-tête de la fiche (cartes, avec variation vs période précédente). */
export const HEADER_METRICS: MetricView[] = [
  {
    key: "spend",
    label: "Dépensé",
    hint: "Dépense pub de la période.",
    favorable: "down",
    format: (m) => headerMoney(m.spend, headerDigits(m)),
    exact: (m) => money(m.spend),
  },
  {
    key: "members",
    label: "Membres",
    hint: "Demandes d'adhésion acceptées via les liens d'entrée.",
    favorable: "up",
    format: (m) => fmtNum(m.members),
  },
  {
    key: "ftds",
    label: "Premiers dépôts",
    term: "FTD",
    hint: "Joueurs de la campagne qui ont déposé pour la première fois.",
    favorable: "up",
    format: (m) => fmtNum(m.ftds),
  },
  {
    key: "profit",
    label: "Bénéfice",
    hint: "Revenu net moins dépense pub.",
    favorable: "up",
    format: (m) => headerMoney(m.profit, headerDigits(m)),
    exact: (m) => money(m.profit),
  },
];

/** Les autres chiffres de la période (vue d'ensemble, « Tous les chiffres »). */
export const DETAIL_METRICS: MetricView[] = [
  {
    key: "entryClicks",
    label: "Clics sur les pubs",
    hint: "Clics sur les liens d'entrée, robots exclus.",
    favorable: "up",
    format: (m) => fmtNum(m.entryClicks ?? 0),
  },
  {
    key: "offerClicks",
    label: "Clics sur les offres",
    hint: "Clics sur les boutons Offre du bot, chacun avec son identifiant de suivi.",
    favorable: "up",
    format: (m) => fmtNum(m.offerClicks ?? 0),
  },
  {
    key: "registrations",
    label: "Inscriptions",
    hint: "Joueurs inscrits chez le partenaire.",
    favorable: "up",
    format: (m) => fmtNum(m.registrations),
  },
  {
    key: "deposits",
    label: "Dépôts",
    hint: "Montant des dépôts, premiers et suivants.",
    hintOf: (m) => `${plural(m.deposits ?? 0, "dépôt")}, premiers et suivants.`,
    favorable: "up",
    // Le montant seul en gros chiffre : « 9 · 675,00 € » se lisait « 9 675 € ». Le nombre passe dans la phrase.
    format: (m) => money(m.depositAmount ?? 0),
  },
  {
    key: "revenue",
    label: "Revenu net",
    term: "NGR",
    hint: "Somme des revenus nets datés de la période chez Link Affi.",
    favorable: "up",
    format: (m) => money(m.revenue),
  },
  {
    key: "roas",
    label: "Retour sur dépense pub",
    term: "ROAS",
    hint: "Revenu net divisé par la dépense : 1,00× = remboursé.",
    favorable: "up",
    format: (m) => fmtRatio(m.roas),
  },
  {
    key: "cpl",
    label: "Coût par membre",
    term: "CPL",
    hint: "Dépense divisée par les membres.",
    favorable: "down",
    format: (m) => money(m.cpl),
  },
  {
    key: "cpa",
    label: "Coût par inscription",
    term: "CPA",
    hint: "Dépense divisée par les inscriptions.",
    favorable: "down",
    format: (m) => money(m.cpa),
  },
  {
    key: "costPerFtd",
    label: "Coût par premier dépôt",
    term: "Coût par FTD",
    hint: "Dépense divisée par les premiers dépôts.",
    favorable: "down",
    format: (m) => money(m.costPerFtd),
  },
];

/** Termes techniques qui ne doivent jamais apparaître dans un libellé affiché (ils vont au survol). */
export const JARGON = /\b(FTD|NGR|CPL|CPA|ROAS|sub-?ID|webhook|postback|cohorte|entonnoir)\b/i;

// ——— Libellés de lignes ———

/**
 * Extrait d'un message pour une ligne de tableau : même règle que l'accueil (`excerpt`, lib/home/lists.ts) : balises
 * retirées, retours à la ligne remplacés par « · » (« Combiné du week-end · Quatre matchs… »), coupé au mot près.
 * « Message <code> » s'il n'a pas de texte.
 */
export function postExcerpt(text: string | null | undefined, code: string, max = 160): string {
  return excerpt((text ?? "").replace(/&nbsp;/g, " "), max) || `Message ${code}`;
}

/** Niveau d'une dépense : une pub, un groupe ou toute la campagne pub. */
export function costLevelLabel(c: {
  ad?: { name: string } | null;
  adSet?: { name: string } | null;
}): string {
  if (c.ad) return `Pub « ${c.ad.name} »`;
  if (c.adSet) return `Groupe « ${c.adSet.name} »`;
  return "Toute la campagne pub";
}

/** Titre d'un lien d'entrée : « Groupe 1 › Pub 2 » quand il est rattaché à une pub, sinon son nom de pub ou son nom. */
export function entryLinkTitle(l: {
  name: string;
  adName?: string | null;
  ad?: { name: string; adSet: { name: string } } | null;
}): string {
  if (l.ad) return `${l.ad.adSet.name} › ${l.ad.name}`;
  return l.adName?.trim() || l.name;
}

/** Adresse courte d'un lien traqué pour une cellule de tableau (« go.goolink.eu/ab12cd »). */
export function shortLinkAddress(base: string, slug: string): string {
  return `${base.replace(/^https?:\/\//, "").replace(/\/$/, "")}/${slug}`;
}

/** Description d'une campagne pub suivie (ligne d'information de l'onglet Pubs). */
const AD_PLATFORM_LINE: Record<string, string> = {
  TIKTOK: "Pubs TikTok",
  META: "Pubs Meta (Facebook / Instagram)",
  OTHER: "Pubs sur une autre plateforme",
};

/**
 * Titre d'un groupe de pubs : son nom tel quel s'il commence déjà par le mot « Groupe » (« Groupe 1 », nom donné par
 * défaut), sinon « Groupe « FR 18-34 » ». Évite « Groupe « Groupe 1 » ».
 */
export function adSetTitle(name: string): string {
  return /^groupe(\s|$)/i.test(name.trim()) ? name : `Groupe « ${name} »`;
}

export function adCampaignLine(c: {
  /** Plateforme des pubs (TIKTOK, META, OTHER) ou null. */
  platform: string | null;
  externalCampaignId: string | null;
  platformName: string | null;
  imported: boolean;
  connectionName: string | null;
}): string {
  const parts = [
    c.platform
      ? (AD_PLATFORM_LINE[c.platform] ?? `Pubs ${c.platform}`)
      : "Plateforme des pubs non précisée",
  ];
  if (c.externalCampaignId)
    parts.push(
      c.imported
        ? "campagne pub importée d'un compte connecté"
        : `suit la campagne pub « ${c.platformName ?? c.externalCampaignId} »`,
    );
  if (c.connectionName) parts.push(`compte « ${c.connectionName} »`);
  return parts.join(" · ");
}

// ——— Dépenses par jour ———

export type CostLine = {
  id: string;
  date: Date;
  spend: number;
  impressions: number;
  clicks: number;
  source: string;
  ad?: { name: string } | null;
  adSet?: { name: string } | null;
};

export type CostDay<T extends CostLine = CostLine> = {
  /** Jour AAAA-MM-JJ (date `@db.Date`, minuit UTC). */
  day: string;
  date: Date;
  spend: number;
  impressions: number;
  clicks: number;
  /** Sources présentes ce jour-là (API, CSV, MANUAL), sans doublon, dans l'ordre d'apparition. */
  sources: string[];
  lines: T[];
};

/**
 * Regroupe les lignes de dépense par jour (du plus récent au plus ancien) : un jour = une ligne du tableau, le
 * détail par pub ou par groupe dans le volet. Les montants s'additionnent (arrondis au centime) ; rien n'est
 * recalculé : ce sont les mêmes lignes `AdCost` que la liste d'avant.
 */
export function groupCostsByDay<T extends CostLine>(lines: readonly T[]): CostDay<T>[] {
  const byDay = new Map<string, CostDay<T>>();
  for (const l of lines) {
    const day = l.date.toISOString().slice(0, 10);
    const d =
      byDay.get(day) ??
      ({
        day,
        date: l.date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        sources: [],
        lines: [],
      } as CostDay<T>);
    d.spend = Math.round((d.spend + (Number.isFinite(l.spend) ? l.spend : 0)) * 100) / 100;
    d.impressions += l.impressions || 0;
    d.clicks += l.clicks || 0;
    if (!d.sources.includes(l.source)) d.sources.push(l.source);
    d.lines.push(l);
    byDay.set(day, d);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

// ——— Variations affichées ———

/**
 * Variation en % pour l'affichage, rapportée à la valeur absolue de la période précédente : identique à
 * `variationOf` (lib/periods.ts) pour un chiffre positif, mais un bénéfice qui passe de −21 € à −275 € donne
 * −1 209 % (une baisse, en rouge) et non +1 209 %. 0 → 0 : 0 ; 0 → autre chose, ou valeur absente : null.
 */
export function displayVariation(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined)
    return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Variations de chaque chiffre d'une campagne entre deux périodes (règle `displayVariation`). */
export function displayDeltas(
  current: CampaignMetrics,
  previous: CampaignMetrics,
): Partial<Record<keyof CampaignMetrics, number | null>> {
  const out: Partial<Record<keyof CampaignMetrics, number | null>> = {};
  for (const k of Object.keys(current) as (keyof CampaignMetrics)[])
    out[k] = displayVariation(current[k] ?? null, previous[k] ?? null);
  return out;
}
