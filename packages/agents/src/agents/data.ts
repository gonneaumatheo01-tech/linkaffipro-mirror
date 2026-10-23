/**
 * Lectures communes des agents (requêtes à plat, sans relation : même code en base réelle et dans le faux client des
 * tests) : canal visé, plan du canal, canal Test, derniers textes du canal, persona.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { parsePayload } from "../missions/mission";
import { DEFAULT_SLOT_PLAN } from "../rules/slots";
import type { Mission } from "../types";

export type ChannelInfo = {
  id: string;
  title: string;
  vertical: string | null;
  language: string;
  type: string;
  isTest: boolean;
};

export type PlanInfo = {
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  minSpacingMinutes: number;
  mix: { video: number; photo: number; text: number };
  personaId: string | null;
  campaignId: string | null;
  themes: string[];
  /** Mission de test : créneau au plus tôt, sans quota ni heures calmes. */
  test: boolean;
};

const channelSelect = { id: true, title: true, vertical: true, language: true, type: true, isTest: true } as const;

export async function loadChannel(prisma: PrismaClient, id: string | null): Promise<ChannelInfo | null> {
  if (!id) return null;
  return (await prisma.channel.findUnique({ where: { id }, select: channelSelect })) as ChannelInfo | null;
}

/** Canal Test (`Channel.isTest`, actif, le plus ancien) : destination de toute publication en simulation. */
export async function findTestChannel(prisma: PrismaClient): Promise<ChannelInfo | null> {
  return (await prisma.channel.findFirst({
    where: { isTest: true, isActive: true },
    orderBy: { createdAt: "asc" },
    select: channelSelect,
  })) as ChannelInfo | null;
}

function parseMix(v: unknown): PlanInfo["mix"] {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
  const mix = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return mix.video + mix.photo + mix.text > 0 ? mix : { video: 0, photo: 0, text: 1 };
}

export const TEST_PLAN: PlanInfo = {
  postsPerDay: 1000,
  windowStart: "00:00",
  windowEnd: "24:00",
  minSpacingMinutes: 0,
  mix: { video: 0, photo: 0, text: 1 },
  personaId: null,
  campaignId: null,
  themes: [],
  test: true,
};

/** Plan du canal visé ; mission de test ou canal sans plan : valeurs par défaut (test : créneau au plus tôt). */
export async function loadPlan(prisma: PrismaClient, mission: Pick<Mission, "channelId" | "isTest">): Promise<PlanInfo> {
  if (mission.isTest) return TEST_PLAN;
  const row = mission.channelId
    ? await prisma.channelAgentPlan.findUnique({ where: { channelId: mission.channelId } })
    : null;
  if (!row) return { ...DEFAULT_SLOT_PLAN, mix: { video: 0, photo: 0, text: 1 }, personaId: null, campaignId: null, themes: [], test: false };
  return {
    postsPerDay: row.postsPerDay,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    minSpacingMinutes: row.minSpacingMinutes,
    mix: parseMix(row.mix),
    personaId: row.personaId,
    campaignId: row.campaignId,
    themes: Array.isArray(row.themes) ? row.themes.filter((t): t is string => typeof t === "string") : [],
    test: false,
  };
}

export const RECENT_POSTS_LIMIT = 30;

/**
 * Derniers textes du canal (30 au plus, du plus récent au plus ancien) : posts programmés ou envoyés sur le canal, et
 * textes des missions d'agent qui le visaient (publiées sur le canal Test en simulation). Sert à ne pas se répéter.
 */
export async function recentChannelTexts(
  prisma: PrismaClient,
  channelId: string | null,
  excludeMissionId?: string,
  limit = RECENT_POSTS_LIMIT,
): Promise<string[]> {
  if (!channelId) return [];
  const [posts, missions] = await Promise.all([
    prisma.post.findMany({
      where: { channelId, isTemplate: false, status: { in: ["SCHEDULED", "SENDING", "SENT"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { text: true, createdAt: true, agentMissionId: true },
    }),
    prisma.agentMission.findMany({
      where: { channelId, status: "DONE", ...(excludeMissionId ? { id: { not: excludeMissionId } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, payload: true, createdAt: true },
    }),
  ]);
  const items: { at: number; text: string }[] = [];
  for (const p of posts) if (p.text && p.agentMissionId !== excludeMissionId) items.push({ at: p.createdAt.getTime(), text: p.text });
  for (const m of missions) {
    const t = parsePayload(m.payload).text;
    if (typeof t === "string" && t) items.push({ at: m.createdAt.getTime(), text: t });
  }
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.at - a.at)
    .filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)))
    .slice(0, limit)
    .map((i) => i.text);
}

export type PersonaInfo = { id: string; name: string; tone: string; personality: string; styleExamples: string | null };

export async function loadPersona(prisma: PrismaClient, id: string | null): Promise<PersonaInfo | null> {
  if (!id) return null;
  return (await prisma.persona.findUnique({
    where: { id },
    select: { id: true, name: true, tone: true, personality: true, styleExamples: true },
  })) as PersonaInfo | null;
}
