/**
 * Phase 32 — pages avancées de la Prospection (alertes, réseaux, valeur, affiliés signés, sources étendues, fiche) :
 * libellés français et lecture tolérante des colonnes JSON écrites par les chantiers A et B (`ProspectAlert.data`,
 * `Prospect.valueEstimate`, `ProspectNetwork.evidence`, `Recommendation` de calibrage, compteurs de la recherche par
 * compte). Règles pures, sans Prisma ni `next/*`.
 * Règle 3 de la phase : une valeur en euros est TOUJOURS une fourchette (basse – haute, probable) avec sa confiance et
 * ses hypothèses ; jamais un chiffre seul, jamais « rapportera ».
 */
import {
  ACCOUNT_SEARCH,
  ALERT_FAMILY_ORDER,
  CALIBRATION_BOUNDS,
  NETWORK_LINK_POINTS,
  type NetworkLinkKind,
  type ProspectAlertFamily,
  type ProspectAlertKind,
  type ProspectAlertStatus,
  type ValueEstimate,
} from "@linkaffipro/agents";
import { countryName } from "@/lib/agents/analyses";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { CONTENT_TYPE_LABELS, FAKE_FLAG_LABELS, PROSPECTION_PATH, VERTICAL_LABELS } from "./display";

export const ALERTS_PATH = `${PROSPECTION_PATH}/alertes`;
export const NETWORKS_PATH = `${PROSPECTION_PATH}/reseaux`;
export const VALUE_PATH = `${PROSPECTION_PATH}/valeur`;
export const AFFILIATES_PATH = `${PROSPECTION_PATH}/affilies`;
export const SOURCES_PATH = `${PROSPECTION_PATH}/sources`;

/** Types d'alerte coupés par le client (« Couper ce type ») : `string[]` de `ProspectAlertKind`, lu par le Veilleur. */
export const MUTED_KINDS_KEY = "prospection.alerts.muted_kinds";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// ------------------------------------------------------------------------------------------------- alertes

export const ALERT_KINDS: readonly ProspectAlertKind[] = [
  "AFFILIATE_DROPPED",
  "GROWTH_SPIKE",
  "NEW_AFFILIATE",
  "AFFILIATE_SWITCHED",
  "STARTED_SELLING_ADS",
  "MARKETPLACE_LISTED",
  "CONTACT_CHANGED",
  "WENT_SILENT",
  "DECLINE",
  "TIER_UP",
  "TIER_DOWN",
  "AFFILIATE_NOT_POSTING",
  "AFFILIATE_PUSHES_COMPETITOR",
  "AFFILIATE_RISKY_CLAIM",
  "AFFILIATE_SILENT",
];

export const ALERT_KIND_LABELS: Record<ProspectAlertKind, string> = {
  AFFILIATE_DROPPED: "A lâché une marque",
  NEW_AFFILIATE: "Nouvelle marque",
  AFFILIATE_SWITCHED: "A changé de marque",
  GROWTH_SPIKE: "En forte hausse",
  DECLINE: "En baisse",
  WENT_SILENT: "Ne publie plus",
  STARTED_SELLING_ADS: "Vend de la pub",
  MARKETPLACE_LISTED: "Sur une place de marché",
  CONTACT_CHANGED: "Contact changé",
  TIER_UP: "Niveau en hausse",
  TIER_DOWN: "Niveau en baisse",
  AFFILIATE_NOT_POSTING: "Affilié qui ne poste pas nos liens",
  AFFILIATE_PUSHES_COMPETITOR: "Affilié qui pousse un concurrent",
  AFFILIATE_RISKY_CLAIM: "Affilié : phrase à risque",
  AFFILIATE_SILENT: "Affilié qui ne publie plus",
};

