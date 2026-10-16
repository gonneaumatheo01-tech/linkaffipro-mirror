import {
  DEFAULT_LANDING_SOURCE,
  LANDING_ESCAPE_MAX_AGE_MS,
  landingRatio,
  type LandingCounts,
  type LandingInApp,
  type LandingOs,
  type LandingRates,
} from "@linkaffipro/core";
import { landingVisitsByLink, prisma } from "@linkaffipro/db";
import { periodDates, periodEnd, periodStart, type Period } from "@/lib/periods";

/**
 * Chiffres des pages d'atterrissage (phase 15, rubrique « Pages », décision D10), par page et par source, sur une
 * période (jours de Paris) :
 * - visites : affichages par un vrai navigateur (VIEW, robots connus jamais comptés), une par visite (`visitId`) ;
 * - clics : clics sur le bouton (CLICK humains), un par visite au plus ;
 * - % de clic = clics ÷ visites ;
 * - demandes (« join ») : demandes d'adhésion faites dans la période par les liens d'invitation LANDING de la page et
 *   de la source (le lien garde sa source même révoqué) ; acceptés : ces demandes, acceptées depuis (acceptées par un
 *   bot ou à la main, ou entrées dans le canal : même règle que les statistiques par provenance) ;
 * - % visite → join = demandes ÷ visites ;
 * - coût par join = part de la dépense de la pub ÷ demandes, « — » sans pub (voir `allocateAdSpend`) : la pub est celle
 *   figée sur chaque lien (D9, `InviteLink.landingAdId`), la même que celle qui compte ses demandes dans les
 *   statistiques. Sa dépense (`AdCost` niveau `ad:<id>`, en euros) est partagée entre TOUS ses chemins d'arrivée (son
 *   lien direct de pub et les liens de toutes les pages reliées à elle), jour par jour, au prorata de leurs arrivées
 *   (clics sur le lien direct, visites de la page) : jamais comptée deux fois, et le coût par join de chaque chemin dit
 *   lequel transforme le mieux. Dépense saisie pour toute la campagne ou le groupe seulement, ou aucune dépense sur la
 *   période : « — » avec la raison (`spendNote`), jamais « 0 € » faute de donnée ;
 * - Telegram ouvert : premiers appuis suivis d'une ouverture ÷ premiers appuis, par système, puis par navigateur
 *   (appli TikTok, Instagram, Facebook, autre appli, navigateur habituel) et façon d'ouvrir. Seul le PREMIER appui de
 *   chaque visite dans la période compte (`loadLandingTables`, requête `opens`) : en phase 15, c'était le seul dont la
 *   façon d'ouvrir était tirée au sort (un nouvel appui essayait l'autre façon) ; depuis la phase 16, la façon dépend
 *   seulement du navigateur (lien natif dans Safari ou Chrome, aide et cadre caché `TG_FRAME` / `INTENT_FRAME` dans
 *   une appli), et le premier appui reste le seul compté (un clic par visite, comme la colonne « Clics »). Une
 *   ouverture compte pour ce premier appui si elle a la même façon d'ouvrir et arrive avant l'appui suivant (jusqu'à
 *   2 s avant lui : deux envois de la page peuvent arriver dans le désordre, et même après la fin de la période).
 *   L'ouverture automatique après la sortie de l'appli (`AUTO_TG` / `AUTO_INTENT`) n'y entre jamais : elle est
 *   comptée dans la sortie de TikTok. Une ouverture vue dans l'appli (`inApp`) suivie dans la minute d'une sortie de
 *   la même visite (ESCAPED, même `visitId` ou même identifiant de clic) n'y entre pas non plus : la page de l'appli a
 *   été cachée par le passage à Safari ou Chrome, Telegram ne s'est pas ouvert ;
 * - sortie de TikTok (phase 16, requête `escapes`, règle pure `escapeFigures`) :
 *   - « Aide affichée » = visites dont la PREMIÈRE aide (HELP, l'aide « Ouvrir dans le navigateur » montrée dans une
 *     appli) est dans la période ; système et source : ceux de l'aide ;
 *   - sortie « après l'aide » = une de ces visites rouverte ensuite dans Safari ou Chrome (ESCAPED), à n'importe quel
 *     moment après l'aide, même après la fin de la période (une aide à 23 h 59 et une sortie à 0 h 01 comptent le
 *     jour de l'aide) : même visite (marqueur `tgo` + `vid`), ou, repère perdu, nouvelle visite reconnue par
 *     l'identifiant de clic de la pub (sortie `TTCLID` / `FBCLID` de la même page avec le même `ttclid` / `fbclid` que
 *     l'aide, 30 min au plus après elle, `LANDING_ESCAPE_MAX_AGE_MS`) ;
 *   - sortie « sans l'aide » (`direct`) = ESCAPED dans la période d'une visite qui n'a jamais vu l'aide, et qu'aucune
 *     aide du même identifiant de clic ne précède (30 min au plus) : page ouverte dans le navigateur avant l'appui
 *     (sortie `VID` ou `TTCLID`), ou lien de pub ouvert directement dans Safari ou Chrome ; système et source : ceux
 *     de la sortie ;
 *   - « Sortis de TikTok » = sorties après l'aide + sorties sans l'aide (visites distinctes : jamais comptées deux
 *     fois) ; « % sortis » = sorties après l'aide ÷ aide affichée (les sorties sans l'aide n'y entrent jamais ; aucun
 *     plafond ; total = somme des numérateurs ÷ somme des dénominateurs, aucune compensation entre systèmes) ;
 *   - « Telegram ouvert après la sortie » = sorties suivies d'une ouverture de Telegram (OPENED hors de l'appli, après
 *     la sortie, de n'importe quelle façon : tout seul `AUTO_TG` / `AUTO_INTENT`, ou par un appui sur le bouton quand
 *     l'ouverture automatique est refusée, Chrome sur iPhone par exemple), dont « tout seul » ; robots exclus ;
 * - visites arrivées avec une source inconnue, retirée ou pas encore prête (`LandingEvent.rawSrc`) : comptées dans le
 *   lien principal, et signalées sous le tableau.
 * En dessous de la page (comparaison, D10) : les liens directs des pubs du même canal (liens d'entrée AD_ENTRY) sur la
 * même période : clics humains sur le lien goolink, demandes, acceptés, coût par join (même partage de la dépense).
 *
 * Règles pures (`allocateAdSpend`, `buildLandingTables`, `buildDirectLinks`, `openedBySystem`, `escapeFigures`,
 * `costView`) testées dans stats.test.ts ; lectures en base en quelques requêtes groupées (`loadLandingTables`,
 * `loadDirectAdLinks`, `loadAdSpendAllocation`), testées en intégration (landing-flow, landing-flow-escape).
 */

// ─── Types ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Visites ou clics humains distincts d'une source (une ligne par page, source et type). */
export type LandingVisitCount = {
  pageId: string;
  sourceKey: string;
  type: "VIEW" | "CLICK";
  n: number;
};

/**
 * Premiers appuis de chaque visite et ouvertures de Telegram qui les suivent (événements humains), par système,
 * navigateur et façon d'ouvrir (voir `loadLandingTables`) : CLICK = premiers appuis, OPENED = ceux suivis d'une
 * ouverture.
 */
export type LandingOpenCount = {
  pageId: string;
  sourceKey: string;
  os: string | null;
  /** Navigateur intégré (`LandingEvent.inApp`) ; null : navigateur habituel du téléphone. */
  inApp: string | null;
  method: string | null;
  type: "CLICK" | "OPENED";
  n: number;
};

/** Demandes et acceptés d'un lien LANDING (le lien garde sa page, sa source et sa pub, même révoqué). */
export type LandingLinkRequestCount = {
  pageId: string;
  sourceKey: string;
  inviteLinkId: string;
  requests: number;
  approved: number;
};

