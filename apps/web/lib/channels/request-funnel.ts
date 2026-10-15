import {
  UNKNOWN_PROVENANCE,
  effectiveGateChannelIds,
  provenanceFromJson,
  provenanceOfLink,
  type Provenance,
  type ProvenanceLink,
  type RuleScope,
} from "@linkaffipro/core";
import { Prisma, prisma } from "@linkaffipro/db";
import type { Variation } from "@/components/admin/stat-card-logic";
import { comparableVariation } from "@/lib/dashboard/display";
import {
  PERIOD_LABELS,
  periodEnd,
  periodStart,
  previousPeriod,
  resolvePeriod,
  type Period,
  type PeriodKey,
} from "@/lib/periods";
import { share } from "./provenance-stats";

/**
 * Parcours des demandes d'adhésion (phase 14, décision E9) : fiche canal → onglet « Demandes » (en haut) et
 * Statistiques → Canaux. Constat du 15 octobre (Zone Interdite, pub TikTok) : des demandes restaient sur « Attend les
 * canaux », une partie des personnes bloquaient le bot juste après l'accueil, et des rappels refusés par Telegram
 * étaient comptés comme des blocages.
 *
 * Les demandes faites sur la période, et ce qu'elles sont devenues depuis (jusqu'à maintenant) :
 * 1. **Demandes** : demandes d'adhésion reçues par nos bots (une entrée directe sans demande ne compte pas) ;
 * 2. **Accueil envoyé** : le message d'accueil du bot de la demande est parti (message WELCOME envoyé entre 1 minute
 *    avant et 10 minutes après la demande : même rapprochement que l'alerte « bot bloqué » du worker) ;
 * 3. **Ont bloqué le bot** : vrai blocage seulement (décision E1) : Telegram nous dit que la personne a bloqué le bot
 *    de la demande (`member.blocked`), ou refuse un message avec « bot was blocked by the user » (`dm.blocked` avec
 *    `telegramError`), après la demande. Un message refusé parce que la personne n'a jamais appuyé sur « Démarrer »
 *    (`dm.unreachable`, ou ancien `dm.blocked` sans erreur exacte, d'avant la phase 14) n'est PAS un blocage : il est
 *    compté à part (`unreachable`) ;
 * 4. **Au moins un canal rejoint** et 5. **Tous les canaux rejoints** : demandes qui avaient des canaux à rejoindre
 *    (obligatoires ou proposés, canaux effectifs de la demande : ceux de son accueil, sinon ceux de sa règle sans le
 *    canal d'origine), d'après nos données : demande ou entrée de la personne dans le canal à rejoindre (en cours,
 *    programmée, acceptée, ou entrée puis repartie), ou canaux validés par le bot (`gateSatisfiedAt`) ;
 * 6. **Acceptées** : acceptées par un bot ou à la main, ou entrées dans le canal ;
 * 7. **Parties du canal** : acceptées puis reparties d'elles-mêmes (pas une exclusion).
 *
 * Le tout par provenance : chaque pub (lien d'entrée), le bouton « canal à rejoindre » de chacun de nos canaux,
 * chaque lien de partage, chaque lien du canal, chaque affilié Link Affi, puis « Autres liens ». Provenance enregistrée
 * par le bot (`Membership.source.provenance`), sinon déduite du lien (`provenanceOfLink`, même règle que le bot).
 *
 * Fonctions pures (testées dans request-funnel.test.ts) + lecture en base (`loadFunnelRequests` : une requête pour les
 * demandes avec l'accueil et les blocages calculés en base, une pour les canaux à rejoindre).
 */

// ——— Types ———

/** Lien d'invitation d'une demande, relu en base. */
export type FunnelLink = ProvenanceLink & {
  name: string;
  /** Nom de la pub (`Ad.name`, sinon `InviteLink.adName`). */
  adName: string | null;
  /** Nom actuel de la page d'atterrissage du lien (lien LANDING, phase 15) ; null : page supprimée. */
  landingPageName?: string | null;
};

/** Une demande lue en base, prête pour le calcul. */
export type FunnelRequest = {
  id: string;
  memberId: string;
  channelId: string;
  status: string;
  requestedAt: Date;
  gateSatisfiedAt: Date | null;
  approvedAt: Date | null;
  joinedAt: Date | null;
  /** Provenance enregistrée par le bot (`source.provenance`, JSON brut). */
  provenance: unknown;
  /** Lien de la demande (null : sans lien suivi). */
  link: FunnelLink | null;
  /** Canaux de l'accueil (`source.gates`) et canaux restés sans lien (`source.gateLinksMissing`), JSON bruts. */
  gates: unknown;
  gateLinksMissing: unknown;
  /** Personne venue d'un canal obligatoire tombée sur la règle par défaut : aucun canal imposé (phase 11). */
  noGates: boolean;
  /** Mode des canaux à rejoindre : celui enregistré avec la demande, sinon celui de sa règle. */
  gateMode: string | null;
  /** Règle de la demande relue en base (anciennes demandes sans `source.gates`). */
  rule: { scope: RuleScope; gateChannelIds: unknown } | null;
  /** Accueil du bot de la demande envoyé. */
  welcomed: boolean;
  /** Vrai blocage du bot de la demande, après la demande. */
  blocked: boolean;
  /** Message du bot refusé sans blocage (jamais démarré, fenêtre de 5 minutes passée), après la demande. */
  refused: boolean;
};