/** Ce que l'alerte veut dire pour le client (une phrase). */
export const ALERT_KIND_HINTS: Record<ProspectAlertKind, string> = {
  AFFILIATE_DROPPED: "Une marque qu'il poussait a disparu de ses posts depuis au moins 14 jours : il cherche peut-être une offre.",
  NEW_AFFILIATE: "Une nouvelle marque est apparue : il vient peut-être de signer ailleurs, ou il est ouvert aux offres.",
  AFFILIATE_SWITCHED: "Il a remplacé une marque par une autre.",
  GROWTH_SPIKE: "Abonnés ou vues en forte hausse sur 30 jours : un accord coûte peut-être moins cher maintenant.",
  DECLINE: "Ses vues ont baissé d'au moins 30 % sur 30 jours.",
  WENT_SILENT: "Plus aucun post depuis 21 jours.",
  STARTED_SELLING_ADS: "Il propose maintenant de la pub.",
  MARKETPLACE_LISTED: "Il est apparu sur une place de marché de la pub.",
  CONTACT_CHANGED: "Son contact public a changé ou a disparu.",
  TIER_UP: "Sa note a monté d'un niveau.",
  TIER_DOWN: "Sa note a baissé d'un niveau.",
  AFFILIATE_NOT_POSTING: "Signé depuis au moins 14 jours, et aucun de nos liens dans ses derniers posts.",
  AFFILIATE_PUSHES_COMPETITOR: "Il pousse aussi une marque concurrente.",
  AFFILIATE_RISKY_CLAIM: "Une phrase de ses posts peut poser problème (gains garantis, mineurs, promesses).",
  AFFILIATE_SILENT: "Un affilié signé qui ne publie plus.",
};

export const ALERT_FAMILY_LABELS: Record<ProspectAlertFamily, string> = {
  opportunity: "Opportunités",
  affiliate: "Affiliés signés",
  pipeline: "En cours avec vous",
  info: "Informations",
};
export const ALERT_FAMILIES = ALERT_FAMILY_ORDER;

export const ALERT_STATUSES: readonly ProspectAlertStatus[] = ["NEW", "SENT", "SEEN", "MUTED"];

export function isAlertKind(v: unknown): v is ProspectAlertKind {
  return typeof v === "string" && (ALERT_KINDS as readonly string[]).includes(v);
}
export function isAlertStatus(v: unknown): v is ProspectAlertStatus {
  return typeof v === "string" && (ALERT_STATUSES as readonly string[]).includes(v);
}
export function isAlertFamily(v: unknown): v is ProspectAlertFamily {
  return typeof v === "string" && (ALERT_FAMILY_ORDER as readonly string[]).includes(v);
}

export function alertKindLabel(kind: string): string {
  return isAlertKind(kind) ? ALERT_KIND_LABELS[kind] : "Alerte";
}

/** Types d'alerte coupés (`Setting prospection.alerts.muted_kinds`), sans doublon ni valeur inconnue. */
export function mutedKindsOf(v: unknown): ProspectAlertKind[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isAlertKind))];
}

export type AlertFilters = { kind: ProspectAlertKind | null; status: ProspectAlertStatus | "open" | null; family: ProspectAlertFamily | null };

const first = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
};

/** Filtres de l'adresse (`?type=GROWTH_SPIKE&statut=open&famille=opportunity`). Par défaut : les alertes à voir. */
export function parseAlertFilters(sp: Record<string, string | string[] | undefined>): AlertFilters {
  const kind = first(sp.type);
  const status = first(sp.statut);
  const family = first(sp.famille);
  return {
    kind: isAlertKind(kind) ? kind : null,
    status: status === "tous" ? null : isAlertStatus(status) ? status : "open",
    family: isAlertFamily(family) ? family : null,
  };
}

/** Statuts Prisma d'un filtre (« open » = nouvelles et envoyées par Kevin, pas encore vues). */
export function alertStatusesOf(f: Pick<AlertFilters, "status">): ProspectAlertStatus[] | null {
  if (f.status === "open") return ["NEW", "SENT"];
  return f.status ? [f.status] : null;
}

export function alertFilterParams(f: AlertFilters): Record<string, string> {
  const o: Record<string, string> = {};
  if (f.kind) o.type = f.kind;
  if (f.status !== "open") o.statut = f.status ?? "tous";
  if (f.family) o.famille = f.family;
  return o;
}

export function alertsHref(params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return q ? `${ALERTS_PATH}?${q}` : ALERTS_PATH;
}