/** Source d'une page (active ou retirée), sa pub reliée aujourd'hui et son lien actuel. */
export type LandingSourceRef = {
  pageId: string;
  key: string;
  adId: string | null;
  isActive: boolean;
  /** Lien actuel de la source (null tant que Telegram ne l'a pas créé). */
  inviteLinkId?: string | null;
};

/** Lien LANDING d'une page : sa source et la pub figée sur lui à sa création (D9). */
export type LandingLinkRef = {
  id: string;
  pageId: string;
  sourceKey: string;
  adId: string | null;
};

/** Visites avec une source inconnue, retirée ou pas encore prête (`rawSrc`, en minuscules). */
export type UnknownSourceCount = { pageId: string; raw: string; n: number };

/** Une façon d'ouvrir Telegram dans un navigateur. */
export type OpenedMethod = { method: string; clicks: number; opened: number; rate: number | null };

/** Ouverture de Telegram dans un navigateur d'un système (« TikTok sur iPhone »), par façon d'ouvrir. */
export type OpenedByBrowser = {
  key: string;
  os: LandingOs;
  inApp: LandingInApp | null;
  label: string;
  clicks: number;
  opened: number;
  rate: number | null;
  methods: OpenedMethod[];
  /**
   * Lien Telegram classique dans une appli : la page Telegram (t.me) s'affiche d'abord et l'ouverture faite depuis
   * elle n'est pas vue (la page est remplacée) : son chiffre est un minimum.
   */
  httpsInApp: boolean;
};

/** Ouverture de Telegram pour un système, et le détail par navigateur. */
export type OpenedBySystem = {
  os: LandingOs;
  clicks: number;
  opened: number;
  /** Ouvertures ÷ clics ; null sans clic. */
  rate: number | null;
  browsers: OpenedByBrowser[];
};

/**
 * Sortie de l'appli (phase 16), visites distinctes par page, source et système (requête `escapes` de
 * `loadLandingTables`) : une visite n'a qu'un système et qu'une source (ceux de l'aide, ou de la sortie directe).
 */
export type LandingEscapeCount = {
  pageId: string;
  sourceKey: string;
  os: string | null;
  /** Visites dont la première aide est dans la période. */
  help: number;
  /** Parmi elles, celles rouvertes ensuite dans Safari ou Chrome (même visite, ou même identifiant de clic). */
  helpedEscaped: number;
  /** Visites rouvertes dans Safari ou Chrome dans la période sans aucune aide avant (sorties sans l'aide). */
  direct: number;
  /** Sorties (après l'aide ou sans l'aide) avec une ouverture automatique tentée. */
  autoTried: number;
  /** Sorties suivies de Telegram ouvert, de n'importe quelle façon. */
  openedAfter: number;
  /** Dont Telegram ouvert tout seul (`AUTO_TG` / `AUTO_INTENT`). */
  autoOpened: number;
};

/** Chiffres de la sortie de l'appli (une source, toute la page ou un système). */
export type EscapeFigures = {
  /** « Aide affichée » : visites où l'aide « Ouvrir dans le navigateur » a été montrée (première aide). */
  help: number;
  /** « Sortis de TikTok » : visites rouvertes dans Safari ou Chrome (après l'aide + sans l'aide). */
  escaped: number;
  /** Visites aidées puis rouvertes dans Safari ou Chrome (numérateur de « % sortis »). */
  helpedEscaped: number;
  /** « dont N sans l'aide » : sorties sans aide avant elles (navigateur ouvert avant l'appui, lien ouvert hors de l'appli), hors du %. */
  direct: number;
  /** « % sortis » : sorties après l'aide ÷ aide affichée ; null sans aide. */
  rate: number | null;
  /** Ouvertures automatiques de Telegram tentées après la sortie. */
  autoTried: number;
  /** « Telegram ouvert après la sortie » : sorties suivies de Telegram ouvert (tout seul ou par un appui). */
  openedAfter: number;
  /** Dont Telegram ouvert tout seul. */
  autoOpened: number;
};

export type EscapeBySystem = EscapeFigures & { os: LandingOs };

/** Sortie de l'appli et détail par système (systèmes sans aide ni sortie absents). */
export type LandingEscape = EscapeFigures & { systems: EscapeBySystem[] };

/** Pourquoi la dépense d'une pub reliée n'est pas connue : saisie pour toute la campagne ou le groupe, ou aucune. */
export type SpendNote = "campaign" | "none";

export type LandingFigures = LandingCounts &
  LandingRates & {
    /** Demandes arrivées par des liens dont la pub a une dépense connue (dénominateur du coût par join). */
    costRequests: number;
    /** Une pub est reliée (aujourd'hui, ou au lien d'une demande ou d'une visite de la période). */
    adLinked: boolean;
    /** Pub reliée mais dépense inconnue : la raison (sinon null). */
    spendNote: SpendNote | null;
    /** Ouverture de Telegram par système (systèmes sans clic absents). */
    opened: OpenedBySystem[];
    /** Sortie de TikTok (ou d'une autre appli) vers Safari ou Chrome (phase 16). */
    escape: LandingEscape;
  };

export type LandingSourceRow = LandingFigures & {
  key: string;
  isActive: boolean;
  adId: string | null;
};

export type LandingPageTable = {
  pageId: string;
  totals: LandingFigures;
  sources: LandingSourceRow[];
  /** Sources inconnues ou retirées vues dans les adresses (visites comptées dans le lien principal), les plus vues d'abord. */
  unknownSources: Array<{ raw: string; visits: number }>;
};

// ─── Règles pures : ouverture de Telegram ────────────────────────────────────────────────────────────────────────

/** Ordre et libellés des systèmes. */
export const LANDING_OS_ORDER: readonly LandingOs[] = ["IOS", "ANDROID", "OTHER"];
export const LANDING_OS_LABELS: Record<LandingOs, string> = {
  IOS: "iPhone",
  ANDROID: "Android",
  OTHER: "Autre",
};

/** Navigateurs intégrés, dans l'ordre d'affichage (le navigateur habituel du téléphone en dernier). */
const INAPP_ORDER: ReadonlyArray<LandingInApp | null> = [
  "TIKTOK",
  "INSTAGRAM",
  "FACEBOOK",
  "OTHER",
  null,
];
const INAPP_LABELS: Record<LandingInApp, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook ou Messenger",
  OTHER: "Autre appli",
};

/** Libellé d'un navigateur : « TikTok sur iPhone », « Safari ou Chrome sur iPhone », « Ordinateur ou autre appareil ». */
export function browserLabel(os: LandingOs, inApp: LandingInApp | null): string {
  if (os === "OTHER")
    return inApp ? `${INAPP_LABELS[inApp]} sur un autre appareil` : "Ordinateur ou autre appareil";
  if (inApp) return `${INAPP_LABELS[inApp]} sur ${LANDING_OS_LABELS[os]}`;
  return os === "IOS" ? "Safari ou Chrome sur iPhone" : "Chrome ou autre navigateur sur Android";
}

/**
 * Façons d'ouvrir Telegram, en mots simples. Envoyées (phase 16, `LANDING_SENT_OPEN_METHODS`) : `HTTPS` (navigateur
 * normal), `TG_FRAME` (appli : aide et tentative dans un cadre caché), `TG_NAV` (applis Meta sur iPhone : la page demande
 * l'appli dans le geste de l'appui), `INTENT_HELP` (applis Meta sur Android), `AUTO_TG` / `AUTO_INTENT` (ouverture
 * automatique une fois la page rouverte dans Safari ou Chrome). Retirées, gardées pour les anciennes données
 * (`LANDING_RETIRED_OPEN_METHODS`) : `TG_SCHEME`, `INTENT` (phase 15, avec repli), `INTENT_FRAME`.
 */