/** Chiffres d'un parcours. */
export type FunnelCounts = {
  requests: number;
  welcomed: number;
  blocked: number;
  /** Personnes injoignables sans blocage (hors « ont bloqué le bot »). */
  unreachable: number;
  /** Demandes qui avaient des canaux à rejoindre (base des deux étapes « canaux »). */
  withGates: number;
  oneJoined: number;
  allJoined: number;
  accepted: number;
  left: number;
};

export const EMPTY_FUNNEL: Readonly<FunnelCounts> = Object.freeze({
  requests: 0,
  welcomed: 0,
  blocked: 0,
  unreachable: 0,
  withGates: 0,
  oneJoined: 0,
  allJoined: 0,
  accepted: 0,
  left: 0,
});

/** Nature d'une provenance (pub, un de nos canaux, lien, affilié, page d'atterrissage, autre). */
export type FunnelGroupKind =
  "ad" | "channel" | "share" | "link" | "affiliate" | "landing" | "other";

export type FunnelGroup = {
  key: string;
  label: string;
  kind: FunnelGroupKind;
  counts: FunnelCounts;
};

/** Parcours d'une période : le total et chaque provenance (données sérialisables, passées au composant). */
export type RequestFunnelData = {
  totals: FunnelCounts;
  groups: FunnelGroup[];
};

// ——— Règles pures ———

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Texte entre guillemets français, espaces insécables (jamais un guillemet seul en bout de ligne). */
function quoted(text: string): string {
  return `« ${text} »`;
}

/** Clé « membre dans ce canal » des canaux à rejoindre (`joined`). */
export function joinedKey(memberId: string, channelId: string): string {
  return `${memberId}:${channelId}`;
}

/** Statuts d'une demande ou d'une entrée qui comptent comme « canal rejoint » (comme « ✅ J'ai rejoint », plus les entrées reparties depuis). */
export const JOINED_GATE_STATUSES = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "APPROVED",
  "LEFT",
  "KICKED",
] as const;

/** Statuts d'une demande acceptée (avec `approvedAt` ou `joinedAt`, comme les statistiques par provenance). */
const ACCEPTED_STATUSES = new Set(["APPROVED", "LEFT", "KICKED"]);

/** Provenance de la demande : enregistrée par le bot, sinon déduite de son lien. */
export function requestProvenance(r: Pick<FunnelRequest, "provenance" | "link">): Provenance {
  return (
    provenanceFromJson(r.provenance) ?? (r.link ? provenanceOfLink(r.link) : UNKNOWN_PROVENANCE)
  );
}

function channelIdsOf(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(rec(x).channelId)).filter((x): x is string => !!x)
    : [];
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Canaux à rejoindre effectifs de la demande (obligatoires ou proposés) : ceux de son accueil (`source.gates` et les
 * canaux restés sans lien) ; pour une demande d'avant ces champs, ceux de sa règle sans le canal ni le canal d'origine
 * (`effectiveGateChannelIds`). Aucun pour une demande sans canaux, ou une personne à qui ils n'étaient pas imposés.
 */
export function requestGateChannelIds(
  r: Pick<
    FunnelRequest,
    | "channelId"
    | "gates"
    | "gateLinksMissing"
    | "noGates"
    | "gateMode"
    | "rule"
    | "provenance"
    | "link"
  >,
): string[] {
  if (r.noGates) return [];
  if (r.gateMode !== "REQUIRED" && r.gateMode !== "SOFT") return [];
  const unique = (ids: string[]) =>
    ids.filter((id, i, all) => id !== r.channelId && all.indexOf(id) === i);
  if (Array.isArray(r.gates) || Array.isArray(r.gateLinksMissing))
    return unique([...channelIdsOf(r.gates), ...channelIdsOf(r.gateLinksMissing)]);
  if (!r.rule) return [];
  return effectiveGateChannelIds(
    { scope: r.rule.scope, gateChannelIds: stringList(r.rule.gateChannelIds) },
    requestProvenance(r),
    r.channelId,
  ).gateChannelIds;
}

/** Ce qu'est devenue une demande, étape par étape. */
export type RequestOutcome = {
  welcomed: boolean;
  blocked: boolean;
  unreachable: boolean;
  hasGates: boolean;
  oneJoined: boolean;
  allJoined: boolean;
  accepted: boolean;
  left: boolean;
};