/** Libellés des chiffres mesurés par le code (`ProspectAlert.data`) ; une clé inconnue n'est pas affichée. */
const FACT_LABELS: Record<string, string> = {
  brand: "Marque",
  brandBefore: "Marque d'avant",
  brandAfter: "Nouvelle marque",
  competitor: "Concurrent",
  days: "Depuis (jours)",
  daysSince: "Depuis (jours)",
  absentDays: "Absente depuis (jours)",
  silentDays: "Sans post depuis (jours)",
  signedDays: "Signé depuis (jours)",
  subscribersBefore: "Abonnés avant",
  subscribersAfter: "Abonnés maintenant",
  subsBefore: "Abonnés avant",
  subsAfter: "Abonnés maintenant",
  viewsBefore: "Vues par post avant",
  viewsAfter: "Vues par post maintenant",
  medianViewsBefore: "Vues par post avant",
  medianViewsAfter: "Vues par post maintenant",
  subsPct: "Évolution des abonnés",
  subscribersPct: "Évolution des abonnés",
  viewsPct: "Évolution des vues",
  pct: "Évolution",
  tierBefore: "Niveau avant",
  tierAfter: "Niveau maintenant",
  contactBefore: "Ancien contact",
  contactAfter: "Nouveau contact",
  ourLinks: "Nos liens vus",
  ourLinksCount: "Nos liens vus",
  posts: "Posts relus",
};

/** Chiffres d'une alerte en lignes lisibles (« Abonnés avant : 4 000 »). */
export function alertFacts(data: unknown): Array<{ label: string; value: string }> {
  if (!isObj(data)) return [];
  const out: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(data)) {
    const label = FACT_LABELS[k];
    if (!label || seen.has(label)) continue;
    let value: string | null = null;
    if (typeof v === "number" && Number.isFinite(v)) value = /pct$/i.test(k) ? `${v > 0 ? "+" : ""}${fmtPct(v, 0)}` : fmtNum(Math.round(v * 100) / 100);
    else if (typeof v === "string" && v.trim()) value = v.trim().slice(0, 80);
    if (value === null) continue;
    seen.add(label);
    out.push({ label, value });
  }
  return out;
}

/** Preuve affichée : 15 mots au plus (règle 7), jamais plus, même si la base en contient davantage. */
export function evidenceText(v: unknown, maxWords = 15): string | null {
  const s = txt(v);
  if (!s) return null;
  const words = s.split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : s;
}

// ------------------------------------------------------------------------------------------------- réseaux

export const NETWORK_LINK_LABELS: Record<NetworkLinkKind, string> = {
  same_contact: "Même contact",
  same_signature: "Même signature d'auteur",
  same_linked_group: "Même groupe de discussion",
  same_site: "Même site ou même page de liens",
  cross_forwards: "Se reprennent l'un l'autre",
  same_description: "Description presque identique",
  same_promo_code: "Même code promo",
};

export type NetworkEvidenceView = { a: string; b: string; label: string; points: number; detail: string | null };

export function networkEvidenceOf(v: unknown): NetworkEvidenceView[] {
  if (!Array.isArray(v)) return [];
  const out: NetworkEvidenceView[] = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    const kind = typeof e.kind === "string" && e.kind in NETWORK_LINK_POINTS ? (e.kind as NetworkLinkKind) : null;
    const a = txt(e.a);
    const b = txt(e.b);
    if (!a || !b) continue;
    out.push({
      a,
      b,
      label: kind ? NETWORK_LINK_LABELS[kind] : "Autre point commun",
      points: num(e.points) ?? (kind ? NETWORK_LINK_POINTS[kind] : 0),
      detail: txt(e.detail)?.slice(0, 120) ?? null,
    });
  }
  return out.sort((x, y) => y.points - x.points);
}

export function networkOriginLabel(origin: string): string {
  return origin === "MANUAL" ? "Regroupé par vous" : "Regroupé par l'équipe";
}

// ------------------------------------------------------------------------------------------------- valeur

