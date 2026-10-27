/**
 * Phase 31, chantier C — score d'un prospect enregistré (tâche `prospection.score`, enfilée par l'Enrichisseur).
 *
 * Lit le prospect, ses contacts et les offres actives, calcule le score (`scoreProspect`, sans IA), écrit score,
 * détail, niveau, raison, offre appariée et statut (QUALIFIED / DISQUALIFIED ; un prospect déjà dans le pipeline du
 * client — contacté, a répondu, en négociation, signé, actif, arrêté, pas intéressé, à ne plus montrer — garde son
 * statut : seul le score change), puis un `ProspectEvent` SCORED. Enfile `prospection.dossier` pour les A et les B
 * les mieux notés (moitié haute de la plage B), dans la limite de `prospection.dossier_weekly_cap` sur 7 jours glissants.
 */
import {
  PROSPECTION_SETTINGS,
  type CompetitiveState,
  type ContactConfidence,
  type FakeFlag,
  type ProspectAuthenticity,
  type ProspectionDeps,
  type ProspectKind,
  type ProspectRegion,
  type ProspectStatus,
  type ProspectVertical,
  type RiskFlag,
  type ScoreInput,
  type ScoreResult,
} from "../contract";
import { scoreProspect, type ScoreInputExtras } from "./score";
import { DAY_MS, loadScoreSettings, numberSetting, objectOf, prospectionNow, stringArray, type ScoreSettings } from "./settings";

/** Statuts du pipeline du client : jamais rétrogradés par un nouveau score. */
export const CLIENT_PIPELINE_STATUSES: readonly ProspectStatus[] = ["CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED", "SKIPPED", "BLACKLISTED"];

/** Ligne `Prospect` telle que lue (colonnes utiles au chantier C). */
export type ProspectRow = {
  id: string;
  username: string | null;
  channelUrl: string;
  kind: ProspectKind;
  title: string;
  summaryFr: string | null;
  vertical: ProspectVertical;
  verticalDetails: unknown;
  contentType: string | null;
  language: string | null;
  countries: unknown;
  region: ProspectRegion;
  regulatoryFlag: string | null;
  subscribers: number | null;
  postsPerDay: number | null;
  medianViews: number | null;
  avgViews: number | null;
  viewRate: number | null;
  reactionRate: number | null;
  commentRate: number | null;
  lastPostAt: Date | null;
  firstSeenPostAt: Date | null;
  authenticity: ProspectAuthenticity | null;
  authenticityReason: string | null;
  fakeFlags: unknown;
  riskFlags: unknown;
  monetization: unknown;
  brands: unknown;
  competitiveState: string | null;
  contactConfidence: ContactConfidence;
  bestContact: string | null;
  score: number | null;
  scoreBreakdown: unknown;
  tier: "A" | "B" | "C" | "D" | null;
  tierReason: string | null;
  dossier: string | null;
  dossierAt: Date | null;
  matchedOfferId: string | null;
  status: ProspectStatus;
  statusChangedAt: Date | null;
  presentedAt: Date | null;
  snoozedUntil: Date | null;
  contactedAt: Date | null;
  respondedAt: Date | null;
  signedAt: Date | null;
  dealType: string | null;
  dealTerms: unknown;
  sourceType: string;
  cocitationCount: number;
  discoveredAt: Date;
  enrichedAt: Date | null;
};

export type OfferRow = { id: string; brand: string; vertical: ProspectVertical; countries: unknown; dealTypes: unknown; isActive: boolean };

export type ContactRow = { type: string; value: string; label: string | null; source: string; confidence: ContactConfidence };

const COMPETITIVE = new Set(["FREE", "ROTATING", "EXCLUSIVE", "OURS"]);

export async function activeOffers(deps: Pick<ProspectionDeps, "prisma">): Promise<OfferRow[]> {
  return (await deps.prisma.affiliateOffer.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })) as unknown as OfferRow[];
}

export async function contactsOf(deps: Pick<ProspectionDeps, "prisma">, prospectId: string): Promise<ContactRow[]> {
  const rows = (await deps.prisma.prospectContact.findMany({ where: { prospectId } })) as unknown as ContactRow[];
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
  return rows.sort((a, b) => (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3));
}