/** Étapes franchies par une demande ; `joined` : clés `joinedKey` des canaux rejoints d'après nos données. */
export function requestOutcome(r: FunnelRequest, joined: ReadonlySet<string>): RequestOutcome {
  const gates = requestGateChannelIds(r);
  const hasGates = gates.length > 0;
  const count = gates.filter((g) => joined.has(joinedKey(r.memberId, g))).length;
  const allJoined = hasGates && (r.gateSatisfiedAt !== null || count === gates.length);
  const accepted = r.approvedAt !== null || r.joinedAt !== null || ACCEPTED_STATUSES.has(r.status);
  return {
    welcomed: r.welcomed,
    blocked: r.blocked,
    unreachable: r.refused && !r.blocked,
    hasGates,
    oneJoined: hasGates && (allJoined || count > 0),
    allJoined,
    accepted,
    left: r.status === "LEFT",
  };
}

function add(c: FunnelCounts, o: RequestOutcome): void {
  c.requests++;
  if (o.welcomed) c.welcomed++;
  if (o.blocked) c.blocked++;
  if (o.unreachable) c.unreachable++;
  if (o.hasGates) c.withGates++;
  if (o.oneJoined) c.oneJoined++;
  if (o.allJoined) c.allJoined++;
  if (o.accepted) c.accepted++;
  if (o.left) c.left++;
}

/** Somme de plusieurs parcours (le total de plusieurs canaux). */
export function sumFunnels(list: readonly FunnelCounts[]): FunnelCounts {
  const out = { ...EMPTY_FUNNEL };
  for (const c of list)
    for (const k of Object.keys(out) as Array<keyof FunnelCounts>) out[k] += c[k];
  return out;
}

const PLATFORM_NAMES: Record<string, string> = { TIKTOK: "TikTok", META: "Meta" };

/**
 * Provenance d'une demande, regroupée pour le parcours : chaque pub (« Pub TikTok « Pub 1 » »), le bouton « canal à
 * rejoindre » de chacun de nos canaux, chaque lien de partage, chaque lien du canal, chaque affilié Link Affi, puis
 * « Autres liens » (lien que la plateforme n'a pas créé, lien principal du canal…). `titles` : titres actuels de nos
 * canaux (un canal supprimé garde le texte enregistré par le bot).
 */
export function provenanceGroupOf(
  r: Pick<FunnelRequest, "provenance" | "link">,
  titles: Readonly<Record<string, string>> = {},
): Omit<FunnelGroup, "counts"> {
  const p = requestProvenance(r);
  const linkName = r.link?.name ?? null;
  switch (p.type) {
    case "AD": {
      const platform = p.adPlatform ? PLATFORM_NAMES[p.adPlatform] : undefined;
      const base = platform ? `Pub ${platform}` : "Pub";
      const name = r.link?.adName ?? linkName;
      return {
        key: `ad:${p.inviteLinkId ?? p.adPlatform ?? "?"}`,
        label: name ? `${base} ${quoted(name)}` : base,
        kind: "ad",
      };
    }
    case "GATE": {
      const title = p.sourceChannelId ? titles[p.sourceChannelId] : undefined;
      return {
        key: `gate:${p.sourceChannelId ?? "?"}`,
        label: title
          ? `Bouton ${quoted("canal à rejoindre")} de ${quoted(title)}`
          : `Bouton ${quoted("canal à rejoindre")} d'un de nos canaux`,
        kind: "channel",
      };
    }
    case "SHARE":
      return {
        key: `share:${p.inviteLinkId ?? "?"}`,
        label: linkName ? `Lien de partage ${quoted(linkName)}` : "Lien de partage",
        kind: "share",
      };
    case "MANUAL":
      return {
        key: `link:${p.inviteLinkId ?? "?"}`,
        label: linkName ? `Lien ${quoted(linkName)}` : "Lien du canal",
        kind: "link",
      };
    case "LINKAFFI": {
      const who = p.linkaffi?.affiliateName;
      return {
        key: `affiliate:${p.linkaffi?.affiliateId ?? p.inviteLinkId ?? "?"}`,
        label: who ? `Affilié ${quoted(who)}` : "Affilié Link Affi",
        kind: "affiliate",
      };
    }
    case "LANDING": {
      // Une ligne par page, toutes sources (le détail par source est dans la rubrique Pages).
      const pageId = p.landing?.pageId ?? r.link?.landingPageId ?? null;
      const name = pageId ? r.link?.landingPageName : null;
      return {
        key: `landing:${pageId ?? "?"}`,
        label: name
          ? `Page ${quoted(name)}`
          : pageId
            ? "Page d'atterrissage"
            : "Page d'atterrissage supprimée",
        kind: "landing",
      };
    }
    default:
      return { key: "other", label: "Autres liens", kind: "other" };
  }
}

/**
 * Parcours des demandes : le total et chaque provenance, les plus nombreuses d'abord (« Autres liens » en dernier).
 */