/** `Prospect.valueEstimate` lu avec tolérance ; null si la fourchette est incomplète ou incohérente. */
export function parseValueEstimate(v: unknown): ValueEstimate | null {
  if (!isObj(v)) return null;
  const low = num(v.low);
  const base = num(v.base);
  const high = num(v.high);
  if (low === null || base === null || high === null || low < 0 || low > base || base > high) return null;
  const a = isObj(v.assumptions) ? v.assumptions : {};
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const conf = v.confidence === "high" || v.confidence === "medium" ? v.confidence : "low";
  return {
    low,
    base,
    high,
    currency: "EUR",
    assumptions: {
      promoReach: num(a.promoReach) ?? 0,
      promoShare: num(a.promoShare) ?? 0,
      ctr: num(a.ctr) ?? 0,
      regRate: num(a.regRate) ?? 0,
      ftdRate: num(a.ftdRate) ?? 0,
      cpa: num(a.cpa),
      revsharePct: num(a.revsharePct),
      arpuMonth: num(a.arpuMonth),
      reductions: list(a.reductions),
      missing: list(a.missing),
    },
    calibratedBy: txt(v.calibratedBy) ?? "default",
    confidence: conf,
    computedAt: txt(v.computedAt) ?? "",
    offerId: txt(v.offerId),
  };
}

const eur = (n: number) => fmtMoney(Math.round(n), "EUR", { digits: 0 });

/** « 120 € – 660 € par mois, probable 300 € » : toujours la fourchette, jamais la valeur probable seule. */
export function valueRangeText(e: Pick<ValueEstimate, "low" | "base" | "high">): string {
  return `${eur(e.low)} – ${eur(e.high)} par mois, probable ${eur(e.base)}`;
}

/** Fourchette courte (tableaux) : « 120 € – 660 € ». */
export function valueRangeShort(e: Pick<ValueEstimate, "low" | "high">): string {
  return `${eur(e.low)} – ${eur(e.high)}`;
}

export const CONFIDENCE_LABELS: Record<ValueEstimate["confidence"], string> = {
  low: "Confiance faible",
  medium: "Confiance moyenne",
  high: "Bonne confiance",
};

export function isCalibrated(e: Pick<ValueEstimate, "calibratedBy">): boolean {
  return Boolean(e.calibratedBy) && e.calibratedBy !== "default";
}

/** « Estimation non calibrée » tant qu'aucun vrai résultat d'affilié n'a corrigé les taux de ce type de canal. */
export function calibrationNote(e: Pick<ValueEstimate, "calibratedBy">): string {
  return isCalibrated(e) ? `Estimation corrigée par les vrais résultats (${segmentLabel(e.calibratedBy)})` : "Estimation non calibrée";
}

const REDUCTION_LABELS: Record<string, string> = {
  SUSPECT_GENERIC: "Contenu générique (fourchette × 0,6)",
  ...Object.fromEntries(Object.entries(FAKE_FLAG_LABELS).map(([k, v]) => [k, `${v} (fourchette × 0,8)`])),
};

const MISSING_LABELS: Record<string, string> = {
  arpu_month: "Part du revenu non comptée : le revenu moyen par joueur et par mois n'est pas encore donné (Kevin vous le demandera).",
  arpuMonth: "Part du revenu non comptée : le revenu moyen par joueur et par mois n'est pas encore donné (Kevin vous le demandera).",
  offer: "Aucune offre correspondante : valeur calculée sans montant.",
  promo_share: "Part de posts promotionnels non observée : valeur par défaut utilisée.",
};

/** Hypothèses visibles de l'estimation (taux, montants, réductions, ce qui manque). */
export function assumptionLines(e: ValueEstimate): string[] {
  const a = e.assumptions;
  const lines = [
    `Lecteurs des posts promotionnels : environ ${fmtNum(Math.round(a.promoReach))} vues par mois`,
    `Part des posts promotionnels : ${fmtPct(a.promoShare, 0)}`,
    `Lecteurs qui cliquent : ${fmtPct(a.ctr, 2)}`,
    `Clics qui s'inscrivent : ${fmtPct(a.regRate, 1)}`,
    `Inscrits qui font un premier dépôt : ${fmtPct(a.ftdRate, 1)}`,
  ];
  if (a.cpa !== null) lines.push(`Prime par joueur : ${eur(a.cpa)}`);
  if (a.revsharePct !== null) lines.push(`Part du revenu : ${fmtPct(a.revsharePct > 1 ? a.revsharePct / 100 : a.revsharePct, 0)}`);
  if (a.arpuMonth !== null) lines.push(`Revenu moyen par joueur et par mois : ${eur(a.arpuMonth)}`);
  for (const r of a.reductions) lines.push(REDUCTION_LABELS[r] ?? `Réduction : ${r.toLowerCase().replace(/_/g, " ")}`);
  for (const m of a.missing) lines.push(MISSING_LABELS[m] ?? `Donnée manquante : ${m.toLowerCase().replace(/_/g, " ")}`);
  return lines;
}

