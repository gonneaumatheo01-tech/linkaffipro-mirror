/**
 * Médiathèque de l'équipe Casino : format tiré du mélange du jour du canal (2 vidéos, 1 image, 1 texte par défaut),
 * thème du jour du canal (rotation pondérée par les poids du plan et par les résultats de l'équipe Algorithme), puis le
 * média FOURNI par le client le moins récemment utilisé (jamais republié sur ce canal avant 30 jours, jamais le même
 * jour sur un autre canal). Replis en cascade : autre thème du canal → image → texte, journalisés (`Event`
 * `agents.casino.fallback`) et comptés dans le rapport du matin. Jamais de média produit par l'IA. Le stock est
 * contrôlé après chaque choix (demande groupée, alerte).
 */
import { agentEvent } from "../../admin/journal";
import { casinoAttempts, casinoDayFormat, casinoMix, CASINO_DEFAULT_MIX, CASINO_FALLBACK_EVENT, type CasinoFallback } from "../../casino/format";
import { casinoThemesOf, loadCasinoAssets, loadUsages } from "../../casino/data";
import { pickCasinoAsset, type CasinoUsage } from "../../casino/pick";
import { runCasinoStockCheck } from "../../casino/requests";
import { pickDayTheme, themeFactors, themeTryOrder, type WeightedTheme } from "../../casino/rotation";
import { parseCasinoSettings } from "../../casino/settings";
import { parsePayload } from "../../missions/mission";
import { addDaysToDay, parisDay } from "../../rules/time";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { loadPlan, type PlanInfo } from "../data";
import { missionExperimentOf } from "../experimentation/variants";
import type { MediaFormat } from "./pick";

export { CASINO_FALLBACK_EVENT };
const ACTIVE = ["PENDING", "RUNNING", "WAITING_VALIDATION", "WAITING_HUMAN"] as const;
/** Jours d'historique des thèmes du jour et des résultats mesurés. */
const HISTORY_DAYS = 30;
const INSIGHT_DAYS = 60;

const isFormat = (f: unknown): f is MediaFormat => f === "video" || f === "photo" || f === "text";

export function casinoFallbacksOf(payload: Record<string, unknown>): CasinoFallback[] {
  return Array.isArray(payload.fallbacks) ? (payload.fallbacks as CasinoFallback[]).filter((f) => f && typeof f === "object" && "fromTheme" in f) : [];
}

/** Mélange d'une mission casino : celui d'un test A/B « mélange » en cours, sinon celui du plan (défaut casino). */
function missionMix(plan: PlanInfo, mission: Mission) {
  // Phase 33 : un ordre de Kevin sur le canal Test donne son mélange (`orderPlan.mix`, déjà dans le plan).
  if (plan.test && !(mission.payload.orderPlan as { mix?: unknown } | undefined)?.mix) return CASINO_DEFAULT_MIX;
  const e = missionExperimentOf(mission.payload as Record<string, unknown>);
  return e?.kind === "MELANGE" && e.config.mix ? plan.mix : casinoMix(plan.rawMix ?? null);
}

async function plannedToday(ctx: AgentContext, mission: Mission): Promise<MediaFormat[]> {
  if (!mission.channelId) return [];
  const rows = await ctx.prisma.agentMission.findMany({
    // Jour du plan (posé à la création avec l'horloge des agents), pas l'heure d'écriture en base.
    where: { channelId: mission.channelId, id: { not: mission.id }, status: { notIn: ["CANCELLED", "FAILED"] }, planDay: parisDay(ctx.now()) },
    select: { payload: true },
  });
  return rows.map((r) => parsePayload(r.payload)).map((p) => p.plannedFormat ?? p.format).filter(isFormat);
}

/** Thème du jour du canal : celui déjà retenu aujourd'hui par une autre mission, sinon la rotation pondérée. */
async function dayThemeFor(ctx: AgentContext, mission: Mission, themes: readonly WeightedTheme[]): Promise<string | null> {
  if (!themes.length || !mission.channelId) return themes[0]?.theme ?? null;
  const now = ctx.now();
  const today = parisDay(now);
  const rows = await ctx.prisma.agentMission.findMany({
    where: { channelId: mission.channelId, teamKey: "casino", id: { not: mission.id }, planDay: { gte: addDaysToDay(today, -HISTORY_DAYS) } },
    orderBy: { createdAt: "desc" },
    select: { payload: true, planDay: true, createdAt: true },
  });
  const known = new Set(themes.map((t) => t.theme));
  const byDay = new Map<string, string>();
  for (const r of rows) {
    const p = parsePayload(r.payload);
    const day = r.planDay ?? parisDay(r.createdAt);
    if (typeof p.dayTheme === "string" && !byDay.has(day)) byDay.set(day, p.dayTheme);
  }
  const current = byDay.get(today);
  if (current && known.has(current)) return current;
  const history = [...byDay.entries()].filter(([d]) => d !== today).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, t]) => t);
  const insights = await ctx.prisma.postInsight.findMany({
    where: { channelId: mission.channelId, sentAt: { gte: new Date(now.getTime() - INSIGHT_DAYS * 86_400_000) } },
    select: { theme: true, views24h: true, viewsFinal: true },
  });
  const factors = themeFactors(insights.map((i) => ({ theme: i.theme, views: i.views24h ?? i.viewsFinal })));
  return pickDayTheme(themes, history, factors);
}