export function buildRequestFunnel(
  rows: readonly FunnelRequest[],
  joined: ReadonlySet<string>,
  titles: Readonly<Record<string, string>> = {},
): RequestFunnelData {
  const totals = { ...EMPTY_FUNNEL };
  const groups = new Map<string, FunnelGroup>();
  for (const r of rows) {
    const o = requestOutcome(r, joined);
    add(totals, o);
    const g = provenanceGroupOf(r, titles);
    const group = groups.get(g.key) ?? { ...g, counts: { ...EMPTY_FUNNEL } };
    add(group.counts, o);
    groups.set(g.key, group);
  }
  return {
    totals,
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(a.key === "other") - Number(b.key === "other") ||
        b.counts.requests - a.counts.requests ||
        b.counts.blocked - a.counts.blocked ||
        a.label.localeCompare(b.label, "fr"),
    ),
  };
}

/** Demandes faites entre `start` (inclus) et `end` (exclu). */
export function requestsBetween<T extends Pick<FunnelRequest, "requestedAt">>(
  rows: readonly T[],
  start: Date,
  end: Date,
): T[] {
  return rows.filter(
    (r) => r.requestedAt.getTime() >= start.getTime() && r.requestedAt.getTime() < end.getTime(),
  );
}

// ——— Textes ———

export type FunnelStepKey =
  "requests" | "welcomed" | "blocked" | "oneJoined" | "allJoined" | "accepted" | "left";

/** Une étape du parcours, prête à afficher. */
export type FunnelStepView = {
  key: FunnelStepKey;
  label: string;
  value: number;
  /** Part sous la valeur (« 40 % des demandes »), ou null. */
  note: string | null;
  /** Une baisse est bonne (blocages, départs) : sens de la variation avec la période précédente. */
  favorable: "up" | "down";
  /** Précision au survol (jamais la seule source d'un chiffre). */
  hint?: string;
};

/** Infobulle de l'étape « Ont bloqué le bot » : vrai blocage seulement. */
export const BLOCKED_HINT = `Seulement les personnes qui ont vraiment bloqué le bot (Telegram nous le dit). Un message refusé parce que la personne n'a jamais appuyé sur ${quoted("Démarrer")} n'est pas un blocage.`;

function ofRequests(part: number, total: number): string | null {
  const s = share(part, total);
  return s ? `${s} des demandes` : null;
}

/**
 * Les étapes du parcours, dans l'ordre. Les deux étapes « canaux » ne sont montrées que s'il y avait des canaux à
 * rejoindre ; leur part se calcule sur ces demandes seulement (« 50 % des 12 demandes avec des canaux à rejoindre »).
 */
export function funnelSteps(c: FunnelCounts): FunnelStepView[] {
  const gateNote = (part: number): string | null => {
    const s = share(part, c.withGates);
    if (!s) return null;
    return c.withGates === c.requests
      ? `${s} des demandes`
      : `${s} des ${c.withGates.toLocaleString("fr-FR")} ${
          c.withGates > 1 ? "demandes" : "demande"
        } avec des canaux à rejoindre`;
  };
  const steps: FunnelStepView[] = [
    { key: "requests", label: "Demandes", value: c.requests, note: null, favorable: "up" },
    {
      key: "welcomed",
      label: "Accueil envoyé",
      value: c.welcomed,
      note: ofRequests(c.welcomed, c.requests),
      favorable: "up",
    },
    {
      key: "blocked",
      label: "Ont bloqué le bot",
      value: c.blocked,
      note: ofRequests(c.blocked, c.requests),
      favorable: "down",
      hint: BLOCKED_HINT,
    },
  ];
  if (c.withGates > 0)
    steps.push(
      {
        key: "oneJoined",
        label: "Au moins un canal rejoint",
        value: c.oneJoined,
        note: gateNote(c.oneJoined),
        favorable: "up",
      },
      {
        key: "allJoined",
        label: "Tous les canaux rejoints",
        value: c.allJoined,
        note: gateNote(c.allJoined),
        favorable: "up",
      },
    );
  const leftShare = share(c.left, c.accepted);
  steps.push(
    {
      key: "accepted",
      label: "Acceptées",
      value: c.accepted,
      note: ofRequests(c.accepted, c.requests),
      favorable: "up",
    },
    {
      key: "left",
      label: "Parties du canal",
      value: c.left,
      note: leftShare ? `${leftShare} des acceptées` : null,
      favorable: "down",
    },
  );
  return steps;
}

/** Au moins 10 demandes et plus de 25 % de vrais blocages : même seuil que l'alerte Telegram « bot bloqué ». */
export const BLOCKED_WARNING_MIN_REQUESTS = 10;
export const BLOCKED_WARNING_RATE = 0.25;

/** Au moins 10 demandes et plus de 25 % de vrais blocages (même règle que l'alerte Telegram « bot bloqué »). */
function overBlockedRate(c: FunnelCounts): boolean {
  return (
    c.requests >= BLOCKED_WARNING_MIN_REQUESTS && c.blocked / c.requests > BLOCKED_WARNING_RATE
  );
}

/** Réglage actuel des canaux : des canaux obligatoires sont-ils demandés aujourd'hui (règle par défaut ou exception) ? */
export type FunnelAdviceOptions = { requiredGates?: boolean };