/** Statuts du pipeline dont la valeur est cumulée (de « à contacter » à « actif »). */
export const VALUE_STATUSES = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE"] as const;

export type PipelineValueRow = { status: string; count: number; estimated: number; low: number; base: number; high: number; uncalibrated: number };

/** Valeur du pipeline par statut (somme des fourchettes ; les canaux sans estimation sont comptés à part). */
export function pipelineValue(rows: ReadonlyArray<{ status: string; valueEstimate: unknown }>): PipelineValueRow[] {
  const by = new Map<string, PipelineValueRow>();
  for (const s of VALUE_STATUSES) by.set(s, { status: s, count: 0, estimated: 0, low: 0, base: 0, high: 0, uncalibrated: 0 });
  for (const r of rows) {
    const row = by.get(r.status);
    if (!row) continue;
    row.count++;
    const e = parseValueEstimate(r.valueEstimate);
    if (!e) continue;
    row.estimated++;
    row.low += e.low;
    row.base += e.base;
    row.high += e.high;
    if (!isCalibrated(e)) row.uncalibrated++;
  }
  return [...by.values()];
}

// ------------------------------------------------------------------------------------------------- calibrage

/** « SPORTS|FR|tips_free|A » → « Paris sportifs · France · Pronostics gratuits · niveau A ». */
export function segmentLabel(key: string): string {
  const [v, c, t, tier] = key.split("|");
  if (!v || c === undefined) return key;
  const parts = [VERTICAL_LABELS[v] ?? v, c && c !== "?" ? countryName(c) : "Pays inconnu"];
  if (t && t !== "?") parts.push(CONTENT_TYPE_LABELS[t] ?? t);
  if (tier && tier !== "?") parts.push(`niveau ${tier}`);
  return parts.join(" · ");
}

const FIELD_LABELS: Record<string, string> = {
  ctrFactor: "Coefficient des clics",
  ctr_factor: "Coefficient des clics",
  ftdFactor: "Coefficient des premiers dépôts",
  ftd_factor: "Coefficient des premiers dépôts",
  audience: "Poids de la note : audience",
  engagement: "Poids de la note : réactions des lecteurs",
  fit: "Poids de la note : adéquation avec vos offres",
  openness: "Poids de la note : ouverture aux partenariats",
  competition: "Poids de la note : concurrence",
  reach: "Poids de la note : facilité à joindre",
  discoveryBudget: "Répartition des recherches entre les sources",
  discovery_budget: "Répartition des recherches entre les sources",
};

export function calibrationFieldLabel(field: string): string {
  const last = field.split(/[.:]/).pop() ?? field;
  return FIELD_LABELS[field] ?? FIELD_LABELS[last] ?? "Réglage de l'équipe";
}

function valueText(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v) < 10 ? `× ${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}` : fmtNum(v);
  if (typeof v === "string") return v.slice(0, 60);
  if (isObj(v)) {
    const nums = Object.entries(v).filter(([, x]) => typeof x === "number");
    if (nums.length) return nums.map(([k, x]) => `${CALIB_KEY_LABELS[k] ?? k} ${valueText(x)}`).join(", ");
  }
  return "—";
}
const CALIB_KEY_LABELS: Record<string, string> = { ctrFactor: "clics", ftdFactor: "premiers dépôts", ctr_factor: "clics", ftd_factor: "premiers dépôts" };

export type CalibrationProposalView = {
  id: string;
  number: number;
  what: string;
  target: string;
  change: string;
  reason: string | null;
  sample: string | null;
  createdAt: Date;
};

