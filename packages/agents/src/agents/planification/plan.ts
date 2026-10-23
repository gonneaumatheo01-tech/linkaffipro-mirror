/**
 * Calcul du créneau d'une mission (lu en base, décidé par `rules/slots.ts`) ; partagé par Planification et par
 * Publication (créneau dépassé après une validation tardive).
 */
import { parsePayload } from "../../missions/mission";
import { pickSlot, preferredFromBestHours, preferredKey, VIDEO_MIN_GAP_MINUTES, type SlotResult } from "../../rules/slots";
import { missionExperimentOf } from "../experimentation/variants";
import type { AgentContext, Mission } from "../../types";
import { loadPlan } from "../data";

const DAY = 86_400_000;

export async function planSlot(mission: Mission, ctx: AgentContext): Promise<SlotResult> {
  const now = ctx.now();
  const plan = await loadPlan(ctx.prisma, mission);
  const notBefore = typeof mission.payload.notBefore === "string" ? new Date(mission.payload.notBefore) : null;
  if (plan.test) return pickSlot({ now, notBefore, plan, leadMinutes: 1, stepMinutes: 1 });
  const channelId = mission.channelId;
  if (!channelId) return { ok: false, reason: "Mission sans canal." };
  const from = new Date(now.getTime() - DAY);
  const to = new Date(now.getTime() + 9 * DAY);
  const [posts, missions, best] = await Promise.all([
    ctx.prisma.post.findMany({
      where: {
        channelId,
        isTemplate: false,
        status: { in: ["SCHEDULED", "SENDING", "SENT"] },
        OR: [{ scheduledAt: { gte: from, lte: to } }, { sentAt: { gte: from, lte: to } }],
      },
      select: { scheduledAt: true, sentAt: true, agentMissionId: true, mediaAssetIds: true },
    }),
    ctx.prisma.agentMission.findMany({
      where: {
        channelId,
        id: { not: mission.id },
        status: { notIn: ["CANCELLED", "FAILED", "BLOCKED_BUDGET"] },
        scheduledFor: { gte: from, lte: to },
      },
      select: { scheduledFor: true, payload: true },
    }),
    ctx.prisma.setting.findUnique({ where: { key: `besthours.${channelId}` } }),
  ]);
  const occupied = posts
    .filter((p) => !p.agentMissionId || p.agentMissionId !== mission.id)
    .map((p) => p.sentAt ?? p.scheduledAt)
    .filter((d): d is Date => d instanceof Date);
  const agentSlots = missions.map((m) => m.scheduledFor).filter((d): d is Date => d instanceof Date);
  const extraSpacing = mission.payload.format === "video" ? [{ times: await videoTimes(ctx, posts, missions, mission.id), minutes: VIDEO_MIN_GAP_MINUTES }] : [];
  return pickSlot({
    extraSpacing,
    now,
    notBefore,
    plan,
    quietHours: ctx.settings.quietHours,
    occupied,
    agentSlots,
    preferred: preferredForMission(preferredFromBestHours(best?.value), plan.suggestedWindows, mission),
  });
}

const FORMAT_OF: Record<string, string> = { video: "VIDEO", photo: "PHOTO", text: "TEXT" };

/**
 * Préférences horaires d'une mission (pur, phase 21) : meilleurs horaires historiques, plus le score des fenêtres de
 * l'agent Horaires (toutes confondues ou du type de la mission), et l'heure de la variante d'un test « horaire » en
 * cours, toujours préférée dans la fenêtre du plan.
 */
export function preferredForMission(base: Map<string, number>, windows: readonly unknown[] | undefined, mission: Pick<Mission, "payload">): Map<string, number> {
  const out = new Map(base);
  const format = FORMAT_OF[mission.payload.format ?? ""] ?? null;
  for (const raw of windows ?? []) {
    const w = raw as { day?: unknown; start?: unknown; end?: unknown; score?: unknown; format?: unknown };
    if (typeof w.day !== "number" || typeof w.start !== "string" || typeof w.end !== "string") continue;
    if (w.format !== undefined && w.format !== format) continue;
    const a = Number(w.start.slice(0, 2));
    const b = w.end === "24:00" ? 24 : Number(w.end.slice(0, 2));
    const score = typeof w.score === "number" ? w.score : 0;
    for (let h = a; h < b; h++) out.set(preferredKey(w.day, h), (out.get(preferredKey(w.day, h)) ?? 0) + score);
  }
  const exp = missionExperimentOf(mission.payload as Record<string, unknown>);
  if (exp?.kind === "HORAIRE" && exp.config.hour !== undefined)
    for (let d = 1; d <= 7; d++) out.set(preferredKey(d, exp.config.hour), 1000);
  return out;
}

/** Heures des vidéos du canal : posts programmés ou envoyés avec une vidéo, et missions vidéo des agents. */
async function videoTimes(
  ctx: AgentContext,
  posts: ReadonlyArray<{ scheduledAt: Date | null; sentAt: Date | null; agentMissionId: string | null; mediaAssetIds: unknown }>,
  missions: ReadonlyArray<{ scheduledFor: Date | null; payload: unknown }>,
  missionId: string,
): Promise<Date[]> {
  const out: Date[] = [];
  for (const m of missions) if (m.scheduledFor && parsePayload(m.payload).format === "video") out.push(m.scheduledFor);
  const withMedia = posts.filter((p) => p.agentMissionId !== missionId && Array.isArray(p.mediaAssetIds) && p.mediaAssetIds.length);
  const ids = [...new Set(withMedia.flatMap((p) => p.mediaAssetIds as string[]))];
  if (!ids.length) return out;
  const assets = await ctx.prisma.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true } });
  const videos = new Set(assets.filter((a) => a.mimeType.startsWith("video/")).map((a) => a.id));
  for (const p of withMedia) {
    const at = p.sentAt ?? p.scheduledAt;
    if (at && (p.mediaAssetIds as string[]).some((id) => videos.has(id))) out.push(at);
  }
  return out;
}