/**
 * Avertissement en tête du parcours quand beaucoup de personnes bloquent le bot : sur l'ensemble des demandes, ou sur
 * une provenance d'au moins 10 demandes (une pub peut être la seule touchée), au même seuil que l'alerte Telegram.
 * Il nomme la provenance la plus touchée : « 40 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot (8
 * sur 20). Telegram peut limiter un bot signalé : adoucissez le message d'accueil ou passez les canaux en
 * « Proposés ». » Le conseil de passer en « Proposés » n'est donné que si des canaux obligatoires sont demandés
 * aujourd'hui (`requiredGates`, lu par `channelsWithRequiredGates`) : canaux déjà proposés, aucun canal à rejoindre ou
 * réglage inconnu → seulement « adoucissez le message d'accueil ». Null sous le seuil.
 */
export function blockedWarning(
  data: RequestFunnelData,
  opts: FunnelAdviceOptions = {},
): string | null {
  const byBlocked = (a: FunnelGroup, b: FunnelGroup) =>
    b.counts.blocked - a.counts.blocked ||
    b.counts.blocked / b.counts.requests - a.counts.blocked / a.counts.requests;
  const touched = data.groups.filter((g) => g.counts.requests > 0 && g.counts.blocked > 0);
  const over = touched.filter((g) => overBlockedRate(g.counts)).sort(byBlocked);
  if (over.length === 0 && !overBlockedRate(data.totals)) return null;
  const worst = data.groups.length > 1 ? (over[0] ?? [...touched].sort(byBlocked)[0]) : undefined;
  const g = worst ? worst.counts : data.totals;
  const who = worst ? `des personnes venues de ${worst.label}` : "des personnes";
  const advice = opts.requiredGates
    ? `adoucissez le message d'accueil ou passez les canaux en ${quoted("Proposés")}`
    : "adoucissez le message d'accueil";
  return `${share(g.blocked, g.requests)} ${who} ont bloqué le bot (${g.blocked.toLocaleString(
    "fr-FR",
  )} sur ${g.requests.toLocaleString("fr-FR")}). Telegram peut limiter un bot signalé : ${advice}.`;
}

/**
 * Personnes que le bot ne pouvait plus joindre sans qu'elles l'aient bloqué (décision E1), en une phrase ; null s'il
 * n'y en a aucune.
 */
export function unreachableNote(c: FunnelCounts): string | null {
  if (c.unreachable <= 0) return null;
  const n = c.unreachable.toLocaleString("fr-FR");
  return c.unreachable > 1
    ? `${n} personnes n'ont pas reçu un message du bot sans l'avoir bloqué : elles n'avaient jamais appuyé sur ${quoted("Démarrer")} et les 5 minutes après leur demande étaient passées. Ce n'est pas compté comme un blocage.`
    : `1 personne n'a pas reçu un message du bot sans l'avoir bloqué : elle n'avait jamais appuyé sur ${quoted("Démarrer")} et les 5 minutes après sa demande étaient passées. Ce n'est pas compté comme un blocage.`;
}

/** Une provenance en une ligne : « 20 demandes · 8 ont bloqué le bot (40 %) · 5 acceptées (25 %) ». */
export function groupSummary(c: FunnelCounts): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  const pct = (part: number) => {
    const s = share(part, c.requests);
    return s ? ` (${s})` : "";
  };
  return [
    `${n(c.requests)} ${c.requests > 1 ? "demandes" : "demande"}`,
    `${n(c.blocked)} ${c.blocked > 1 ? "ont" : "a"} bloqué le bot${pct(c.blocked)}`,
    `${n(c.accepted)} ${c.accepted > 1 ? "acceptées" : "acceptée"}${pct(c.accepted)}`,
  ].join(" · ");
}

// ——— Vue prête pour l'écran (données sérialisables pour le composant client) ———

/** Une étape à l'écran, avec la période précédente quand la comparaison est demandée. */
export type FunnelStepDisplay = FunnelStepView & {
  valueText: string;
  /** Valeur de la période précédente (« Avant : 12 »). */
  previousText?: string;
  /** Variation avec la période précédente (règle unique `comparableVariation`). */
  variation?: Variation;
};

/** Une provenance à l'écran : cellules du tableau (textes et valeurs de tri) et parcours détaillé du volet. */
export type FunnelGroupDisplay = {
  key: string;
  label: string;
  kind: FunnelGroupKind;
  cells: { requests: string; blocked: string; allJoined: string; accepted: string };
  sort: { requests: number; blocked: number; allJoined: number; accepted: number };
  summary: string;
  steps: FunnelStepDisplay[];
  unreachable: string | null;
};

export type FunnelView = {
  /** Aucune demande sur la période. */
  empty: boolean;
  steps: FunnelStepDisplay[];
  warning: string | null;
  unreachable: string | null;
  groups: FunnelGroupDisplay[];
};

function displaySteps(c: FunnelCounts, previous?: FunnelCounts | null): FunnelStepDisplay[] {
  return funnelSteps(c).map((s) => ({
    ...s,
    valueText: s.value.toLocaleString("fr-FR"),
    ...(previous
      ? {
          previousText: previous[s.key].toLocaleString("fr-FR"),
          variation: comparableVariation(s.value, previous[s.key]),
        }
      : {}),
  }));
}