/** Médias réservés par les autres missions en cours (comptés comme utilisés aujourd'hui sur leur canal). */
async function reservations(ctx: AgentContext, mission: Mission): Promise<CasinoUsage[]> {
  const rows = await ctx.prisma.agentMission.findMany({
    where: { id: { not: mission.id }, teamKey: "casino", status: { in: [...ACTIVE] } },
    select: { payload: true, channelId: true },
  });
  const now = ctx.now();
  return rows
    .map((r) => ({ p: parsePayload(r.payload), channelId: r.channelId }))
    .filter((r) => typeof r.p.mediaAssetId === "string" && r.channelId)
    .map((r) => ({ assetId: r.p.mediaAssetId as string, channelId: r.channelId!, usedAt: now }));
}

export async function runCasinoMediatheque(mission: Mission, ctx: AgentContext): Promise<AgentResult> {
  const p = mission.payload;
  if (p.casinoPicked === true)
    return { ok: true, skipped: p.format === "text", output: {}, summary: p.mediaAssetId ? `média ${p.mediaAssetId} déjà choisi` : "post texte" };
  const settings = parseCasinoSettings(ctx.settings.settings);
  const plan = await loadPlan(ctx.prisma, mission);
  const planThemes = plan.test && !(p.orderPlan as { themes?: unknown } | undefined)?.themes ? [] : casinoThemesOf(plan.themeWeights ?? plan.themes);
  const themes = planThemes.length ? planThemes : settings.themes.map((theme) => ({ theme, weight: 1 }));
  const planned: MediaFormat = isFormat(p.plannedFormat) ? p.plannedFormat : isFormat(p.format) ? p.format : casinoDayFormat(missionMix(plan, mission), await plannedToday(ctx, mission));
  const forced = typeof p.theme === "string" && p.theme ? p.theme : null;
  const dayTheme = forced ?? (await dayThemeFor(ctx, mission, themes));
  const order = themeTryOrder(dayTheme, themes);
  const base = { plannedFormat: planned, dayTheme, casinoPicked: true };

  let chosen: { format: MediaFormat; theme: string | null; assetId: string | null } | null = null;
  if (planned !== "text" && mission.channelId) {
    const assets = await loadCasinoAssets(ctx.prisma);
    const usages = [...(await loadUsages(ctx.prisma, assets.map((a) => a.id))), ...(await reservations(ctx, mission))];
    for (const a of casinoAttempts(planned, order)) {
      if (a.format === "text") break;
      const id = a.theme ? pickCasinoAsset(assets, usages, { channelId: mission.channelId, now: ctx.now(), rotationDays: settings.rotationDays, theme: a.theme, kind: a.format }) : null;
      if (id) {
        chosen = { format: a.format, theme: a.theme, assetId: id };
        break;
      }
    }
  }
  if (!chosen) chosen = { format: "text", theme: dayTheme, assetId: null };

  const fallbacks = casinoFallbacksOf(p as Record<string, unknown>);
  if (chosen.format !== planned || chosen.theme !== dayTheme) {
    const reason =
      chosen.format === planned
        ? `plus de ${planned === "video" ? "vidéo" : "image"} disponible en ${dayTheme}`
        : `aucune ${planned === "video" ? "vidéo" : "image"} disponible${chosen.format === "text" ? " sur les thèmes du canal" : ` en ${dayTheme}`}`;
    const entry: CasinoFallback = { from: planned, to: chosen.format, fromTheme: dayTheme, toTheme: chosen.theme, reason, at: ctx.now().toISOString() };
    fallbacks.push(entry);
    await agentEvent(ctx, CASINO_FALLBACK_EVENT, { missionId: mission.id, from: planned, to: chosen.format, fromTheme: dayTheme, toTheme: chosen.theme, reason }, { channelId: mission.channelId });
  }
  // Après le choix (réservation visible des autres missions) : demande groupée et alerte si un thème manque.
  if (!mission.isTest) await runCasinoStockCheck(ctx);

  const output = { ...base, format: chosen.format, theme: chosen.theme, mediaAssetId: chosen.assetId, fallbacks };
  const label = chosen.format === "video" ? "vidéo" : chosen.format === "photo" ? "image" : "post texte";
  const fell = fallbacks.length > casinoFallbacksOf(p as Record<string, unknown>).length ? ` (repli : ${fallbacks.at(-1)!.reason})` : "";
  return { ok: true, skipped: chosen.format === "text", output, summary: `${label}${chosen.theme ? ` ${chosen.theme}` : ""}${chosen.assetId ? ` ${chosen.assetId}` : ""}${fell}` };
}
