/**
 * Phase 27, chantier B : comparaison « eux / nous » avec un canal cible du client (même univers obligatoire). Mêmes
 * mesures, calculées par le même code sur les `Post` envoyés du canal sur les 28 derniers jours de Paris (vues :
 * `PostInsight`). Un écart « compte » s'il dépasse un seuil réglable (constantes ci-dessous, `Setting`
 * `inspiration.thresholds` facultatif). Aucun réglage n'est touché.
 */
import type { AgentsDeps } from "../../types";
import { postFormat, hasButtons, type AssetInfo } from "../../agents/posts/features";
import { addDaysToDay, parisDay, parisDayStart } from "../../rules/time";
import type { ChannelComparison, InspirationAnalysis, InspirationGap, Measure, ReferenceMediaKind } from "../contract";
import { loadTeamSettings } from "../../missions/settings";
import { computeAnalysis } from "./analyze";
import { fromClientPost } from "./normalize";
import { UNIVERSE_LABELS, UNIVERSE_OF_VERTICAL, type AnalysisPost } from "./types";

/** Fenêtre lue sur le canal du client. */
export const COMPARE_WINDOW_DAYS = 28;
export const INSPIRATION_THRESHOLDS_KEY = "inspiration.thresholds";

export type GapThresholds = {
  /** Écart relatif (part de la plus grande des deux valeurs) au-delà duquel un chiffre compte. */
  relative: number;
  /** Écart absolu minimal d'un chiffre non exprimé en % (évite « 0,1 contre 0,2 post par jour »). */
  minAbsolute: number;
  /** Écart en points pour une part (unité %). */
  sharePoints: number;
  /** Écart d'un coefficient de corrélation (de −1 à 1). */
  correlation: number;
  /** Seuil absolu propre à une mesure (prime sur les autres). */
  perKey: Record<string, number>;
};

export const DEFAULT_GAP_THRESHOLDS: Readonly<GapThresholds> = Object.freeze({
  relative: 0.3,
  minAbsolute: 0.5,
  sharePoints: 15,
  correlation: 0.3,
  perKey: {},
});

/** Mesures de détail non comparées une à une (histogrammes, meilleurs posts) ; les heures de pointe le sont à part. */
const DETAIL_KEY = /^(?:slot|weekday|best|worst)\.|^daysCovered$/;

function positive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Seuils : valeurs par défaut, remplacées par celles du réglage quand elles sont valides (pur). */
export function parseGapThresholds(v: unknown): GapThresholds {
  const r = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const perKey: Record<string, number> = {};
  const pk = r.perKey && typeof r.perKey === "object" ? (r.perKey as Record<string, unknown>) : {};
  for (const [k, x] of Object.entries(pk)) if (typeof x === "number" && Number.isFinite(x) && x >= 0) perKey[k] = x;
  return {
    relative: positive(r.relative, DEFAULT_GAP_THRESHOLDS.relative),
    minAbsolute: positive(r.minAbsolute, DEFAULT_GAP_THRESHOLDS.minAbsolute),
    sharePoints: positive(r.sharePoints, DEFAULT_GAP_THRESHOLDS.sharePoints),
    correlation: positive(r.correlation, DEFAULT_GAP_THRESHOLDS.correlation),
    perKey,
  };
}

export async function loadGapThresholds(deps: AgentsDeps): Promise<GapThresholds> {
  const row = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_THRESHOLDS_KEY } });
  return parseGapThresholds(row?.value);
}

/** L'écart entre deux chiffres compte-t-il ? (pur) */
export function gapMatters(m: Pick<Measure, "key" | "unit">, theirs: number, ours: number, t: GapThresholds = DEFAULT_GAP_THRESHOLDS): boolean {
  const diff = Math.abs(theirs - ours);
  if (m.key in t.perKey) return diff >= t.perKey[m.key]!;
  if (m.unit === "%") return diff >= t.sharePoints;
  if (m.key.startsWith("corr.")) return diff >= t.correlation;
  const base = Math.max(Math.abs(theirs), Math.abs(ours));
  return base > 0 && diff >= t.minAbsolute && diff / base >= t.relative;
}

const allMeasures = (a: InspirationAnalysis) => [...a.rhythm, ...a.form, ...a.content, ...a.results];