/** « 4 (40 %) », « 0 » : un nombre et sa part des demandes de la ligne. */
function countWithShare(part: number, total: number): string {
  const s = part > 0 ? share(part, total) : null;
  return s ? `${part.toLocaleString("fr-FR")} (${s})` : part.toLocaleString("fr-FR");
}

/**
 * Vue du parcours : étapes (avec la période précédente si `previous`), avertissement « bot bloqué » (conseil selon le
 * réglage actuel des canaux, `opts.requiredGates`), personnes injoignables sans blocage, et une ligne par provenance
 * (tableau de 5 colonnes au plus, détail au clic).
 */
export function funnelView(
  data: RequestFunnelData,
  previous?: FunnelCounts | null,
  opts: FunnelAdviceOptions = {},
): FunnelView {
  return {
    empty: data.totals.requests === 0,
    steps: displaySteps(data.totals, previous),
    warning: blockedWarning(data, opts),
    unreachable: unreachableNote(data.totals),
    groups: data.groups.map((g) => ({
      key: g.key,
      label: g.label,
      kind: g.kind,
      cells: {
        requests: g.counts.requests.toLocaleString("fr-FR"),
        blocked: countWithShare(g.counts.blocked, g.counts.requests),
        allJoined:
          g.counts.withGates > 0
            ? `${g.counts.allJoined.toLocaleString("fr-FR")} sur ${g.counts.withGates.toLocaleString("fr-FR")}`
            : "—",
        accepted: countWithShare(g.counts.accepted, g.counts.requests),
      },
      sort: {
        requests: g.counts.requests,
        blocked: g.counts.blocked,
        allJoined: g.counts.withGates > 0 ? g.counts.allJoined : -1,
        accepted: g.counts.accepted,
      },
      summary: groupSummary(g.counts),
      steps: displaySteps(g.counts),
      unreachable: unreachableNote(g.counts),
    })),
  };
}

// ——— Périodes de la fiche canal ———

/** Périodes du parcours dans l'onglet « Demandes » (périodes communes du site, jours de Paris). */
export const REQUEST_FUNNEL_PERIODS: readonly PeriodKey[] = ["today", "7d", "30d"];
/** Période montrée d'abord. */
export const REQUEST_FUNNEL_DEFAULT: PeriodKey = "7d";

/** Parcours d'une période : clé, libellé et chiffres. */
export type FunnelPeriodData = { key: PeriodKey; label: string; data: RequestFunnelData };
/** Parcours d'une période prêt pour le composant (sérialisable). */
export type FunnelPeriodView = { key: string; label: string; view: FunnelView };

// ——— Lecture en base ———

/** Demandes lues au plus par parcours (les plus récentes). */
export const FUNNEL_MAX_REQUESTS = 20_000;

type RawRow = {
  id: string;
  memberId: string;
  channelId: string;
  status: string;
  requestedAt: Date;
  gateSatisfiedAt: Date | null;
  approvedAt: Date | null;
  joinedAt: Date | null;
  provenance: unknown;
  gates: unknown;
  gateLinksMissing: unknown;
  noGates: boolean;
  gateMode: string | null;
  ruleScope: string | null;
  ruleGateChannelIds: unknown;
  linkId: string | null;
  linkKind: string | null;
  linkSourceChannelId: string | null;
  linkAdPlatform: string | null;
  linkName: string | null;
  adName: string | null;
  linkaffiCampaignKey: string | null;
  linkaffiCampaignName: string | null;
  linkaffiAffiliateId: string | null;
  linkaffiAffiliateName: string | null;
  /** Lien LANDING (phase 15) : page, source et nom actuel de la page. */
  landingPageId?: string | null;
  landingSource?: string | null;
  landingPageName?: string | null;
  welcomed: boolean;
  blocked: boolean;
  refused: boolean;
};

/** Ligne de la base → demande du parcours (pure, testée). */
export function funnelRequestFromRow(row: RawRow): FunnelRequest {
  const link: FunnelLink | null =
    row.linkId && row.linkKind
      ? {
          id: row.linkId,
          kind: row.linkKind as ProvenanceLink["kind"],
          sourceChannelId: row.linkSourceChannelId,
          adPlatform: row.linkAdPlatform,
          name: row.linkName ?? "",
          adName: row.adName,
          linkaffiCampaignKey: row.linkaffiCampaignKey,
          linkaffiCampaignName: row.linkaffiCampaignName,
          linkaffiAffiliateId: row.linkaffiAffiliateId,
          linkaffiAffiliateName: row.linkaffiAffiliateName,
          landingPageId: row.landingPageId ?? null,
          landingSource: row.landingSource ?? null,
          landingPageName: row.landingPageName ?? null,
        }
      : null;
  return {
    id: row.id,
    memberId: row.memberId,
    channelId: row.channelId,
    status: row.status,
    requestedAt: row.requestedAt,
    gateSatisfiedAt: row.gateSatisfiedAt,
    approvedAt: row.approvedAt,
    joinedAt: row.joinedAt,
    provenance: row.provenance,
    link,
    gates: row.gates,
    gateLinksMissing: row.gateLinksMissing,
    noGates: row.noGates,
    gateMode: row.gateMode,
    rule: row.ruleScope
      ? { scope: row.ruleScope as RuleScope, gateChannelIds: row.ruleGateChannelIds }
      : null,
    welcomed: row.welcomed,
    blocked: row.blocked,
    refused: row.refused,
  };
}