/** Propositions de calibrage en cours, numérotées dans l'ordre (la plus ancienne = 1, comme Kevin). */
export function calibrationProposals(
  rows: ReadonlyArray<{ id: string; targetId: string; field: string; before: unknown; after: unknown; evidence: unknown; expectedGain: string | null; createdAt: Date }>,
): CalibrationProposalView[] {
  return [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((r, i) => {
      const ev = isObj(r.evidence) ? r.evidence : {};
      const affiliates = num(ev.affiliates) ?? num(ev.sample);
      const days = num(ev.days);
      return {
        id: r.id,
        number: i + 1,
        what: calibrationFieldLabel(r.field),
        target: r.targetId.includes("|") ? segmentLabel(r.targetId) : r.targetId === "global" || !r.targetId ? "Toute la prospection" : r.targetId,
        change: `${valueText(r.before)} → ${valueText(r.after)}`,
        reason: txt(ev.summary) ?? txt(ev.text) ?? txt(r.expectedGain),
        sample: affiliates !== null ? `${fmtNum(affiliates)} affilié${affiliates > 1 ? "s" : ""}${days !== null ? ` sur ${fmtNum(days)} jours` : ""}` : null,
        createdAt: r.createdAt,
      };
    });
}

/** Bornes du calibrage en phrase (montrées sous les propositions). */
export function calibrationBoundsText(): string {
  const b = CALIBRATION_BOUNDS;
  return `Jamais sur moins de ${b.minAffiliates} affiliés ou ${b.minDays} jours de résultats ; un coefficient bouge de ${fmtPct(b.coefficientMaxChange, 0)} au plus par mois, un poids de la note de ${fmtPct(b.weightMaxChange, 0)} au plus.`;
}

/** Choix « 1, 3 » ou « 1 et 3 » → numéros uniques, dans l'ordre. */
export function parseChoiceNumbers(v: unknown): number[] {
  const raw = Array.isArray(v) ? v.map(String).join(" ") : typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  const out: number[] = [];
  for (const m of raw.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (Number.isInteger(n) && n >= 1 && n <= 99 && !out.includes(n)) out.push(n);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- affiliés signés

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-09 » → « septembre 2026 ». */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : month;
}

const MISSING_RESULT_LABELS: Record<string, string> = { clicks: "clics", regs: "inscriptions", ftd: "premiers dépôts", revenue: "revenus", revenueCents: "revenus" };

export function missingResultsText(v: unknown): string | null {
  const list = Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  if (!list.length) return null;
  return `Non fourni par Link Affi : ${[...new Set(list.map((m) => MISSING_RESULT_LABELS[m] ?? m))].join(", ")}`;
}

export type EstimateVsReal = { verdict: "below" | "inside" | "above" | "unknown"; text: string };

/** Compare le revenu réel d'un mois à la fourchette estimée (mensuelle). */
export function estimateVsReal(estimate: Pick<ValueEstimate, "low" | "high"> | null, revenueCents: number | null): EstimateVsReal {
  if (!estimate) return { verdict: "unknown", text: "Pas d'estimation à comparer" };
  if (revenueCents === null) return { verdict: "unknown", text: "Revenu réel non fourni" };
  const real = revenueCents / 100;
  if (real < estimate.low) return { verdict: "below", text: `En dessous de la fourchette (${eur(real)} pour ${valueRangeShort(estimate)})` };
  if (real > estimate.high) return { verdict: "above", text: `Au-dessus de la fourchette (${eur(real)} pour ${valueRangeShort(estimate)})` };
  return { verdict: "inside", text: `Dans la fourchette (${eur(real)} pour ${valueRangeShort(estimate)})` };
}

/** Identifiant d'affilié Link Affi accepté (chiffres, lettres, tirets : 1 à 64 caractères). */
export function safeAffiliateId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().replace(/^#/, "") : typeof v === "number" && Number.isInteger(v) ? String(v) : "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// ------------------------------------------------------------------------------------------------- sources : attribution

export type AttributionRow = { key: string; total: number; tierA: number; signed: number; active: number; shareA: number | null; shareSigned: number | null; shareActive: number | null };

const SIGNED_STATUSES = new Set(["SIGNED", "ACTIVE", "CHURNED"]);
/** Canaux lus et notés (les seuls qui comptent dans l'attribution). */
const NOTED_EXCLUDED = new Set(["DISCOVERED", "ENRICHING", "UNREADABLE", "ENRICH_FAILED"]);

/**
 * Attribution : par clé (type de source ou pays), part des niveaux A, des signés et des actifs parmi les canaux lus
 * et notés. Un canal signé est compté même s'il a arrêté depuis (`signedAt` posé).
 */
export function attribution(
  rows: ReadonlyArray<{ key: string | null; tier: string | null; status: string; signedAt: Date | null }>,
): AttributionRow[] {
  const by = new Map<string, { total: number; tierA: number; signed: number; active: number }>();
  for (const r of rows) {
    if (!r.key || NOTED_EXCLUDED.has(r.status)) continue;
    const g = by.get(r.key) ?? { total: 0, tierA: 0, signed: 0, active: 0 };
    g.total++;
    if (r.tier === "A") g.tierA++;
    if (r.signedAt || SIGNED_STATUSES.has(r.status)) g.signed++;
    if (r.status === "ACTIVE") g.active++;
    by.set(r.key, g);
  }
  const share = (n: number, d: number) => (d > 0 ? n / d : null);
  return [...by.entries()]
    .map(([key, g]) => ({ key, ...g, shareA: share(g.tierA, g.total), shareSigned: share(g.signed, g.total), shareActive: share(g.active, g.total) }))
    .sort((a, b) => b.signed - a.signed || b.tierA - a.tierA || b.total - a.total || a.key.localeCompare(b.key));
}

// ------------------------------------------------------------------------------------------------- compte réel

export type AccountSearchState = {
  enabled: boolean;
  offered: boolean;
  today: number;
  perAccount: Array<{ account: string; count: number }>;
  capPerAccount: number;
  flood: { at: Date; seconds: number | null } | null;
};

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
export const parisDay = (d: Date): string => PARIS_DAY.format(d);

/** État de la recherche par compte réel : activée ou non, compteurs du jour (Paris), dernier avertissement de Telegram. */
export function accountSearchState(input: { enabled: unknown; offered: unknown; counters: unknown }, now: Date): AccountSearchState {
  const c = isObj(input.counters) ? input.counters : {};
  const sameDay = txt(c.day) === parisDay(now);
  const per = sameDay && isObj(c.perAccount) ? c.perAccount : {};
  const perAccount = Object.entries(per)
    .map(([account, n]) => ({ account: maskAccount(account), count: num(n) ?? 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
  const f = isObj(c.flood) ? c.flood : null;
  const at = f && typeof f.at === "string" && !Number.isNaN(Date.parse(f.at)) ? new Date(f.at) : null;
  return {
    enabled: input.enabled === true,
    offered: input.offered === true || isObj(input.offered) || typeof input.offered === "string",
    today: perAccount.reduce((a, x) => a + x.count, 0),
    perAccount,
    capPerAccount: ACCOUNT_SEARCH.perAccountPerDay,
    flood: at ? { at, seconds: num(f!.seconds) } : null,
  };
}

/** Un compte n'est jamais montré en entier : « Compte …4821 ». */
export function maskAccount(id: string): string {
  const s = id.replace(/[^A-Za-z0-9]/g, "");
  return s.length > 4 ? `Compte …${s.slice(-4)}` : "Compte";
}

export function accountSearchBadge(s: Pick<AccountSearchState, "enabled" | "flood">): "ON" | "OFF" | "STOPPED" {
  if (s.enabled) return "ON";
  return s.flood ? "STOPPED" : "OFF";
}

// ------------------------------------------------------------------------------------------------- fiche : historique

export type SnapshotLite = { takenAt: Date; subscribers: number | null; medianViews: number | null };

const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });

/** Points d'une mesure (abonnés ou vues par post) pour la courbe : les relectures sans cette mesure sont omises. */
export function snapshotSeries(snaps: readonly SnapshotLite[], field: "subscribers" | "medianViews"): { labels: string[]; values: number[] } {
  const pts = [...snaps].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime()).filter((s) => typeof s[field] === "number");
  return { labels: pts.map((s) => DAY_LABEL.format(s.takenAt)), values: pts.map((s) => s[field] as number) };
}