export const LANDING_METHOD_LABELS: Record<string, string> = {
  TG_SCHEME: "Ouverture directe de l'appli",
  INTENT: "Ouverture par Android, avec repli",
  HTTPS: "Lien Telegram classique",
  TG_FRAME: "Ouverture en arrière-plan, avec l'aide",
  INTENT_FRAME: "Ouverture par Android en arrière-plan, avec l'aide",
  TG_NAV: "Ouverture de l'appli par la page, avec l'aide",
  INTENT_HELP: "Ouverture par Android, avec l'aide",
  AUTO_TG: "Ouverture automatique après la sortie",
  AUTO_INTENT: "Ouverture automatique après la sortie",
};

/** Libellé d'une façon d'ouvrir (une façon inconnue garde un libellé générique). */
export function methodLabel(method: string): string {
  return LANDING_METHOD_LABELS[method] ?? "Autre façon d'ouvrir";
}

function osOf(raw: string | null): LandingOs {
  return raw === "IOS" || raw === "ANDROID" ? raw : "OTHER";
}

function inAppOf(raw: string | null): LandingInApp | null {
  if (!raw) return null;
  return raw === "TIKTOK" || raw === "INSTAGRAM" || raw === "FACEBOOK" ? raw : "OTHER";
}

type Cell = { clicks: number; opened: number };

function rated(c: Cell): { clicks: number; opened: number; rate: number | null } {
  // Une ouverture ne peut pas dépasser les clics (un envoi en double ne fausse pas le taux).
  const opened = Math.min(c.opened, c.clicks);
  return { clicks: c.clicks, opened, rate: landingRatio(opened, c.clicks) };
}

/** Premiers appuis d'une page, d'une source, d'un navigateur et d'une façon d'ouvrir, et ceux suivis d'une ouverture. */
export type FirstClickCount = Omit<LandingOpenCount, "type" | "n"> & {
  clicks: number;
  opened: number;
};

/** Lignes de `openedBySystem` (CLICK = premiers appuis, OPENED = ceux suivis d'une ouverture). */
export function openCountsOfFirstClicks(rows: readonly FirstClickCount[]): LandingOpenCount[] {
  return rows.flatMap(({ clicks, opened, ...key }) => [
    { ...key, type: "CLICK" as const, n: Number(clicks) },
    ...(Number(opened) > 0 ? [{ ...key, type: "OPENED" as const, n: Number(opened) }] : []),
  ]);
}

/**
 * Ouvertures de Telegram regroupées par système, puis par navigateur (`inApp`), puis par façon d'ouvrir ; systèmes,
 * navigateurs et façons sans clic retirés. Les façons d'ouvrir ne se comparent qu'à l'intérieur d'un navigateur : la
 * façon dépend du navigateur (le tirage au sort de la phase 15 n'existait que dans TikTok), et Safari ou Chrome n'ont
 * pas les mêmes chances qu'une appli.
 */
export function openedBySystem(
  rows: readonly Pick<LandingOpenCount, "os" | "inApp" | "method" | "type" | "n">[],
): OpenedBySystem[] {
  const by = new Map<LandingOs, Map<LandingInApp | null, Map<string, Cell>>>();
  for (const r of rows) {
    const os = osOf(r.os);
    const browsers = by.get(os) ?? new Map<LandingInApp | null, Map<string, Cell>>();
    const inApp = inAppOf(r.inApp ?? null);
    const methods = browsers.get(inApp) ?? new Map<string, Cell>();
    const m = r.method ?? "?";
    const cell = methods.get(m) ?? { clicks: 0, opened: 0 };
    if (r.type === "CLICK") cell.clicks += r.n;
    else cell.opened += r.n;
    methods.set(m, cell);
    browsers.set(inApp, methods);
    by.set(os, browsers);
  }
  const sum = (cells: Iterable<Cell>): Cell => {
    const t = { clicks: 0, opened: 0 };
    for (const c of cells) {
      t.clicks += c.clicks;
      t.opened += Math.min(c.opened, c.clicks);
    }
    return t;
  };
  const out: OpenedBySystem[] = [];
  for (const os of LANDING_OS_ORDER) {
    const browsers = by.get(os);
    if (!browsers) continue;
    const list: OpenedByBrowser[] = [];
    for (const inApp of INAPP_ORDER) {
      const methods = browsers.get(inApp);
      if (!methods) continue;
      const total = sum(methods.values());
      if (total.clicks === 0) continue;
      const shown = [...methods.entries()]
        .filter(([method, c]) => method !== "?" && c.clicks > 0)
        .map(([method, c]) => ({ method, ...rated(c) }))
        .sort((a, b) => b.clicks - a.clicks || a.method.localeCompare(b.method));
      list.push({
        key: `${os}:${inApp ?? "WEB"}`,
        os,
        inApp,
        label: browserLabel(os, inApp),
        ...rated(total),
        methods: shown,
        httpsInApp: inApp !== null && shown.some((m) => m.method === "HTTPS"),
      });
    }
    const total = sum([...browsers.values()].flatMap((m) => [...m.values()]));
    if (total.clicks === 0) continue;
    out.push({ os, ...rated(total), browsers: list });
  }
  return out;
}

// ─── Règles pures : sortie de l'appli (phase 16) ─────────────────────────────────────────────────────────────────

/** Champs comptés d'une ligne de la requête `escapes`. */
const ESCAPE_FIELDS = [
  "help",
  "helpedEscaped",
  "direct",
  "autoTried",
  "openedAfter",
  "autoOpened",
] as const;
type EscapeCell = Record<(typeof ESCAPE_FIELDS)[number], number>;

const EMPTY_ESCAPE = (): EscapeCell => ({
  help: 0,
  helpedEscaped: 0,
  direct: 0,
  autoTried: 0,
  openedAfter: 0,
  autoOpened: 0,
});

/** Sortis = après l'aide + sans l'aide ; % sortis = après l'aide ÷ aide affichée (sans l'aide : jamais dans le %). */
function escapeRated(c: EscapeCell): EscapeFigures {
  return {
    help: c.help,
    escaped: c.helpedEscaped + c.direct,
    helpedEscaped: c.helpedEscaped,
    direct: c.direct,
    rate: landingRatio(c.helpedEscaped, c.help),
    autoTried: c.autoTried,
    openedAfter: c.openedAfter,
    autoOpened: c.autoOpened,
  };
}

/**
 * Sortie de TikTok (ou d'une autre appli) d'une source ou de toute la page, et par système (iPhone, Android, puis
 * « Autre » s'il y en a ; systèmes sans aide ni sortie absents). Les lignes comptent des visites distinctes par
 * système (`loadLandingTables`) : une visite n'a qu'un système et qu'une source, les sommes ne comptent rien deux fois.
 * « % sortis » d'un système comme du total : visites aidées puis sorties ÷ visites aidées (somme des numérateurs ÷
 * somme des dénominateurs : un système sans aide ne compense jamais un autre) ; aucun plafond, une sortie sans aide
 * (« sans l'aide », `direct`) est comptée dans les sortis mais jamais dans le %.
 */
export function escapeFigures(
  rows: readonly Pick<LandingEscapeCount, "os" | (typeof ESCAPE_FIELDS)[number]>[],
): LandingEscape {
  const by = new Map<LandingOs, EscapeCell>();
  for (const r of rows) {
    const os = osOf(r.os);
    const c = by.get(os) ?? EMPTY_ESCAPE();
    for (const k of ESCAPE_FIELDS) c[k] += Number(r[k]) || 0;
    by.set(os, c);
  }
  const systems: EscapeBySystem[] = [];
  const total = EMPTY_ESCAPE();
  for (const os of LANDING_OS_ORDER) {
    const c = by.get(os);
    if (!c || (c.help === 0 && c.helpedEscaped + c.direct === 0)) continue;
    systems.push({ os, ...escapeRated(c) });
    for (const k of ESCAPE_FIELDS) total[k] += c[k];
  }
  return { ...escapeRated(total), systems };
}