/** Tableau « eux / nous / écart » (pur). Les heures de pointe comptent si aucune tranche n'est commune. */
export function compareAnalyses(theirs: InspirationAnalysis, ours: InspirationAnalysis, t: GapThresholds = DEFAULT_GAP_THRESHOLDS): InspirationGap[] {
  const mine = new Map(allMeasures(ours).map((m) => [m.key, m]));
  const gaps: InspirationGap[] = [];
  gaps.push({
    key: "peakSlots",
    label: "Heures de pointe (Paris)",
    theirs: theirs.peakSlots.join(", ") || null,
    ours: ours.peakSlots.join(", ") || null,
    matters: theirs.peakSlots.length > 0 && ours.sampleSize > 0 && !theirs.peakSlots.some((s) => ours.peakSlots.includes(s)),
  });
  for (const m of allMeasures(theirs)) {
    if (DETAIL_KEY.test(m.key)) continue;
    const o = mine.get(m.key);
    const a = m.value;
    const b = o?.value ?? null;
    const matters = typeof a === "number" && typeof b === "number" && m.sampleSize > 0 && (o?.sampleSize ?? 0) > 0 && gapMatters(m, a, b, t);
    gaps.push({ key: m.key, label: m.label, theirs: a, ours: b, ...(m.unit ? { unit: m.unit } : {}), matters });
  }
  return gaps;
}

function mediaKindOfFormat(format: string): ReferenceMediaKind {
  return format === "VIDEO" ? "video" : format === "TEXT" ? "text" : "photo";
}

/** Posts envoyés du canal du client sur les 28 derniers jours de Paris (aujourd'hui compris). */
export async function loadClientPosts(deps: AgentsDeps, channelId: string, now: Date): Promise<{ posts: AnalysisPost[]; days: string[] }> {
  const today = parisDay(now);
  const days: string[] = [];
  for (let i = COMPARE_WINDOW_DAYS - 1; i >= 0; i--) days.push(addDaysToDay(today, -i));
  const since = parisDayStart(days[0]!);
  const rows = await deps.prisma.post.findMany({
    where: { channelId, isTemplate: false, status: "SENT", sentAt: { gte: since, lte: now } },
    orderBy: { sentAt: "asc" },
    select: { id: true, sentAt: true, text: true, mediaAssetIds: true, buttons: true },
  });
  const ids = rows.map((r) => r.id);
  const insights = ids.length
    ? await deps.prisma.postInsight.findMany({ where: { postId: { in: ids } }, select: { postId: true, format: true, viewsFinal: true, views24h: true } })
    : [];
  const byPost = new Map(insights.map((i) => [i.postId, i]));
  const assetIds = [...new Set(rows.flatMap((r) => (Array.isArray(r.mediaAssetIds) ? r.mediaAssetIds.filter((x): x is string => typeof x === "string") : [])))];
  const assets = assetIds.length
    ? await deps.prisma.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, mimeType: true, kind: true } })
    : [];
  const assetMap = new Map<string, AssetInfo>(assets.map((a) => [a.id, a as AssetInfo]));
  const posts = rows.map((r) => {
    const ins = byPost.get(r.id);
    const mediaIds = Array.isArray(r.mediaAssetIds) ? r.mediaAssetIds.filter((x): x is string => typeof x === "string") : [];
    const format = ins?.format ?? postFormat(mediaIds, assetMap);
    const views = ins ? (ins.views24h ?? (ins.viewsFinal > 0 ? ins.viewsFinal : null)) : null;
    return fromClientPost({ id: r.id, sentAt: r.sentAt ?? now, html: r.text ?? "", mediaKind: mediaKindOfFormat(format), views, hasButton: hasButtons(r.buttons) });
  });
  return { posts, days };
}

export async function compareWithChannel(deps: AgentsDeps, analysis: InspirationAnalysis, channelId: string): Promise<ChannelComparison> {
  const channel = await deps.prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, title: true, vertical: true } });
  if (!channel) throw new Error("Canal du client introuvable.");
  const universe = channel.vertical ? UNIVERSE_OF_VERTICAL[channel.vertical] : undefined;
  if (universe !== analysis.universe)
    throw new Error(
      `Univers différent : le canal exemple est ${UNIVERSE_LABELS[analysis.universe]}, « ${channel.title} » est ${universe ? UNIVERSE_LABELS[universe] : "sans univers"}. Choisis un canal ${UNIVERSE_LABELS[analysis.universe]}.`,
    );
  const now = (deps.now ?? (() => new Date()))();
  const [{ posts, days }, thresholds, team] = await Promise.all([
    loadClientPosts(deps, channelId, now),
    loadGapThresholds(deps),
    loadTeamSettings(deps.prisma, universe),
  ]);
  const ours = computeAnalysis(posts, { referenceChannelId: analysis.referenceChannelId, universe, forbiddenWords: team.forbiddenWords, days });
  return { channelId, channelTitle: channel.title, gaps: compareAnalyses(analysis, ours, thresholds), ourSampleSize: posts.length };
}
