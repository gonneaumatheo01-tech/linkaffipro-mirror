/**
 * Phase 31, chantier C — score 0-100 d'un prospect (section 4 du prompt). PUR, sans IA : une somme de composantes
 * visibles, chacune mise à l'échelle `poids réglé / poids par défaut`, moins des pénalités (non pondérées).
 *
 * Composantes au poids par défaut :
 * - Audience (30) : échelle logarithmique sur les vues médianes (les abonnés s'achètent), paliers 100 → 5, 300 → 10,
 *   1 000 → 16, 3 000 → 22, 10 000 → 27, ≥ 25 000 → 30, interpolés en log10 ; sous 100, linéaire depuis 0 ;
 *   × 0,6 si l'authenticité est SUSPECT_GENERIC.
 * - Engagement (15) : taux de vue ≥ 0,20 → 10, ≥ 0,10 → 7, ≥ 0,05 → 4, ≥ 0,03 → 2, sinon 0 ; + 5 au plus pour les
 *   réactions (≥ 2 % → 3, ≥ 1 % → 2, > 0 → 1) et les commentaires (≥ 0,5 % → 2, > 0 → 1) ; aperçu sans posts → 0.
 * - Adéquation (20) : premier pays dans les pays d'une offre active → 12 ; verticale compatible → 5 ; contenu propice
 *   (vip_sales, tips_free, bonus_pushing, streams_clips) → 3, news → 1 ; signal réglementaire → −6 (plancher 0).
 *   Sans offre active : « Europe, verticale » seulement (EU → 12, verticale paris / casino → 5). Le pays ne compte
 *   que si la région est EU (UNKNOWN : 0 pour le pays).
 * - Ouverture (15 au plus) : vend de la pub 6, pousse des liens d'affiliation 5, VIP 3, place de marché 4.
 * - Concurrence (10) : FREE 10, ROTATING 8, EXCLUSIVE 3, OURS 2 ; inconnu (non calculé) 5.
 * - Joignabilité (10) : HIGH 10, MEDIUM 6, LOW 3, NONE 0.
 * - Pénalités : 6 par signal de faux (18 au plus), SUSPECT_GENERIC 8, groupe 5, GUARANTEED_WINS 15.
 *
 * Règles dures : NON_EU → D ; SCAM_FIXED_MATCHES → D ; SUSPECT_BOT / REPOST → D (écarté) ; région UNKNOWN → score
 * plafonné à 49 et jamais A ni B ; ≥ 2 signaux de faux → jamais A ; sans contact → jamais A. Niveau : A ≥ seuil A,
 * B ≥ seuil B, C ≥ seuil de qualification, sinon D. QUALIFIED = A, B ou C.
 */
import {
  PROSPECTION_LIMITS,
  PROSPECTION_SETTINGS,
  type BrandMention,
  type CompetitiveState,
  type ContactConfidence,
  type ProspectTier,
  type ProspectVertical,
  type ScoreBreakdown,
  type ScoreInput,
  type ScoreResult,
  type ScoreWeights,
} from "../contract";
import { COMPETITION_LABELS, formatCount } from "./format";

/** Données facultatives qui ne changent pas le score mais servent à la raison du niveau (marques, contact). */
export type ScoreInputExtras = {
  brands?: Array<Pick<BrandMention, "brand"> & Partial<BrandMention>> | null;
  bestContact?: string | null;
  bestContactLabel?: string | null;
};

export type ScoreSettingsInput = { weights: ScoreWeights; qualified: number; tierA: number; tierB: number };

const DEFAULT_WEIGHTS = PROSPECTION_SETTINGS.weights.value;

/** Paliers de l'audience (vues médianes → points sur 30). */
export const AUDIENCE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [100, 5],
  [300, 10],
  [1000, 16],
  [3000, 22],
  [10_000, 27],
  [25_000, 30],
];