// ─── Règles pures : dépense d'une pub partagée entre ses chemins d'arrivée ──────────────────────────────────────

/** Un chemin d'arrivée d'une pub : son lien direct (lien d'entrée) ou le lien d'une page reliée à elle. */
export type AdPath = {
  linkId: string;
  adId: string;
  /** Chemin en service aujourd'hui (lien direct actif, lien actuel d'une source active). */
  current: boolean;
};

/** Un compte par lien et par jour de Paris (`AAAA-MM-JJ`). */
export type LinkDayCount = { linkId: string; day: string; n: number };

/** Dépense d'une pub un jour donné (EUR, niveau `ad:<id>`). */
export type AdDaySpend = { adId: string; day: string; spend: number };

export type AdSpendAllocation = {
  /** `known` : dépense de la pub connue (même nulle) ; `campaign` : saisie pour toute la campagne ou le groupe ; `none` : aucune. */
  state: "known" | SpendNote;
  /** Dépense de la pub sur la période (null si inconnue). */
  spend: number | null;
  /** Part de chaque chemin (EUR, non arrondie). */
  byLink: ReadonlyMap<string, number>;
};

function addShare(
  byLink: Map<string, number>,
  amount: number,
  weights: ReadonlyArray<readonly [string, number]>,
): boolean {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  if (!(total > 0)) return false;
  for (const [linkId, w] of weights)
    if (w > 0) byLink.set(linkId, (byLink.get(linkId) ?? 0) + (amount * w) / total);
  return true;
}

/**
 * Partage de la dépense de chaque pub entre ses chemins d'arrivée (pure). Pour chaque jour où la pub a dépensé : au
 * prorata des arrivées du jour (clics humains sur son lien direct, visites humaines de la page par le lien de la
 * source), sinon des demandes du jour. Une dépense d'un jour sans arrivée ni demande : au prorata des arrivées de toute
 * la période, sinon de ses demandes, sinon à parts égales entre les chemins en service (sinon tous). La somme des parts
 * est la dépense de la pub : rien n'est compté deux fois (page et lien direct, ou deux pages). Sans aucune ligne
 * `ad:<id>` sur la période : dépense inconnue (`campaign` si la campagne ou le groupe de la pub en a une, `none`
 * sinon), jamais zéro.
 */
