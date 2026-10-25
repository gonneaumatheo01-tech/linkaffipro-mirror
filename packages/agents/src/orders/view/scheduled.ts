/**
 * Phase 33, chantier C — « qu'est-ce qui est programmé ? » : missions et posts déjà créés pour la période (heure,
 * état, aperçu du texte en 200 caractères, média). Lecture seule ; les vignettes ne partent que si on les demande
 * (`withMedia`, envoyées par Kevin après sa réponse).
 */
import { nowOf } from "../../admin/journal";
import { parsePayload, parseSteps } from "../../missions/mission";
import { addDaysToDay, parisDay } from "../../rules/time";
import { frOdds } from "../../sports/labels";
import { AGENT_LABELS, isAgentKey, type AgentsDeps, type TeamKey } from "../../types";
import { dayLabel, hourLabel, plainPreview, slotRange, type DaySlot, type ViewResult } from "./common";

export type ViewScheduledInput = {
  channelId?: string | null;
  teamKey?: TeamKey | null;
  personaId?: string | null;
  day?: string | null;
  days?: number | null;
  slot?: DaySlot | null;
  withMedia?: boolean;
};

export type ScheduledItem = {
  missionId: string | null;
  postId: string | null;
  channelId: string | null;
  channel: string;
  teamKey: string | null;
  day: string;
  at: string | null;
  state: string;
  /** Aperçu du texte (200 caractères au plus). */
  text: string;
  mediaAssetId: string | null;
  format: string | null;
};

type MissionRow = {
  id: string;
  teamKey: string;
  kind: string;
  channelId: string | null;
  status: string;
  currentStep: number;
  steps: unknown;
  payload: unknown;
  scheduledFor: Date | null;
  planDay: string | null;
  postId: string | null;
  lastError: string | null;
};
type PostRow = { id: string; channelId: string; status: string; scheduledAt: Date | null; sentAt: Date | null; text: string; mediaAssetIds: unknown; agentMissionId: string | null; isTemplate: boolean };
type PickRow = { id: string; missionId: string | null; homeTeam: string; awayTeam: string; selectionLabel: string; odds: number; status: string };

const MISSION_STATE: Record<string, string> = {
  PENDING: "en préparation",
  RUNNING: "en préparation",
  WAITING_VALIDATION: "attend ta validation",
  WAITING_HUMAN: "attend une réponse",
  DONE: "terminé",
  FAILED: "raté",
  BLOCKED_BUDGET: "bloqué par le plafond du mois",
};

/** État lisible d'un post ou d'une mission (pur). */
export function stateLabel(m: Pick<MissionRow, "status" | "currentStep" | "steps" | "payload"> | null, post: Pick<PostRow, "status" | "scheduledAt" | "sentAt"> | null): string {
  if (post) {
    if (post.status === "SENT" && post.sentAt) return `parti à ${hourLabel(post.sentAt)}`;
    if (post.status === "SENDING") return "en cours d'envoi";
    if (post.status === "SCHEDULED" && post.scheduledAt) return `programmé à ${hourLabel(post.scheduledAt)}`;
    if (post.status === "FAILED") return "envoi raté";
    if (post.status === "CANCELLED" || post.status === "DELETED") return "annulé";
  }
  if (!m) return "brouillon";
  if (m.status === "PENDING" || m.status === "RUNNING") {
    const agent = parseSteps(m.steps)[m.currentStep]?.agent;
    return agent && isAgentKey(agent) ? `en préparation (chez ${AGENT_LABELS[agent]})` : "en préparation";
  }
  if (m.status === "DONE" && parsePayload(m.payload).noPick === true) return "aucun pari retenu";
  return MISSION_STATE[m.status] ?? m.status.toLowerCase();
}