/** Demandes lues, canaux à rejoindre rejoints et titres des canaux d'origine. */
export type FunnelSource = {
  rows: FunnelRequest[];
  joined: Set<string>;
  titles: Record<string, string>;
  /** Plus de demandes que `FUNNEL_MAX_REQUESTS` : seules les plus récentes sont comptées. */
  truncated: boolean;
};

/**
 * Lit les demandes faites entre `from` (inclus) et `to` (exclu), sur les canaux `channelIds` (null : tous). Une seule
 * requête : l'accueil envoyé, le vrai blocage et le refus sans blocage sont calculés en base (index `memberId` des
 * messages privés et des événements), avec le lien, sa pub et la règle. Puis les demandes et entrées des mêmes
 * personnes dans leurs canaux à rejoindre, et les titres des canaux d'origine.
 */
export async function loadFunnelRequests(input: {
  channelIds: readonly string[] | null;
  from: Date;
  to: Date;
}): Promise<FunnelSource> {
  if (input.channelIds && input.channelIds.length === 0)
    return { rows: [], joined: new Set(), titles: {}, truncated: false };
  const channelFilter = input.channelIds
    ? Prisma.sql`AND m."channelId" = ANY(${[...input.channelIds]}::text[])`
    : Prisma.empty;
  // Bot de la demande (celui qui écrit à la personne) ; ancienne demande sans bot enregistré : n'importe lequel.
  const sameBot = (alias: string) =>
    Prisma.sql`(m."source"->>'botId' IS NULL OR ${Prisma.raw(alias)}."botId" = m."source"->>'botId')`;
  const raw = await prisma.$queryRaw<RawRow[]>`
    SELECT m."id", m."memberId", m."channelId", m."status"::text AS "status", m."requestedAt",
      m."gateSatisfiedAt", m."approvedAt", m."joinedAt",
      m."source"->'provenance' AS "provenance",
      m."source"->'gates' AS "gates",
      m."source"->'gateLinksMissing' AS "gateLinksMissing",
      COALESCE(m."source"->'appliedRule'->>'noGates', 'false') = 'true' AS "noGates",
      COALESCE(m."source"->'rule'->>'gateMode', r."gateMode"::text) AS "gateMode",
      r."scope"::text AS "ruleScope", r."gateChannelIds" AS "ruleGateChannelIds",
      l."id" AS "linkId", l."kind"::text AS "linkKind", l."sourceChannelId" AS "linkSourceChannelId",
      l."adPlatform"::text AS "linkAdPlatform",
      COALESCE(l."name", m."source"->'inviteLink'->>'name') AS "linkName",
      COALESCE(a."name", l."adName", m."source"->'inviteLink'->>'adName') AS "adName",
      l."linkaffiCampaignKey", l."linkaffiCampaignName", l."linkaffiAffiliateId", l."linkaffiAffiliateName",
      l."landingPageId", l."landingSource", lp."name" AS "landingPageName",
      EXISTS (
        SELECT 1 FROM "OutboundMessage" o
        WHERE o."memberId" = m."memberId" AND o."kind" = 'WELCOME' AND o."status" = 'SENT'
          AND o."queuedAt" >= m."requestedAt" - interval '1 minute'
          AND o."queuedAt" <= m."requestedAt" + interval '10 minutes'
          AND ${sameBot("o")}
      ) AS "welcomed",
      EXISTS (
        SELECT 1 FROM "Event" e
        WHERE e."memberId" = m."memberId" AND e."occurredAt" >= m."requestedAt" AND ${sameBot("e")}
          AND (e."type" = 'member.blocked'
            OR (e."type" = 'dm.blocked' AND e."payload"->>'telegramError' ILIKE '%blocked by the user%'))
      ) AS "blocked",
      EXISTS (
        SELECT 1 FROM "Event" e
        WHERE e."memberId" = m."memberId" AND e."occurredAt" >= m."requestedAt" AND ${sameBot("e")}
          AND (e."type" = 'dm.unreachable'
            OR (e."type" = 'dm.blocked' AND (e."payload"->>'telegramError') IS NULL))
      ) AS "refused"
    FROM "Membership" m
    LEFT JOIN "ApprovalRule" r ON r."id" = m."approvalRuleId"
    LEFT JOIN "InviteLink" l ON l."id" = m."inviteLinkId"
    LEFT JOIN "Ad" a ON a."inviteLinkId" = l."id"
    LEFT JOIN "LandingPage" lp ON lp."id" = l."landingPageId"
    WHERE m."requestedAt" >= ${input.from} AND m."requestedAt" < ${input.to}
      AND m."source"->>'joinedDirectly' IS DISTINCT FROM 'true'
      ${channelFilter}
    ORDER BY m."requestedAt" DESC
    LIMIT ${FUNNEL_MAX_REQUESTS}`;
  const rows = raw.map(funnelRequestFromRow);

  // Canaux à rejoindre : demandes et entrées des mêmes personnes dans ces canaux (nos données).
  const needs = rows.filter((r) => r.gateSatisfiedAt === null);
  const gateIds = [...new Set(needs.flatMap((r) => requestGateChannelIds(r)))];
  const memberIds = [
    ...new Set(needs.filter((r) => requestGateChannelIds(r).length > 0).map((r) => r.memberId)),
  ];
  const joined = new Set<string>();
  for (let i = 0; i < memberIds.length && gateIds.length > 0; i += 2000) {
    const found = await prisma.membership.findMany({
      where: {
        memberId: { in: memberIds.slice(i, i + 2000) },
        channelId: { in: gateIds },
        OR: [{ status: { in: [...JOINED_GATE_STATUSES] } }, { joinedAt: { not: null } }],
      },
      select: { memberId: true, channelId: true },
    });
    for (const f of found) joined.add(joinedKey(f.memberId, f.channelId));
  }

  // Titres des canaux d'origine (bouton « canal à rejoindre »).
  const sourceIds = [
    ...new Set(
      rows
        .map((r) => requestProvenance(r))
        .filter((p) => p.type === "GATE" && p.sourceChannelId)
        .map((p) => p.sourceChannelId!),
    ),
  ];
  const titles = sourceIds.length
    ? Object.fromEntries(
        (
          await prisma.channel.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, title: true },
          })
        ).map((c) => [c.id, c.title]),
      )
    : {};
  return { rows, joined, titles, truncated: raw.length >= FUNNEL_MAX_REQUESTS };
}