export function allocateAdSpend(input: {
  adIds: readonly string[];
  paths: readonly AdPath[];
  spend: readonly AdDaySpend[];
  /** Pubs dont le groupe ou la campagne a une dépense sur la période (saisie à ce niveau). */
  coarse: ReadonlySet<string>;
  arrivals: readonly LinkDayCount[];
  requests: readonly LinkDayCount[];
}): Map<string, AdSpendAllocation> {
  const index = (rows: readonly LinkDayCount[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const days = m.get(r.linkId) ?? new Map<string, number>();
      days.set(r.day, (days.get(r.day) ?? 0) + r.n);
      m.set(r.linkId, days);
    }
    return m;
  };
  const arrivals = index(input.arrivals);
  const requests = index(input.requests);
  const spendBy = new Map<string, Map<string, number>>();
  for (const s of input.spend) {
    const days = spendBy.get(s.adId) ?? new Map<string, number>();
    days.set(s.day, (days.get(s.day) ?? 0) + s.spend);
    spendBy.set(s.adId, days);
  }
  const out = new Map<string, AdSpendAllocation>();
  for (const adId of new Set(input.adIds)) {
    const days = spendBy.get(adId);
    if (!days) {
      out.set(adId, {
        state: input.coarse.has(adId) ? "campaign" : "none",
        spend: null,
        byLink: new Map(),
      });
      continue;
    }
    const paths = input.paths.filter((p) => p.adId === adId);
    const byLink = new Map<string, number>();
    const dayWeights = (m: Map<string, Map<string, number>>, day: string) =>
      paths.map((p) => [p.linkId, m.get(p.linkId)?.get(day) ?? 0] as const);
    const periodWeights = (m: Map<string, Map<string, number>>) =>
      paths.map(
        (p) =>
          [p.linkId, [...(m.get(p.linkId)?.values() ?? [])].reduce((a, b) => a + b, 0)] as const,
      );
    let total = 0;
    let unplaced = 0;
    for (const [day, amount] of [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      total += amount;
      if (!(amount > 0)) continue;
      if (addShare(byLink, amount, dayWeights(arrivals, day))) continue;
      if (addShare(byLink, amount, dayWeights(requests, day))) continue;
      unplaced += amount;
    }
    if (unplaced > 0) {
      const equal = (list: readonly AdPath[]) => list.map((p) => [p.linkId, 1] as const);
      const candidates = [
        periodWeights(arrivals),
        periodWeights(requests),
        equal(paths.filter((p) => p.current)),
        equal(paths),
      ];
      // Une pub sans aucun chemin (ni lien direct, ni page) : sa dépense ne va nulle part dans ces tableaux.
      for (const weights of candidates) if (addShare(byLink, unplaced, weights)) break;
    }
    out.set(adId, { state: "known", spend: round2(total), byLink });
  }
  return out;
}

// ─── Règles pures : tableaux ─────────────────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Chiffres et argent d'une source (ou de toute la page) en cours de calcul. */
type Acc = LandingCounts & {
  costRequests: number;
  /** Une pub a une dépense connue (même nulle). */
  known: boolean;
  adLinked: boolean;
  notes: Set<SpendNote>;
};

const EMPTY = (): Acc => ({
  visits: 0,
  clicks: 0,
  requests: 0,
  approved: 0,
  spend: null,
  costRequests: 0,
  known: false,
  adLinked: false,
  notes: new Set(),
});

function finish(
  a: Acc,
  opens: readonly LandingOpenCount[],
  escapes: readonly LandingEscapeCount[],
): LandingFigures {
  const spend = a.known ? round2(a.spend ?? 0) : null;
  return {
    visits: a.visits,
    clicks: a.clicks,
    requests: a.requests,
    approved: a.approved,
    spend,
    clickRate: landingRatio(a.clicks, a.visits),
    visitToJoin: landingRatio(a.requests, a.visits),
    costRequests: a.costRequests,
    costPerJoin: spend !== null && a.costRequests > 0 ? spend / a.costRequests : null,
    adLinked: a.adLinked,
    spendNote: a.adLinked && !a.known ? (a.notes.has("campaign") ? "campaign" : "none") : null,
    opened: openedBySystem(opens),
    escape: escapeFigures(escapes),
  };
}

/**
 * Tableaux des pages : une ligne par source (sources actives toujours, sources retirées seulement si elles ont des
 * chiffres ou une dépense sur la période), le lien principal en tête puis par nom, et le total de la page. Un
 * événement d'une source inconnue compte pour le lien principal (et est signalé dans `unknownSources`).
 * Argent : pour chaque lien de la source, la part de dépense de la pub figée sur lui (`allocation`) ; les demandes de
 * ce lien entrent dans le coût par join seulement si la dépense de sa pub est connue. Total : sommes des sources.
 */
export function buildLandingTables(input: {
  pageIds: readonly string[];
  sources: readonly LandingSourceRef[];
  links?: readonly LandingLinkRef[];
  visits: readonly LandingVisitCount[];
  opens: readonly LandingOpenCount[];
  /** Sortie de l'appli (phase 16), visites distinctes par source et système. */
  escapes?: readonly LandingEscapeCount[];
  requests: readonly LandingLinkRequestCount[];
  unknown?: readonly UnknownSourceCount[];
  /** Partage de la dépense des pubs figées sur les liens (`allocateAdSpend`). */
  allocation: ReadonlyMap<string, AdSpendAllocation>;
}): Map<string, LandingPageTable> {
  const out = new Map<string, LandingPageTable>();
  for (const pageId of input.pageIds) {
    const refs = input.sources.filter((s) => s.pageId === pageId);
    const known = new Set(refs.map((s) => s.key));
    const keyOf = (k: string) => (known.has(k) ? k : DEFAULT_LANDING_SOURCE);
    const accs = new Map<string, Acc>();
    const get = (k: string) => {
      const key = keyOf(k);
      const a = accs.get(key) ?? EMPTY();
      accs.set(key, a);
      return a;
    };
    for (const v of input.visits)
      if (v.pageId === pageId) {
        const a = get(v.sourceKey);
        if (v.type === "VIEW") a.visits += v.n;
        else a.clicks += v.n;
      }
    const requestsOf = new Map<string, number>();
    for (const r of input.requests)
      if (r.pageId === pageId) {
        const a = get(r.sourceKey);
        a.requests += r.requests;
        a.approved += r.approved;
        requestsOf.set(r.inviteLinkId, (requestsOf.get(r.inviteLinkId) ?? 0) + r.requests);
      }
    const opens = new Map<string, LandingOpenCount[]>();
    for (const o of input.opens)
      if (o.pageId === pageId) {
        const key = keyOf(o.sourceKey);
        opens.set(key, [...(opens.get(key) ?? []), o]);
      }
    const pageEscapes = (input.escapes ?? []).filter((e) => e.pageId === pageId);
    const escapes = new Map<string, LandingEscapeCount[]>();
    for (const e of pageEscapes) {
      const key = keyOf(e.sourceKey);
      escapes.set(key, [...(escapes.get(key) ?? []), e]);
    }

    // Argent : chaque lien de la page compte pour sa source, avec la pub figée sur lui.
    const currentLink = new Set(refs.map((s) => s.inviteLinkId).filter((id): id is string => !!id));
    for (const l of input.links ?? []) {
      if (l.pageId !== pageId || !l.adId) continue;
      const alloc = input.allocation.get(l.adId);
      const share = alloc?.byLink.get(l.id) ?? 0;
      const reqs = requestsOf.get(l.id) ?? 0;
      if (share <= 0 && reqs === 0 && !currentLink.has(l.id)) continue;
      const a = get(l.sourceKey);
      a.adLinked = true;
      if (alloc?.state === "known") {
        a.known = true;
        a.spend = (a.spend ?? 0) + share;
        a.costRequests += reqs;
      } else a.notes.add(alloc?.state ?? "none");
    }
    // Pub reliée aujourd'hui (lien pas encore recréé pour elle) : la source est reliée, même sans chiffre.
    for (const s of refs) if (s.adId && s.isActive) get(s.key).adLinked = true;

    // Sources montrées : actives, ou retirées mais avec des chiffres ou une dépense sur la période.
    const hasData = (key: string) => {
      const a = accs.get(key);
      return (
        !!a && (a.visits > 0 || a.clicks > 0 || a.requests > 0 || (a.known && (a.spend ?? 0) > 0))
      );
    };
    const shown = refs.filter((s) => s.isActive || hasData(s.key));
    const rows: LandingSourceRow[] = shown.map((s) => ({
      key: s.key,
      isActive: s.isActive,
      adId: s.adId,
      ...finish(accs.get(s.key) ?? EMPTY(), opens.get(s.key) ?? [], escapes.get(s.key) ?? []),
    }));
    rows.sort(
      (a, b) =>
        Number(b.key === DEFAULT_LANDING_SOURCE) - Number(a.key === DEFAULT_LANDING_SOURCE) ||
        Number(b.isActive) - Number(a.isActive) ||
        a.key.localeCompare(b.key),
    );

    const total = EMPTY();
    for (const a of accs.values()) {
      total.visits += a.visits;
      total.clicks += a.clicks;
      total.requests += a.requests;
      total.approved += a.approved;
      total.costRequests += a.costRequests;
      total.adLinked ||= a.adLinked;
      if (a.known) {
        total.known = true;
        total.spend = (total.spend ?? 0) + (a.spend ?? 0);
      }
      for (const n of a.notes) total.notes.add(n);
    }
    const unknownSources = (input.unknown ?? [])
      .filter((u) => u.pageId === pageId && u.n > 0)
      .reduce((m, u) => m.set(u.raw, (m.get(u.raw) ?? 0) + u.n), new Map<string, number>());
    out.set(pageId, {
      pageId,
      totals: finish(
        total,
        input.opens.filter((o) => o.pageId === pageId),
        pageEscapes,
      ),
      sources: rows,
      unknownSources: [...unknownSources.entries()]
        .map(([raw, visits]) => ({ raw, visits }))
        .sort((a, b) => b.visits - a.visits || a.raw.localeCompare(b.raw)),
    });
  }
  return out;
}

/** Coût par join à afficher : « — » (sans pub ou dépense inconnue), un coût, ou une dépense sans aucun join. */
export type CostView =
  { kind: "none" } | { kind: "cost"; value: number } | { kind: "noJoin"; spend: number };

export function costView(f: { spend: number | null; costPerJoin: number | null }): CostView {
  if (f.spend === null) return { kind: "none" };
  if (f.costPerJoin !== null) return { kind: "cost", value: f.costPerJoin };
  return f.spend > 0 ? { kind: "noJoin", spend: f.spend } : { kind: "none" };
}

/** Valeur de tri du coût par join : une dépense sans join est la plus chère ; « — » reste à la fin. */
export function costSortValue(v: CostView): number | null {
  return v.kind === "cost" ? v.value : v.kind === "noJoin" ? Number.POSITIVE_INFINITY : null;
}

/** Pourquoi le coût est « — » alors qu'une pub est reliée (volet de détail, cartes). */
export const SPEND_NOTE_TEXT: Record<SpendNote, string> = {
  campaign: "Dépense saisie pour toute la campagne ou le groupe de pubs : pas de coût par pub.",
  none: "Aucune dépense de cette pub sur la période.",
};

/** Un lien direct de pub (lien d'entrée) du canal, sur la période. */
export type DirectLinkRow = {
  inviteLinkId: string;
  /** Nom de la pub (sinon du lien). */
  name: string;
  platform: string | null;
  isActive: boolean;
  /** Clics humains sur le lien goolink de la pub. */
  clicks: number;
  requests: number;
  approved: number;
  /** Part de la dépense de la pub (EUR) ; null : lien sans pub, ou dépense inconnue (`spendNote`). */
  spend: number | null;
  spendNote: SpendNote | null;
  /** La pub mène aussi à une page : sa dépense est partagée entre la page et ce lien. */
  sharedWithPage: boolean;
  /** % clic → join = demandes ÷ clics. */
  clickToJoin: number | null;
  costPerJoin: number | null;
};

export type DirectLinksView = {
  rows: DirectLinkRow[];
  totals: Pick<
    DirectLinkRow,
    "clicks" | "requests" | "approved" | "spend" | "clickToJoin" | "costPerJoin"
  >;
};

/**
 * Liens directs des pubs (pure) : ceux qui ont servi sur la période (clics, demandes ou dépense), les plus de demandes
 * d'abord ; dépense = part de la pub pour ce lien (`allocation`) ; total (coût par join du total = dépense ÷ demandes
 * des liens dont la dépense est connue).
 */
export function buildDirectLinks(input: {
  links: ReadonlyArray<{
    id: string;
    name: string;
    platform: string | null;
    isActive: boolean;
    adId: string | null;
  }>;
  clicks: ReadonlyMap<string, number>;
  requests: ReadonlyMap<string, { requests: number; approved: number }>;
  allocation: ReadonlyMap<string, AdSpendAllocation>;
  /** Pubs qui mènent aussi à une page d'atterrissage. */
  adsOnPages?: ReadonlySet<string>;
}): DirectLinksView {
  const rows: DirectLinkRow[] = [];
  for (const l of input.links) {
    const clicks = input.clicks.get(l.id) ?? 0;
    const r = input.requests.get(l.id) ?? { requests: 0, approved: 0 };
    const alloc = l.adId ? input.allocation.get(l.adId) : undefined;
    const spend = l.adId && alloc?.state === "known" ? round2(alloc.byLink.get(l.id) ?? 0) : null;
    if (clicks === 0 && r.requests === 0 && !spend) continue;
    rows.push({
      inviteLinkId: l.id,
      name: l.name,
      platform: l.platform,
      isActive: l.isActive,
      clicks,
      requests: r.requests,
      approved: r.approved,
      spend,
      spendNote:
        l.adId && spend === null ? (alloc?.state === "campaign" ? "campaign" : "none") : null,
      sharedWithPage: !!l.adId && !!input.adsOnPages?.has(l.adId),
      clickToJoin: landingRatio(r.requests, clicks),
      costPerJoin: spend !== null && r.requests > 0 ? spend / r.requests : null,
    });
  }
  rows.sort(
    (a, b) => b.requests - a.requests || b.clicks - a.clicks || a.name.localeCompare(b.name, "fr"),
  );
  const sum = (f: (r: DirectLinkRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const withSpend = rows.filter((r) => r.spend !== null);
  const spend = withSpend.length ? round2(withSpend.reduce((s, r) => s + (r.spend ?? 0), 0)) : null;
  const costRequests = withSpend.reduce((s, r) => s + r.requests, 0);
  const clicks = sum((r) => r.clicks);
  const requests = sum((r) => r.requests);
  return {
    rows,
    totals: {
      clicks,
      requests,
      approved: sum((r) => r.approved),
      spend,
      clickToJoin: landingRatio(requests, clicks),
      costPerJoin: spend === null || costRequests === 0 ? null : spend / costRequests,
    },
  };
}

// ─── Lectures en base ────────────────────────────────────────────────────────────────────────────────────────────

/** Bornes de la période : instants (jours de Paris) et dates des dépenses. */
function bounds(period: Period) {
  return { from: periodStart(period), to: periodEnd(period), ...periodDates(period) };
}

/** Façons d'ouvrir de l'ouverture automatique après la sortie de l'appli (OPENED qui la suit). */
const AUTO_OPEN_METHODS: string[] = ["AUTO_TG", "AUTO_INTENT"];

/**
 * Sorties reconnues par l'identifiant de clic de la pub (repère `vid` perdu) : rattachées à l'aide de la même page qui
 * porte le même `ttclid` / `fbclid`, au plus `LANDING_ESCAPE_MAX_AGE_MS` (30 min) après elle (même durée que le repère
 * de sortie de la page, et que le rattachement fait par le worker).
 */
const CLICK_ID_ESCAPES: string[] = ["TTCLID", "FBCLID"];
const CLICK_ID_MAX_AGE_S = Math.round(LANDING_ESCAPE_MAX_AGE_MS / 1000);

/** Jour d'une dépense (`AdCost.date`, jour civil stocké à minuit UTC) : « AAAA-MM-JJ ». */
const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Partage de la dépense des pubs sur la période (voir `allocateAdSpend`) : chemins de chaque pub (lien direct, liens
 * des pages créés pour elle, toutes pages confondues), dépense par jour, dépense saisie au niveau du groupe ou de la
 * campagne, arrivées et demandes par lien et par jour. Six lectures groupées, quel que soit le nombre de pubs.
 */
export async function loadAdSpendAllocation(
  adIds: readonly string[],
  period: Period,
): Promise<{ allocation: Map<string, AdSpendAllocation>; adsOnPages: Set<string> }> {
  const ids = [...new Set(adIds.filter(Boolean))];
  if (ids.length === 0) return { allocation: new Map(), adsOnPages: new Set() };
  const { from, to, dateFrom, dateTo } = bounds(period);
  const ads = await prisma.ad.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      adSetId: true,
      adSet: { select: { campaignId: true } },
      inviteLink: {
        select: {
          id: true,
          isActive: true,
          trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true } },
        },
      },
      landingLinks: {
        select: { id: true, isActive: true, landingSourceOf: { select: { isActive: true } } },
      },
    },
  });
  const paths: AdPath[] = [];
  const trackingOf = new Map<string, string>();
  const adsOnPages = new Set<string>();
  for (const a of ads) {
    if (a.inviteLink) {
      paths.push({ linkId: a.inviteLink.id, adId: a.id, current: a.inviteLink.isActive });
      for (const t of a.inviteLink.trackingLinks) trackingOf.set(t.id, a.inviteLink.id);
    }
    for (const l of a.landingLinks) {
      adsOnPages.add(a.id);
      paths.push({
        linkId: l.id,
        adId: a.id,
        current: l.isActive && l.landingSourceOf?.isActive === true,
      });
    }
  }
  const landingLinkIds = ads.flatMap((a) => a.landingLinks.map((l) => l.id));
  const linkIds = paths.map((p) => p.linkId);
  const coarseKeys = ads.flatMap((a) => [`adset:${a.adSetId}`, `campaign:${a.adSet.campaignId}`]);
  const [costs, coarseRows, clickRows, visitRows, requestRows] = await Promise.all([
    prisma.adCost.groupBy({
      by: ["adId", "date"],
      where: {
        levelKey: { in: ids.map((id) => `ad:${id}`) },
        date: { gte: dateFrom, lte: dateTo },
      },
      _sum: { spend: true },
    }),
    prisma.adCost.groupBy({
      by: ["levelKey"],
      where: { levelKey: { in: coarseKeys }, date: { gte: dateFrom, lte: dateTo } },
      _count: { _all: true },
    }),
    trackingOf.size
      ? prisma.$queryRaw<Array<{ trackingLinkId: string; day: string; n: number }>>`
          SELECT c."trackingLinkId",
            to_char((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "day",
            COUNT(*)::int AS "n"
          FROM "Click" c
          WHERE c."trackingLinkId" = ANY(${[...trackingOf.keys()]}::text[]) AND c."isBot" = false
            AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
          GROUP BY 1, 2`
      : Promise.resolve([]),
    landingLinkIds.length
      ? landingVisitsByLink({ since: from, until: to, inviteLinkIds: landingLinkIds })
      : Promise.resolve([]),
    linkIds.length
      ? prisma.$queryRaw<Array<{ linkId: string; day: string; n: number }>>`
          SELECT m."inviteLinkId" AS "linkId",
            to_char((m."requestedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "day",
            COUNT(*)::int AS "n"
          FROM "Membership" m
          WHERE m."inviteLinkId" = ANY(${linkIds}::text[])
            AND m."requestedAt" >= ${from} AND m."requestedAt" < ${to}
          GROUP BY 1, 2`
      : Promise.resolve([]),
  ]);
  const coarseSet = new Set(coarseRows.map((r) => r.levelKey));
  const coarse = new Set(
    ads
      .filter(
        (a) =>
          coarseSet.has(`adset:${a.adSetId}`) || coarseSet.has(`campaign:${a.adSet.campaignId}`),
      )
      .map((a) => a.id),
  );
  const arrivals: LinkDayCount[] = [
    ...clickRows.flatMap((c) => {
      const linkId = trackingOf.get(c.trackingLinkId);
      return linkId ? [{ linkId, day: c.day, n: Number(c.n) }] : [];
    }),
    ...visitRows.map((v) => ({ linkId: v.inviteLinkId, day: v.day, n: v.visits })),
  ];
  const allocation = allocateAdSpend({
    adIds: ids,
    paths,
    spend: costs
      .filter((c) => c.adId)
      .map((c) => ({ adId: c.adId!, day: dayKeyOf(c.date), spend: Number(c._sum.spend ?? 0) })),
    coarse,
    arrivals,
    requests: requestRows.map((r) => ({ linkId: r.linkId, day: r.day, n: Number(r.n) })),
  });
  return { allocation, adsOnPages };
}