function firstMedia(v: unknown): string | null {
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

export async function viewScheduled(deps: AgentsDeps, input: ViewScheduledInput = {}): Promise<ViewResult & { items: ScheduledItem[] }> {
  const now = nowOf(deps);
  const first = input.day ?? parisDay(now);
  const n = Math.max(1, Math.min(7, Math.round(input.days ?? 1)));
  const days = Array.from({ length: n }, (_, i) => addDaysToDay(first, i));
  let channelIds: string[] | null = input.channelId ? [input.channelId] : null;
  if (input.personaId) {
    const plans = (await deps.prisma.channelAgentPlan.findMany({ where: { personaId: input.personaId }, select: { channelId: true } })) as Array<{ channelId: string }>;
    const ids = plans.map((p) => p.channelId);
    channelIds = channelIds ? channelIds.filter((id) => ids.includes(id)) : ids;
  }
  const missions = (await deps.prisma.agentMission.findMany({
    where: {
      planDay: { in: days },
      status: { not: "CANCELLED" },
      ...(channelIds ? { channelId: { in: channelIds } } : {}),
      ...(input.teamKey ? { teamKey: input.teamKey } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  })) as MissionRow[];
  const missionPosts = missions.map((m) => m.postId).filter((x): x is string => !!x);
  const range = { from: slotRange(days[0]!, null).from, to: slotRange(days[days.length - 1]!, null).to };
  const [posts, otherPosts, picks] = await Promise.all([
    missionPosts.length ? (deps.prisma.post.findMany({ where: { id: { in: missionPosts } } }) as Promise<PostRow[]>) : Promise.resolve([] as PostRow[]),
    // Posts programmés à la main sur ce canal (hors agents) : seulement pour un canal précis.
    channelIds && !input.teamKey
      ? (deps.prisma.post.findMany({
          where: { channelId: { in: channelIds }, isTemplate: false, agentMissionId: null, status: { in: ["SCHEDULED", "SENDING", "SENT"] }, OR: [{ scheduledAt: { gte: range.from, lt: range.to } }, { sentAt: { gte: range.from, lt: range.to } }] },
          take: 50,
        }) as Promise<PostRow[]>)
      : Promise.resolve([] as PostRow[]),
    missions.some((m) => m.kind === "BET") ? (deps.prisma.bettingPick.findMany({ where: { missionId: { in: missions.map((m) => m.id) } } }) as Promise<PickRow[]>) : Promise.resolve([] as PickRow[]),
  ]);
  const postById = new Map(posts.map((p) => [p.id, p]));
  const pickByMission = new Map(picks.map((p) => [p.missionId, p]));
  const allChannelIds = [...new Set([...missions.map((m) => m.channelId), ...otherPosts.map((p) => p.channelId)].filter((x): x is string => !!x))];
  const channels = allChannelIds.length ? ((await deps.prisma.channel.findMany({ where: { id: { in: allChannelIds } }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>) : [];
  const title = new Map(channels.map((c) => [c.id, c.title]));

  const items: ScheduledItem[] = [];
  for (const m of missions) {
    const post = m.postId ? (postById.get(m.postId) ?? null) : null;
    const payload = parsePayload(m.payload);
    const pick = pickByMission.get(m.id);
    const at = post?.sentAt ?? post?.scheduledAt ?? m.scheduledFor ?? null;
    const text = pick ? `${pick.homeTeam} - ${pick.awayTeam} · ${pick.selectionLabel} à ${frOdds(pick.odds)}` : plainPreview(post?.text || String(payload.text ?? ""), 200);
    items.push({
      missionId: m.id,
      postId: post?.id ?? null,
      channelId: m.channelId,
      channel: m.channelId ? (title.get(m.channelId) ?? "canal") : "sans canal",
      teamKey: m.teamKey,
      day: m.planDay ?? parisDay(at ?? now),
      at: at ? at.toISOString() : null,
      state: stateLabel(m, post),
      text,
      mediaAssetId: firstMedia(post?.mediaAssetIds) ?? (typeof payload.mediaAssetId === "string" ? payload.mediaAssetId : null),
      format: typeof payload.format === "string" ? payload.format : null,
    });
  }
  for (const p of otherPosts) {
    const at = p.sentAt ?? p.scheduledAt;
    items.push({ missionId: null, postId: p.id, channelId: p.channelId, channel: title.get(p.channelId) ?? "canal", teamKey: null, day: parisDay(at ?? now), at: at ? at.toISOString() : null, state: stateLabel(null, p), text: plainPreview(p.text, 200), mediaAssetId: firstMedia(p.mediaAssetIds), format: null });
  }
  const slotted = input.slot
    ? items.filter((i) => {
        if (!i.at) return false;
        const r = slotRange(i.day, input.slot!);
        const t = new Date(i.at).getTime();
        return t >= r.from.getTime() && t < r.to.getTime();
      })
    : items;
  slotted.sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));
  const mediaAssetIds = input.withMedia ? [...new Set(slotted.map((i) => i.mediaAssetId).filter((x): x is string => !!x))].slice(0, 3) : undefined;
  return { facts: { jours: days, moment: input.slot ?? null, total: slotted.length, posts: slotted }, lines: scheduledLines(slotted, now, days, input), items: slotted, ...(mediaAssetIds ? { mediaAssetIds } : {}) };
}

/** Lignes de Kevin (pures). L'aperçu est raccourci à 110 caractères dans la ligne (200 dans les faits). */
export function scheduledLines(items: readonly ScheduledItem[], now: Date, days: readonly string[], input: Pick<ViewScheduledInput, "slot"> = {}): string[] {
  const when = days.length === 1 ? dayLabel(days[0]!, now) : `du ${days[0]!.slice(8, 10)}/${days[0]!.slice(5, 7)} au ${days[days.length - 1]!.slice(8, 10)}/${days[days.length - 1]!.slice(5, 7)}`;
  const moment = input.slot ? ` (${input.slot === "apres-midi" ? "après-midi" : input.slot})` : "";
  if (!items.length) return [`Rien de programmé ${when}${moment} pour le moment.`];
  const lines = [`${items.length} ${items.length > 1 ? "posts" : "post"} ${when}${moment} :`];
  const multi = new Set(items.map((i) => i.channelId)).size > 1;
  for (const i of items) {
    const head = [i.at ? hourLabel(new Date(i.at)) : null, multi ? i.channel : null, i.state].filter(Boolean).join(" · ");
    const text = i.text ? ` : « ${plainPreview(i.text, 110)} »` : "";
    lines.push(`${head}${text}${i.mediaAssetId ? " (avec média)" : ""}`);
  }
  return lines;
}
