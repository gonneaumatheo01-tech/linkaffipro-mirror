/**
 * Phase 27, chantier B : analyse d'un canal de référence. `computeAnalysis` est pur (rythme, forme, fond, résultats,
 * heures de pointe, citations de 10 mots au plus, règles du client vues chez eux) ; `analyzeReference` lit les
 * `ReferencePost` (les mesures restent après l'effacement du texte) et refuse sous 20 posts. Aucun réglage n'est touché.
 */
import type { AgentsDeps } from "../../types";
import { loadTeamSettings } from "../../missions/settings";
import { INSPIRATION_LIMITS, type InspirationAnalysis, type InspirationUniverse } from "../contract";
import { shortQuote } from "../copy-check";
import { contentMeasures, flaggedOf } from "./content";
import { formMeasures } from "./form";
import { fromReferencePost, type ReferencePostRow } from "./normalize";
import { resultsMeasures } from "./results";
import { rhythmMeasures } from "./rhythm";
import type { AnalysisPost } from "./types";

export const QUOTE_COUNT = 3;

export function isInspirationUniverse(v: unknown): v is InspirationUniverse {
  return v === "dating" || v === "casino" || v === "sports";
}

/** 3 citations courtes (10 mots au plus, sans lien ni @nom) des posts les plus vus ; jamais une annonce de gains. */
export function quotesOf(posts: readonly AnalysisPost[], count = QUOTE_COUNT): string[] {
  const usable = posts.filter((p) => p.text && !p.gainClaim && !p.aiMention);
  const ranked = [...usable].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.postedAt.getTime() - b.postedAt.getTime());
  const out: string[] = [];
  for (const p of ranked) {
    const clean = p
      .text!.replace(/https?:\/\/\S+|t\.me\/\S+|www\.\S+|@\w+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    const q = shortQuote(clean);
    if (!out.includes(q)) out.push(q);
    if (out.length >= count) break;
  }
  return out;
}

export type ComputeOptions = {
  referenceChannelId: string;
  universe: InspirationUniverse;
  forbiddenWords?: readonly string[];
  /** Jours couverts imposés (canal du client : les 28 jours de Paris de la fenêtre). */
  days?: readonly string[];
};

/** Analyse pure d'une liste de posts (tous les chiffres viennent d'ici). */
export function computeAnalysis(posts: readonly AnalysisPost[], opts: ComputeOptions): InspirationAnalysis {
  const rhythm = rhythmMeasures(posts, opts.days ? { days: opts.days, spanDays: opts.days.length } : {});
  return {
    referenceChannelId: opts.referenceChannelId,
    universe: opts.universe,
    sampleSize: posts.length,
    rhythm: rhythm.measures,
    form: formMeasures(posts),
    content: contentMeasures(posts, opts.universe),
    results: resultsMeasures(posts),
    peakSlots: rhythm.peakSlots,
    quotes: quotesOf(posts),
    flagged: flaggedOf(posts, opts.universe, opts.forbiddenWords ?? []),
  };
}

const POST_SELECT = {
  externalId: true,
  postedAt: true,
  text: true,
  textPurgedAt: true,
  length: true,
  lines: true,
  emojiCount: true,
  mediaKind: true,
  views: true,
  hasLink: true,
  hasButton: true,
  hasPrice: true,
  hasOdds: true,
  hasVipCall: true,
  features: true,
} as const;

/** Référence active (non retirée) ou erreur claire. */
export async function loadReference(deps: AgentsDeps, referenceChannelId: string) {
  const ref = await deps.prisma.referenceChannel.findUnique({ where: { id: referenceChannelId } });
  if (!ref || ref.removedAt) throw new Error("Canal de référence introuvable ou retiré.");
  if (!isInspirationUniverse(ref.universe)) throw new Error(`Univers du canal de référence inconnu (${ref.universe}).`);
  return { ...ref, universe: ref.universe };
}

/** Posts analysés d'une référence, du plus ancien au plus récent. */
export async function loadReferencePosts(deps: AgentsDeps, referenceChannelId: string): Promise<AnalysisPost[]> {
  const rows = (await deps.prisma.referencePost.findMany({
    where: { referenceChannelId },
    orderBy: { postedAt: "asc" },
    select: POST_SELECT,
  })) as ReferencePostRow[];
  return rows.map(fromReferencePost);
}

export async function analyzeReference(
  deps: AgentsDeps,
  referenceChannelId: string,
): Promise<InspirationAnalysis | { tooFew: true; count: number }> {
  const ref = await loadReference(deps, referenceChannelId);
  const posts = await loadReferencePosts(deps, referenceChannelId);
  if (posts.length < INSPIRATION_LIMITS.minPostsForAnalysis) return { tooFew: true, count: posts.length };
  const team = await loadTeamSettings(deps.prisma, ref.universe);
  return computeAnalysis(posts, { referenceChannelId, universe: ref.universe, forbiddenWords: team.forbiddenWords });
}