/** Tableaux de pages sur une période (voir `buildLandingTables`) : quelques requêtes groupées, quel que soit le volume. */
export async function loadLandingTables(
  pageIds: readonly string[],
  period: Period,
): Promise<Map<string, LandingPageTable>> {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return new Map();
  const { from, to } = bounds(period);
  const [sources, links, visits, opens, requests, unknown, escapes] = await Promise.all([
    prisma.landingSource.findMany({
      where: { landingPageId: { in: ids } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { landingPageId: true, key: true, adId: true, isActive: true, inviteLinkId: true },
    }),
    prisma.inviteLink.findMany({
      where: { kind: "LANDING", landingPageId: { in: ids } },
      select: { id: true, landingPageId: true, landingSource: true, landingAdId: true },
    }),
    prisma.$queryRaw<LandingVisitCount[]>`
      SELECT "landingPageId" AS "pageId", "sourceKey", "type"::text AS "type",
        COUNT(DISTINCT "visitId")::int AS "n"
      FROM "LandingEvent"
      WHERE "landingPageId" = ANY(${ids}::text[]) AND "isBot" = false
        AND "type" IN ('VIEW', 'CLICK') AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1, 2, 3`,
    // Premier appui de chaque visite dans la période (mêmes visites que la colonne « Clics »), et s'il a été suivi
    // d'une ouverture de la même façon, avant l'appui suivant de la visite (2 s de marge avant lui pour deux envois
    // arrivés dans le désordre ; une ouverture arrivée après la fin de la période compte encore).
    prisma.$queryRaw<FirstClickCount[]>`
      WITH f AS (
        SELECT DISTINCT ON ("landingPageId", "sourceKey", "visitId")
          "landingPageId", "sourceKey", "visitId", "os", "inApp", "method", "createdAt"
        FROM "LandingEvent"
        WHERE "landingPageId" = ANY(${ids}::text[]) AND "isBot" = false AND "type" = 'CLICK'
          AND "createdAt" >= ${from} AND "createdAt" < ${to}
        ORDER BY "landingPageId", "sourceKey", "visitId", "createdAt", "id"
      )
      SELECT f."landingPageId" AS "pageId", f."sourceKey", f."os", f."inApp", f."method",
        COUNT(*)::int AS "clicks",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "LandingEvent" o
          WHERE o."visitId" = f."visitId" AND o."landingPageId" = f."landingPageId"
            AND o."sourceKey" = f."sourceKey" AND o."type" = 'OPENED' AND o."isBot" = false
            AND o."method" IS NOT DISTINCT FROM f."method"
            AND o."createdAt" >= f."createdAt" - interval '2 seconds'
            AND NOT EXISTS (
              SELECT 1 FROM "LandingEvent" c
              WHERE c."visitId" = f."visitId" AND c."landingPageId" = f."landingPageId"
                AND c."sourceKey" = f."sourceKey" AND c."type" = 'CLICK' AND c."isBot" = false
                AND c."createdAt" > f."createdAt" AND c."createdAt" <= o."createdAt"
            )
            AND NOT (o."inApp" IS NOT NULL AND EXISTS (
              SELECT 1 FROM "LandingEvent" x
              WHERE x."landingPageId" = o."landingPageId" AND x."type" = 'ESCAPED' AND x."isBot" = false
                AND x."createdAt" >= o."createdAt" - interval '2 seconds'
                AND x."createdAt" <= o."createdAt" + interval '60 seconds'
                AND (x."visitId" = o."visitId"
                  OR x."method" = ANY(${CLICK_ID_ESCAPES}::text[]) AND (
                    o."ttclid" IS NOT NULL AND x."ttclid" = o."ttclid"
                    OR o."fbclid" IS NOT NULL AND x."fbclid" = o."fbclid"))
            ))
        ))::int AS "opened"
      FROM f
      GROUP BY 1, 2, 3, 4, 5`.then(openCountsOfFirstClicks),
    prisma.$queryRaw<LandingLinkRequestCount[]>`
      SELECT l."landingPageId" AS "pageId", COALESCE(l."landingSource", '') AS "sourceKey",
        l."id" AS "inviteLinkId",
        COUNT(*)::int AS "requests",
        COUNT(*) FILTER (
          WHERE m."approvedAt" IS NOT NULL OR m."joinedAt" IS NOT NULL
            OR m."status" IN ('APPROVED', 'LEFT', 'KICKED')
        )::int AS "approved"
      FROM "Membership" m
      JOIN "InviteLink" l ON l."id" = m."inviteLinkId"
      WHERE l."kind" = 'LANDING' AND l."landingPageId" = ANY(${ids}::text[])
        AND m."requestedAt" >= ${from} AND m."requestedAt" < ${to}
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<UnknownSourceCount[]>`
      SELECT "landingPageId" AS "pageId", lower("rawSrc") AS "raw", COUNT(DISTINCT "visitId")::int AS "n"
      FROM "LandingEvent"
      WHERE "landingPageId" = ANY(${ids}::text[]) AND "isBot" = false AND "type" = 'VIEW'
        AND "rawSrc" IS NOT NULL AND "rawSrc" <> ''
        AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1, 2`,
    // Sortie de l'appli (phase 16) : visites dont la première aide est dans la période (h) et la première sortie qui
    // leur est rattachée, à n'importe quel moment après l'aide (même visite ; ou, pour une sortie TTCLID / FBCLID, même
    // identifiant de clic, 30 min au plus après l'aide) ; sorties de la période sans aide (d : visite sans aucune aide,
    // ni aide du même identifiant de clic dans les 30 min avant) ; puis, pour chaque sortie, l'ouverture automatique
    // tentée et Telegram ouvert hors de l'appli après elle (2 s de marge pour deux envois arrivés dans le désordre).
    // Système et source : ceux de l'aide (Safari sur iPad se présente comme un Mac), ou de la sortie sans aide.
    prisma.$queryRaw<LandingEscapeCount[]>`
      WITH h AS (
        SELECT DISTINCT ON (x."landingPageId", x."visitId")
          x."landingPageId", x."visitId", x."sourceKey", x."os", x."createdAt", x."ttclid", x."fbclid"
        FROM "LandingEvent" x
        WHERE x."landingPageId" = ANY(${ids}::text[]) AND x."isBot" = false AND x."type" = 'HELP'
          AND x."createdAt" >= ${from} AND x."createdAt" < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM "LandingEvent" y
            WHERE y."visitId" = x."visitId" AND y."landingPageId" = x."landingPageId"
              AND y."type" = 'HELP' AND y."isBot" = false AND y."createdAt" < ${from}
          )
        ORDER BY x."landingPageId", x."visitId", x."createdAt", x."id"
      ),
      hs AS (
        SELECT h."landingPageId", h."sourceKey", h."os", true AS "helped",
          s."visitId" AS "escVisitId", s."createdAt" AS "escAt"
        FROM h
        LEFT JOIN LATERAL (
          SELECT u."visitId", u."createdAt" FROM (
            (SELECT e."visitId", e."createdAt", e."id" FROM "LandingEvent" e
              WHERE e."visitId" = h."visitId" AND e."landingPageId" = h."landingPageId"
                AND e."type" = 'ESCAPED' AND e."isBot" = false
                AND e."createdAt" >= h."createdAt" - interval '2 seconds'
              ORDER BY e."createdAt", e."id"
              LIMIT 1)
            UNION ALL
            (SELECT e."visitId", e."createdAt", e."id" FROM "LandingEvent" e
              WHERE (h."ttclid" IS NOT NULL OR h."fbclid" IS NOT NULL)
                AND e."landingPageId" = h."landingPageId" AND e."type" = 'ESCAPED' AND e."isBot" = false
                AND e."createdAt" >= h."createdAt" - interval '2 seconds'
                AND e."createdAt" <= h."createdAt" + ${CLICK_ID_MAX_AGE_S}::int * interval '1 second'
                AND e."method" = ANY(${CLICK_ID_ESCAPES}::text[])
                AND e."os" IS NOT DISTINCT FROM h."os"
                AND (h."ttclid" IS NOT NULL AND e."ttclid" = h."ttclid"
                  OR h."fbclid" IS NOT NULL AND e."fbclid" = h."fbclid")
              ORDER BY e."createdAt", e."id"
              LIMIT 1)
          ) u
          ORDER BY u."createdAt", u."id"
          LIMIT 1
        ) s ON true
      ),
      d AS (
        SELECT DISTINCT ON (e."landingPageId", e."visitId")
          e."landingPageId", e."sourceKey", e."os", false AS "helped",
          e."visitId" AS "escVisitId", e."createdAt" AS "escAt"
        FROM "LandingEvent" e
        WHERE e."landingPageId" = ANY(${ids}::text[]) AND e."isBot" = false AND e."type" = 'ESCAPED'
          AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
          AND NOT EXISTS (
            SELECT 1 FROM "LandingEvent" y
            WHERE y."visitId" = e."visitId" AND y."landingPageId" = e."landingPageId"
              AND y."type" = 'ESCAPED' AND y."isBot" = false AND y."createdAt" < ${from}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "LandingEvent" x
            WHERE x."visitId" = e."visitId" AND x."landingPageId" = e."landingPageId"
              AND x."type" = 'HELP' AND x."isBot" = false
          )
          AND NOT (e."method" = ANY(${CLICK_ID_ESCAPES}::text[]) AND EXISTS (
            SELECT 1 FROM "LandingEvent" x
            WHERE x."landingPageId" = e."landingPageId" AND x."type" = 'HELP' AND x."isBot" = false
              AND x."createdAt" <= e."createdAt" + interval '2 seconds'
              AND x."createdAt" >= e."createdAt" - ${CLICK_ID_MAX_AGE_S}::int * interval '1 second'
              AND x."os" IS NOT DISTINCT FROM e."os"
              AND (e."ttclid" IS NOT NULL AND x."ttclid" = e."ttclid"
                OR e."fbclid" IS NOT NULL AND x."fbclid" = e."fbclid")
          ))
        ORDER BY e."landingPageId", e."visitId", e."createdAt", e."id"
      ),
      z AS (
        SELECT * FROM hs
        UNION ALL
        SELECT * FROM d
      )
      SELECT z."landingPageId" AS "pageId", z."sourceKey", z."os",
        COUNT(*) FILTER (WHERE z."helped")::int AS "help",
        COUNT(*) FILTER (WHERE z."helped" AND z."escVisitId" IS NOT NULL)::int AS "helpedEscaped",
        COUNT(*) FILTER (WHERE NOT z."helped")::int AS "direct",
        COUNT(*) FILTER (WHERE z."escVisitId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "LandingEvent" a
          WHERE a."visitId" = z."escVisitId" AND a."landingPageId" = z."landingPageId"
            AND a."type" = 'AUTO_OPEN' AND a."isBot" = false
            AND a."createdAt" >= z."escAt" - interval '2 seconds'
        ))::int AS "autoTried",
        COUNT(*) FILTER (WHERE z."escVisitId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "LandingEvent" o
          WHERE o."visitId" = z."escVisitId" AND o."landingPageId" = z."landingPageId"
            AND o."type" = 'OPENED' AND o."isBot" = false AND o."inApp" IS NULL
            AND o."createdAt" >= z."escAt" - interval '2 seconds'
        ))::int AS "openedAfter",
        COUNT(*) FILTER (WHERE z."escVisitId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "LandingEvent" o
          WHERE o."visitId" = z."escVisitId" AND o."landingPageId" = z."landingPageId"
            AND o."type" = 'OPENED' AND o."isBot" = false AND o."inApp" IS NULL
            AND o."method" = ANY(${AUTO_OPEN_METHODS}::text[])
            AND o."createdAt" >= z."escAt" - interval '2 seconds'
        ))::int AS "autoOpened"
      FROM z
      GROUP BY 1, 2, 3`,
  ]);
  const { allocation } = await loadAdSpendAllocation(
    links.map((l) => l.landingAdId).filter((id): id is string => !!id),
    period,
  );
  return buildLandingTables({
    pageIds: ids,
    sources: sources.map((s) => ({
      pageId: s.landingPageId,
      key: s.key,
      adId: s.adId,
      isActive: s.isActive,
      inviteLinkId: s.inviteLinkId,
    })),
    links: links
      .filter((l) => l.landingPageId)
      .map((l) => ({
        id: l.id,
        pageId: l.landingPageId!,
        sourceKey: l.landingSource ?? DEFAULT_LANDING_SOURCE,
        adId: l.landingAdId,
      })),
    visits,
    opens,
    escapes,
    requests,
    unknown,
    allocation,
  });
}

/** Liens directs des pubs d'un canal sur la période (comparaison sous le tableau d'une page). */
export async function loadDirectAdLinks(
  channelId: string,
  period: Period,
): Promise<DirectLinksView> {
  const { from, to } = bounds(period);
  const links = await prisma.inviteLink.findMany({
    where: { channelId, kind: "AD_ENTRY" },
    select: {
      id: true,
      name: true,
      adName: true,
      adPlatform: true,
      isActive: true,
      ad: { select: { id: true, name: true } },
      trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true } },
    },
  });
  if (links.length === 0)
    return buildDirectLinks({
      links: [],
      clicks: new Map(),
      requests: new Map(),
      allocation: new Map(),
    });
  const trackingOf = new Map<string, string>();
  for (const l of links) for (const t of l.trackingLinks) trackingOf.set(t.id, l.id);
  const [clickRows, requestRows, spend] = await Promise.all([
    trackingOf.size
      ? prisma.click.groupBy({
          by: ["trackingLinkId"],
          where: {
            trackingLinkId: { in: [...trackingOf.keys()] },
            isBot: false,
            createdAt: { gte: from, lt: to },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.$queryRaw<Array<{ inviteLinkId: string; requests: number; approved: number }>>`
      SELECT m."inviteLinkId", COUNT(*)::int AS "requests",
        COUNT(*) FILTER (
          WHERE m."approvedAt" IS NOT NULL OR m."joinedAt" IS NOT NULL
            OR m."status" IN ('APPROVED', 'LEFT', 'KICKED')
        )::int AS "approved"
      FROM "Membership" m
      WHERE m."inviteLinkId" = ANY(${links.map((l) => l.id)}::text[])
        AND m."requestedAt" >= ${from} AND m."requestedAt" < ${to}
      GROUP BY 1`,
    loadAdSpendAllocation(
      links.map((l) => l.ad?.id).filter((id): id is string => !!id),
      period,
    ),
  ]);
  const clicks = new Map<string, number>();
  for (const c of clickRows) {
    const linkId = trackingOf.get(c.trackingLinkId);
    if (linkId) clicks.set(linkId, (clicks.get(linkId) ?? 0) + c._count._all);
  }
  return buildDirectLinks({
    links: links.map((l) => ({
      id: l.id,
      name: l.ad?.name?.trim() || l.adName?.trim() || l.name,
      platform: l.adPlatform,
      isActive: l.isActive,
      adId: l.ad?.id ?? null,
    })),
    clicks,
    requests: new Map(requestRows.map((r) => [r.inviteLinkId, r] as const)),
    allocation: spend.allocation,
    adsOnPages: spend.adsOnPages,
  });
}