/** Entrée du score à partir de la ligne en base (+ marques et meilleur contact pour la raison du niveau). */
export function scoreInputOf(p: ProspectRow, offers: readonly OfferRow[], contacts: readonly ContactRow[] = []): ScoreInput & ScoreInputExtras {
  const mon = objectOf(p.monetization);
  const best = contacts.find((c) => c.value === p.bestContact) ?? contacts[0] ?? null;
  return {
    kind: p.kind,
    region: p.region,
    countries: stringArray(p.countries).map((c) => c.toUpperCase()),
    vertical: p.vertical,
    contentType: p.contentType,
    regulatoryFlag: p.regulatoryFlag,
    medianViews: p.medianViews,
    subscribers: p.subscribers,
    viewRate: p.viewRate,
    reactionRate: p.reactionRate,
    commentRate: p.commentRate,
    hasPosts: p.medianViews !== null || p.lastPostAt !== null,
    authenticity: p.authenticity,
    fakeFlags: stringArray(p.fakeFlags) as FakeFlag[],
    riskFlags: stringArray(p.riskFlags) as RiskFlag[],
    monetization: {
      sellsVip: mon.sellsVip === true,
      sellsAds: mon.sellsAds === true,
      pushesAffiliate: mon.pushesAffiliate === true,
      marketplaceListing: typeof mon.marketplaceListing === "string" ? mon.marketplaceListing : null,
    },
    competitiveState: p.competitiveState && COMPETITIVE.has(p.competitiveState) ? (p.competitiveState as CompetitiveState) : null,
    contactConfidence: p.contactConfidence ?? "NONE",
    offers: offers.map((o) => ({ id: o.id, brand: o.brand, vertical: o.vertical, countries: stringArray(o.countries), dealTypes: objectOf(o.dealTypes) })),
    brands: Array.isArray(p.brands) ? (p.brands as Array<{ brand: string }>).filter((b) => b && typeof b.brand === "string") : [],
    bestContact: p.bestContact ?? best?.value ?? null,
    bestContactLabel: best?.label ?? null,
  };
}

/** Un B « parmi les mieux notés » : moitié haute de la plage B. */
export function isTopB(score: number, s: Pick<ScoreSettings, "tierA" | "tierB">): boolean {
  return score >= s.tierB + (s.tierA - s.tierB) / 2;
}

/** Dossiers enfilés sur les 7 derniers jours (événements SCORED marqués `dossierQueued`). */
export async function dossiersQueuedThisWeek(deps: ProspectionDeps, now: Date): Promise<number> {
  const rows = (await deps.prisma.prospectEvent.findMany({ where: { type: "SCORED", createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } })) as Array<{ payload: unknown }>;
  return rows.filter((r) => objectOf(r.payload).dossierQueued === true).length;
}

export async function scoreAndStore(deps: ProspectionDeps, prospectId: string): Promise<ScoreResult & { dossierQueued: boolean }> {
  const now = prospectionNow(deps);
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as ProspectRow | null;
  if (!p) throw new Error(`Prospect introuvable : ${prospectId}`);
  const [offers, contacts, settings] = await Promise.all([activeOffers(deps), contactsOf(deps, prospectId), loadScoreSettings(deps)]);
  const result = scoreProspect(scoreInputOf(p, offers, contacts), settings);

  const keepStatus = CLIENT_PIPELINE_STATUSES.includes(p.status);
  const status: ProspectStatus = keepStatus ? p.status : result.status;
  const statusChanged = status !== p.status;

  let dossierQueued = false;
  const wantsDossier = !p.dossier && !keepStatus && result.status === "QUALIFIED" && (result.tier === "A" || (result.tier === "B" && isTopB(result.score, settings)));
  if (wantsDossier && deps.prospection?.enqueue) {
    const cap = await numberSetting(deps, PROSPECTION_SETTINGS.dossierWeeklyCap.key, PROSPECTION_SETTINGS.dossierWeeklyCap.value);
    if ((await dossiersQueuedThisWeek(deps, now)) < cap) {
      await deps.prospection.enqueue({ type: "prospection.dossier", prospectId }, { jobId: `prospection-dossier-${prospectId}` });
      dossierQueued = true;
    }
  }

  await deps.prisma.prospect.update({
    where: { id: prospectId },
    data: {
      score: result.score,
      scoreBreakdown: result.breakdown,
      tier: result.tier,
      tierReason: result.tierReason,
      matchedOfferId: result.matchedOfferId,
      status,
      ...(statusChanged ? { statusChangedAt: now } : {}),
    },
  });
  await deps.prisma.prospectEvent.create({
    data: {
      prospectId,
      type: "SCORED",
      payload: { score: result.score, tier: result.tier, status, previousStatus: p.status, caps: result.caps, dossierQueued, by: "system" },
      createdAt: now,
    },
  });
  return { ...result, status: result.status, dossierQueued };
}
