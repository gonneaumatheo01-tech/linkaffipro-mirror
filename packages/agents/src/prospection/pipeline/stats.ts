/**
 * Phase 31, chantier C — chiffres et filtres des prospects, pour Kevin (chantier D) et le site (chantier E).
 *
 * Règle commune : un prospect NON_EU n'est jamais compté ni montré (sauf périmètre élargi qui contient son pays) ; un
 * vendeur de matchs truqués n'est jamais montré dans une liste. Tout chiffre vient de la base (aucune IA ici).
 */
import { esc } from "../../admin/journal";
import { parisMonth } from "../../rules/time";
import { PROSPECTION_SETTINGS, type CompetitiveState, type ProspectionDeps, type ProspectStatus, type ProspectTier, type ProspectVertical, type ScoreWeights } from "../contract";
import {
  COMPETITION_LABELS,
  CONTACT_CONFIDENCE_LABELS,
  PROSPECT_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  VERTICAL_LABELS,
  flagOf,
  formatCount,
  formatPct,
  handleOf,
} from "../score/format";
import { DAY_MS, loadCountriesScope, objectOf, prospectionNow, regionVisible, stringArray, weightsOf } from "../score/settings";
import type { ContactRow, ProspectRow } from "../score/store";
import { audienceText, contactText, dealText, moneyText, warningText } from "./cards";

export const PIPELINE_STATUSES: readonly ProspectStatus[] = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED", "SKIPPED", "BLACKLISTED"];