/**
 * Des canaux obligatoires sont-ils demandés aujourd'hui sur ces canaux ? Règle par défaut ou exception active, canaux
 * « Obligatoires » avec au moins un canal à rejoindre autre que le canal lui-même. Sert au conseil de l'avertissement
 * « bot bloqué » (passer les canaux en « Proposés » n'a de sens que s'ils sont obligatoires).
 */
export async function channelsWithRequiredGates(channelIds: readonly string[]): Promise<boolean> {
  if (channelIds.length === 0) return false;
  const rules = await prisma.approvalRule.findMany({
    where: { channelId: { in: [...channelIds] }, isActive: true, gateMode: "REQUIRED" },
    select: { channelId: true, gateChannelIds: true },
  });
  return rules.some((r) => stringList(r.gateChannelIds).some((id) => id && id !== r.channelId));
}

/** Parcours d'une période depuis des demandes déjà lues. */
export function funnelOfPeriod(src: FunnelSource, period: Period): RequestFunnelData {
  return buildRequestFunnel(
    requestsBetween(src.rows, periodStart(period), periodEnd(period)),
    src.joined,
    src.titles,
  );
}

/**
 * Parcours de l'onglet « Demandes » d'un canal : aujourd'hui, 7 et 30 derniers jours (jours de Paris), lus en une fois
 * (30 jours) puis découpés.
 */
export async function loadChannelRequestFunnels(
  channelId: string,
  now: Date = new Date(),
): Promise<FunnelPeriodData[]> {
  const periods = REQUEST_FUNNEL_PERIODS.map((key) => resolvePeriod({ range: key }, now));
  const from = new Date(Math.min(...periods.map((p) => periodStart(p).getTime())));
  const to = new Date(Math.max(...periods.map((p) => periodEnd(p).getTime())));
  const src = await loadFunnelRequests({ channelIds: [channelId], from, to });
  return periods.map((p) => ({
    key: p.key,
    label: PERIOD_LABELS[p.key],
    data: funnelOfPeriod(src, p),
  }));
}

/**
 * Parcours des Statistiques → Canaux : la période choisie sur les canaux affichés, et le total de la période précédente
 * de même longueur si la comparaison est demandée (lus en une fois).
 */
export async function loadStatsRequestFunnel(input: {
  channelIds: readonly string[];
  period: Period;
  compare: boolean;
}): Promise<{
  data: RequestFunnelData;
  previous: FunnelCounts | null;
  /** Des canaux obligatoires sont demandés aujourd'hui sur les canaux affichés (conseil de l'avertissement). */
  requiredGates: boolean;
}> {
  const prev = input.compare ? previousPeriod(input.period) : null;
  const [src, requiredGates] = await Promise.all([
    loadFunnelRequests({
      channelIds: input.channelIds,
      from: periodStart(prev ?? input.period),
      to: periodEnd(input.period),
    }),
    channelsWithRequiredGates(input.channelIds),
  ]);
  return {
    data: funnelOfPeriod(src, input.period),
    previous: prev ? funnelOfPeriod(src, prev).totals : null,
    requiredGates,
  };
}