/** Points d'audience bruts (sur 30), sans le coefficient SUSPECT_GENERIC. */
export function audiencePoints(medianViews: number | null): number {
  if (medianViews === null || !Number.isFinite(medianViews) || medianViews <= 0) return 0;
  const first = AUDIENCE_STEPS[0]!;
  const last = AUDIENCE_STEPS[AUDIENCE_STEPS.length - 1]!;
  if (medianViews >= last[0]) return last[1];
  if (medianViews <= first[0]) return (first[1] * medianViews) / first[0];
  for (let i = 1; i < AUDIENCE_STEPS.length; i++) {
    const [x1, y1] = AUDIENCE_STEPS[i]!;
    const [x0, y0] = AUDIENCE_STEPS[i - 1]!;
    if (medianViews <= x1) {
      const t = (Math.log10(medianViews) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0));
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

export function viewRatePoints(viewRate: number | null): number {
  if (viewRate === null || !Number.isFinite(viewRate)) return 0;
  if (viewRate >= 0.2) return 10;
  if (viewRate >= 0.1) return 7;
  if (viewRate >= 0.05) return 4;
  if (viewRate >= 0.03) return 2;
  return 0;
}

export function interactionPoints(reactionRate: number | null, commentRate: number | null): number {
  let p = 0;
  if (reactionRate !== null && Number.isFinite(reactionRate)) p += reactionRate >= 0.02 ? 3 : reactionRate >= 0.01 ? 2 : reactionRate > 0 ? 1 : 0;
  if (commentRate !== null && Number.isFinite(commentRate)) p += commentRate >= 0.005 ? 2 : commentRate > 0 ? 1 : 0;
  return Math.min(5, p);
}

const GOOD_CONTENT = new Set(["vip_sales", "tips_free", "bonus_pushing", "streams_clips"]);

export function verticalCompatible(prospect: ProspectVertical, offer: ProspectVertical): boolean {
  if (prospect === "OTHER" || offer === "OTHER") return false;
  return prospect === offer || prospect === "BOTH" || offer === "BOTH";
}

/** Meilleure offre active qui colle (verticale compatible obligatoire, pays du canal accepté de préférence). */
export function bestOffer(input: Pick<ScoreInput, "offers" | "vertical" | "countries" | "region">): { id: string; points: number; countryMatch: boolean; verticalMatch: boolean } | null {
  const first = input.countries[0]?.toUpperCase() ?? null;
  let best: { id: string; points: number; countryMatch: boolean; verticalMatch: boolean } | null = null;
  for (const o of input.offers) {
    const verticalMatch = verticalCompatible(input.vertical, o.vertical);
    const countryMatch = input.region === "EU" && !!first && o.countries.map((c) => c.toUpperCase()).includes(first);
    const points = (countryMatch ? 12 : 0) + (verticalMatch ? 5 : 0);
    if (!verticalMatch) continue;
    if (!best || points > best.points) best = { id: o.id, points, countryMatch, verticalMatch };
  }
  return best;
}

const COMPETITION_POINTS: Record<CompetitiveState, number> = { FREE: 10, ROTATING: 8, EXCLUSIVE: 3, OURS: 2 };
const REACH_POINTS: Record<ContactConfidence, number> = { HIGH: 10, MEDIUM: 6, LOW: 3, NONE: 0 };

const scaled = (raw: number, weight: number, def: number) => (def > 0 ? (raw * weight) / def : 0);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function tierOf(score: number, s: ScoreSettingsInput): ProspectTier {
  if (score >= s.tierA) return "A";
  if (score >= s.tierB) return "B";
  if (score >= s.qualified) return "C";
  return "D";
}

const TIER_ORDER: ProspectTier[] = ["A", "B", "C", "D"];
const lowerOf = (a: ProspectTier, b: ProspectTier): ProspectTier => (TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b);

/** Partie « marques » de la raison : « pousse 1xbet (rotatif) », « sans marque ». */
function brandPart(input: ScoreInput & ScoreInputExtras): string | null {
  const brands = (input.brands ?? []).filter((b) => b && typeof b.brand === "string" && b.brand.trim());
  const state = input.competitiveState;
  if (state === "OURS") return COMPETITION_LABELS.OURS;
  if (brands.length) {
    const names = brands.slice(0, 2).map((b) => b.brand.trim());
    return `pousse ${names.join(" et ")}${state ? ` (${COMPETITION_LABELS[state]})` : ""}`;
  }
  return state === "FREE" ? COMPETITION_LABELS.FREE : null;
}

function contactPart(input: ScoreInput & ScoreInputExtras): string {
  if (input.contactConfidence === "NONE" || !input.bestContact) return input.contactConfidence === "NONE" ? "sans contact" : "contact à trouver";
  const label = input.bestContactLabel?.trim();
  return `contact${label ? ` ${label}` : ""} : ${input.bestContact}`;
}

export function scoreProspect(input: ScoreInput & ScoreInputExtras, settings: ScoreSettingsInput): ScoreResult {
  const w = settings.weights;
  const caps: string[] = [];
  const generic = input.authenticity === "SUSPECT_GENERIC";

  // Audience.
  const audienceRaw = audiencePoints(input.medianViews) * (generic ? 0.6 : 1);
  const audience = Math.round(scaled(audienceRaw, w.audience, DEFAULT_WEIGHTS.audience));

  // Engagement.
  let engagementRaw = 0;
  if (input.hasPosts) engagementRaw = viewRatePoints(input.viewRate) + interactionPoints(input.reactionRate, input.commentRate);
  else caps.push("aperçu sans posts : engagement à 0");
  const engagement = Math.round(scaled(Math.min(15, engagementRaw), w.engagement, DEFAULT_WEIGHTS.engagement));

  // Adéquation.
  const offer = bestOffer(input);
  let fitRaw = 0;
  if (input.offers.length) fitRaw += offer?.points ?? 0;
  else {
    caps.push("aucune offre active : adéquation sur «\u00a0Europe, verticale\u00a0» seulement");
    if (input.region === "EU") fitRaw += 12;
    if (input.vertical !== "OTHER") fitRaw += 5;
  }
  if (input.contentType && GOOD_CONTENT.has(input.contentType)) fitRaw += 3;
  else if (input.contentType === "news") fitRaw += 1;
  if (input.regulatoryFlag) fitRaw -= 6;
  const fit = Math.round(scaled(clamp(fitRaw, 0, 20), w.fit, DEFAULT_WEIGHTS.fit));

  // Ouverture.
  const m = input.monetization ?? {};
  const opennessRaw = Math.min(15, (m.sellsAds ? 6 : 0) + (m.pushesAffiliate ? 5 : 0) + (m.sellsVip ? 3 : 0) + (m.marketplaceListing ? 4 : 0));
  const openness = Math.round(scaled(opennessRaw, w.openness, DEFAULT_WEIGHTS.openness));

  // Concurrence et joignabilité.
  const competitionRaw = input.competitiveState ? COMPETITION_POINTS[input.competitiveState] : 5;
  const competition = Math.round(scaled(competitionRaw, w.competition, DEFAULT_WEIGHTS.competition));
  const reach = Math.round(scaled(REACH_POINTS[input.contactConfidence], w.reach, DEFAULT_WEIGHTS.reach));

  // Pénalités (non pondérées).
  const fakeCount = new Set(input.fakeFlags).size;
  let penalties = 0 - Math.min(PROSPECTION_LIMITS.fakePenaltyMax, fakeCount * PROSPECTION_LIMITS.fakePenalty);
  if (generic) penalties -= 8;
  if (input.kind === "GROUP") penalties -= 5;
  if (input.riskFlags.includes("GUARANTEED_WINS")) penalties -= 15;

  const breakdown: ScoreBreakdown = { audience, engagement, fit, openness, competition, reach, penalties };
  let score = clamp(Math.round(audience + engagement + fit + openness + competition + reach + penalties), 0, 100);

  // Plafonds et exclusions.
  let maxTier: ProspectTier = "A";
  let excluded: string | null = null;
  if (input.region === "NON_EU") excluded = "hors Europe";
  else if (input.riskFlags.includes("SCAM_FIXED_MATCHES")) excluded = "vend des matchs truqués";
  else if (input.authenticity === "SUSPECT_BOT") excluded = "faux canal (contenu de robot)";
  else if (input.authenticity === "REPOST") excluded = "ne fait que transférer";
  if (excluded) caps.push(`${excluded} : niveau D`);

  if (input.region === "UNKNOWN") {
    if (score > PROSPECTION_LIMITS.unknownRegionCap) score = PROSPECTION_LIMITS.unknownRegionCap;
    maxTier = lowerOf(maxTier, "C");
    caps.push(`pays incertain : score plafonné à ${PROSPECTION_LIMITS.unknownRegionCap}, jamais A ni B`);
  }
  if (fakeCount >= 2) {
    maxTier = lowerOf(maxTier, "B");
    caps.push(`${fakeCount} signaux de faux : jamais A`);
  }
  if (input.contactConfidence === "NONE") {
    maxTier = lowerOf(maxTier, "B");
    caps.push("sans contact : jamais A");
  }

  const tier: ProspectTier = excluded ? "D" : lowerOf(tierOf(score, settings), maxTier);
  const status = tier === "D" ? "DISQUALIFIED" : "QUALIFIED";

  // Raison en une ligne.
  let tierReason: string;
  if (excluded) tierReason = `${excluded} — D`;
  else {
    const parts: string[] = [];
    parts.push(input.hasPosts && input.medianViews !== null ? `${formatCount(input.medianViews)} vues/post` : "aperçu fermé");
    parts.push(input.countries[0]?.toUpperCase() ?? "pays inconnu");
    const b = brandPart(input);
    if (b) parts.push(b);
    parts.push(contactPart(input));
    if (fakeCount) parts.push(`${fakeCount} signal${fakeCount > 1 ? "s" : ""} de faux`);
    if (input.regulatoryFlag) parts.push("règle du pays à vérifier");
    tierReason = `${parts.join(", ")} — ${tier}`;
  }

  return { score, breakdown, tier, status, tierReason, matchedOfferId: excluded ? null : (offer?.id ?? null), caps };
}