/** Médiane (null si vide). */
export function medianOf(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

const daysBetween = (a: Date | null, b: Date | null) => (a && b ? Math.max(0, (b.getTime() - a.getTime()) / DAY_MS) : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Prospects visibles (région), tous statuts. */
export async function visibleProspects(deps: ProspectionDeps, where: Record<string, unknown> = {}): Promise<ProspectRow[]> {
  const scope = await loadCountriesScope(deps);
  const rows = (await deps.prisma.prospect.findMany({ where })) as unknown as ProspectRow[];
  return rows.filter((p) => regionVisible(p, scope));
}

export type ProspectStats = {
  total: number;
  byStatus: Partial<Record<ProspectStatus, number>>;
  byTier: Partial<Record<ProspectTier, number>>;
  byCountry: Record<string, number>;
  byVertical: Partial<Record<ProspectVertical, number>>;
  contacted: number;
  responded: number;
  signed: number;
  /** Répondu ÷ contacté (null si personne n'a été contacté). */
  responseRate: number | null;
  signRate: number | null;
  signedThisMonth: number;
  medianDaysToResponse: number | null;
  medianDaysToSign: number | null;
};

const inc = <K extends string>(m: Partial<Record<K, number>>, k: K) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** Comptes de la période (`discoveredAt` dans [from, to[ ; sans bornes : tout). Qualifiés = niveaux A, B, C. */
export async function prospectStats(deps: ProspectionDeps, opts: { from?: Date; to?: Date } = {}): Promise<ProspectStats> {
  const now = prospectionNow(deps);
  const rows = (await visibleProspects(deps)).filter(
    (p) => (!opts.from || p.discoveredAt.getTime() >= opts.from.getTime()) && (!opts.to || p.discoveredAt.getTime() < opts.to.getTime()),
  );
  const out: ProspectStats = {
    total: rows.length,
    byStatus: {},
    byTier: {},
    byCountry: {},
    byVertical: {},
    contacted: 0,
    responded: 0,
    signed: 0,
    responseRate: null,
    signRate: null,
    signedThisMonth: 0,
    medianDaysToResponse: null,
    medianDaysToSign: null,
  };
  const toResponse: number[] = [];
  const toSign: number[] = [];
  const month = parisMonth(now);
  for (const p of rows) {
    inc(out.byStatus, p.status);
    if (p.tier) inc(out.byTier, p.tier);
    const c = stringArray(p.countries)[0]?.toUpperCase();
    if (c) out.byCountry[c] = (out.byCountry[c] ?? 0) + 1;
    inc(out.byVertical, p.vertical);
    if (p.contactedAt) out.contacted++;
    if (p.respondedAt) out.responded++;
    if (p.signedAt) {
      out.signed++;
      if (parisMonth(p.signedAt) === month) out.signedThisMonth++;
    }
    const r = daysBetween(p.contactedAt, p.respondedAt);
    if (r !== null) toResponse.push(r);
    const s = daysBetween(p.contactedAt, p.signedAt);
    if (s !== null) toSign.push(s);
  }
  out.responseRate = out.contacted ? out.responded / out.contacted : null;
  out.signRate = out.contacted ? out.signed / out.contacted : null;
  out.medianDaysToResponse = round1(medianOf(toResponse));
  out.medianDaysToSign = round1(medianOf(toSign));
  return out;
}

export type ProspectFilters = {
  countries?: string[];
  vertical?: ProspectVertical;
  /** Sous-type (`verticalDetails` : « crash », « aviator », « foot », « slots »…). */
  subtype?: string;
  tiers?: ProspectTier[];
  competitiveState?: CompetitiveState | CompetitiveState[];
  sellsAds?: boolean;
  hasContact?: boolean;
  minViews?: number;
  /** Par défaut : à contacter (QUALIFIED). */
  status?: ProspectStatus | ProspectStatus[];
  limit?: number;
  sort?: "score" | "views" | "subscribers" | "recent";
};

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

export async function filterProspects(deps: ProspectionDeps, filters: ProspectFilters = {}): Promise<ProspectRow[]> {
  const statuses = filters.status ? (Array.isArray(filters.status) ? filters.status : [filters.status]) : (["QUALIFIED"] as ProspectStatus[]);
  const rows = await visibleProspects(deps, { status: { in: statuses } });
  const countries = filters.countries?.map((c) => c.toUpperCase());
  const states = filters.competitiveState ? (Array.isArray(filters.competitiveState) ? filters.competitiveState : [filters.competitiveState]) : null;
  const sub = filters.subtype?.trim().toLowerCase();
  const out = rows.filter((p) => {
    if (stringArray(p.riskFlags).includes("SCAM_FIXED_MATCHES")) return false;
    if (countries?.length && !countries.includes(stringArray(p.countries)[0]?.toUpperCase() ?? "")) return false;
    if (filters.vertical && !(p.vertical === filters.vertical || p.vertical === "BOTH" || filters.vertical === "BOTH")) return false;
    if (sub) {
      const d = objectOf(p.verticalDetails);
      const all = [...stringArray(d.sports), ...stringArray(d.casino)].map((x) => x.toLowerCase());
      if (!all.some((x) => x.includes(sub))) return false;
    }
    if (filters.tiers?.length && !(p.tier && filters.tiers.includes(p.tier))) return false;
    if (states && !(p.competitiveState && states.includes(p.competitiveState as CompetitiveState))) return false;
    if (filters.sellsAds !== undefined && (objectOf(p.monetization).sellsAds === true) !== filters.sellsAds) return false;
    if (filters.hasContact !== undefined && (p.contactConfidence !== "NONE") !== filters.hasContact) return false;
    if (filters.minViews !== undefined && (p.medianViews ?? 0) < filters.minViews) return false;
    return true;
  });
  const sort = filters.sort ?? "score";
  out.sort((a, b) => {
    if (sort === "views") return (b.medianViews ?? 0) - (a.medianViews ?? 0);
    if (sort === "subscribers") return (b.subscribers ?? 0) - (a.subscribers ?? 0);
    if (sort === "recent") return b.discoveredAt.getTime() - a.discoveredAt.getTime();
    return (TIER_RANK[a.tier ?? "D"] ?? 3) - (TIER_RANK[b.tier ?? "D"] ?? 3) || (b.score ?? 0) - (a.score ?? 0) || b.cocitationCount - a.cocitationCount;
  });
  return out.slice(0, Math.max(1, Math.min(200, filters.limit ?? 20)));
}

/** Une ligne compacte : « Niveau A · 🇫🇷 @nom — Paris sportifs — 2,1k vues/post — 78/100 — à contacter ». */
export function formatProspectLine(p: ProspectRow): string {
  const flag = flagOf(stringArray(p.countries)[0]);
  const views = p.medianViews !== null ? `${formatCount(p.medianViews)} vues/post` : "aperçu fermé";
  return `Niveau ${p.tier ?? "?"} · ${flag ? `${flag} ` : ""}${esc(handleOf(p))} — ${VERTICAL_LABELS[p.vertical] ?? "Autre"} — ${views} — ${p.score ?? "?"}/100 — ${PROSPECT_STATUS_LABELS[p.status] ?? "?"}`;
}

const BREAKDOWN_LABELS: Array<[keyof ScoreWeights, string]> = [
  ["audience", "audience"],
  ["engagement", "engagement"],
  ["fit", "adéquation"],
  ["openness", "ouverture"],
  ["competition", "concurrence"],
  ["reach", "joignabilité"],
];

/** Détail du score lisible : « audience 22/30 · engagement 9/15 · … · pénalités −5 ». */
export function scoreBreakdownText(breakdown: unknown, weights: ScoreWeights = PROSPECTION_SETTINGS.weights.value): string {
  const b = objectOf(breakdown);
  const parts = BREAKDOWN_LABELS.map(([k, label]) => `${label} ${typeof b[k] === "number" ? b[k] : "?"}/${weights[k]}`);
  const pen = typeof b.penalties === "number" ? b.penalties : 0;
  if (pen) parts.push(`pénalités ${pen < 0 ? "−" : ""}${Math.abs(pen)}`);
  return parts.join(" · ");
}

/** Fiche d'un prospect pour Kevin (le client a demandé le détail : longueur libre). */
export function formatProspectDetail(
  p: ProspectRow,
  extra: { contacts?: readonly ContactRow[]; offerBrand?: string | null; offerDeal?: unknown; weights?: unknown; now?: Date } = {},
): string {
  const now = extra.now ?? new Date();
  const lines: string[] = [formatProspectLine(p)];
  if (p.summaryFr) lines.push(esc(p.summaryFr));
  lines.push(`Audience : ${esc(audienceText(p))}`);
  const countries = stringArray(p.countries).slice(0, 3).join(", ");
  lines.push(`Pays : ${countries || "inconnu"}${p.language ? ` · langue ${esc(p.language)}` : ""}`);
  lines.push(esc(moneyText(p, now)));
  if (p.competitiveState && p.competitiveState in COMPETITION_LABELS) lines.push(`Concurrence : ${COMPETITION_LABELS[p.competitiveState as CompetitiveState]}`);
  lines.push(esc(contactText(extra.contacts ?? [], p.bestContact)) + (p.contactConfidence !== "NONE" ? ` · confiance ${CONTACT_CONFIDENCE_LABELS[p.contactConfidence]}` : ""));
  if (extra.offerBrand) {
    const deal = dealText(extra.offerDeal);
    lines.push(`Offre qui colle : ${esc(extra.offerBrand)}${deal ? ` (${deal})` : ""}`);
  }
  lines.push(`Score ${p.score ?? "?"}/100 : ${scoreBreakdownText(p.scoreBreakdown, weightsOf(extra.weights))}`);
  if (p.tierReason) lines.push(`Raison du niveau : ${esc(p.tierReason)}`);
  const warn = warningText(p);
  if (warn) lines.push(esc(warn));
  if (p.dealType) {
    const t = objectOf(p.dealTerms);
    const deal = p.dealType === "HYBRID" ? dealText({ hybrid: t }) : dealText(t);
    lines.push(`Deal : ${deal ?? esc(p.dealType)}`);
  }
  lines.push(`Trouvé par ${SOURCE_TYPE_LABELS[p.sourceType] ?? "une autre source"}${p.cocitationCount ? `, cité par ${p.cocitationCount} canal${p.cocitationCount > 1 ? "aux" : ""}` : ""}`);
  if (p.dossier) lines.push(`Dossier :\n${esc(p.dossier)}`);
  return lines.join("\n");
}

/** Taux en texte (« 40 % ») pour Kevin. */
export const rateText = (r: number | null) => (r === null ? "pas encore de contact" : formatPct(r));
