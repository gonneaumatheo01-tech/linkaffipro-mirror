/**
 * Lectures communes des agents (requêtes à plat, sans relation : même code en base réelle et dans le faux client des
 * tests) : canal visé, plan du canal, canal Test, derniers textes du canal, persona.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { parsePayload } from "../missions/mission";
import { DEFAULT_SLOT_PLAN } from "../rules/slots";
import type { Mission } from "../types";
import { missionExperimentOf } from "./experimentation/variants";
import { parsePlanThemes, type WeightedTheme } from "../casino/rotation";

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
  /** Thèmes avec leur poids (phase 22 : `[{ theme, weight }]`, ancien `string[]` = poids 1). */
  themeWeights?: WeightedTheme[];
  /** Mélange brut du plan (avant le repli « texte seul ») : l'équipe Casino applique son mélange par défaut. */
  rawMix?: { video: number; photo: number; text: number } | null;
  /** Mission de test : créneau au plus tôt, sans quota ni heures calmes. */
  test: boolean;
  /** Phase 21 : consigne « ce qui marche ici » (Rédaction) et fenêtres conseillées (Planification). */
  styleNotes?: string | null;
  suggestedWindows?: unknown[];
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

function rawMixOf(v: unknown): PlanInfo["rawMix"] {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
  return v && typeof v === "object" ? { video: n(r.video), photo: n(r.photo), text: n(r.text) } : null;
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
export async function loadPlan(prisma: PrismaClient, mission: Pick<Mission, "channelId" | "isTest"> & { payload?: Mission["payload"] }): Promise<PlanInfo> {
  return withOrderPlan(await loadBasePlan(prisma, mission), mission.payload);
}

/** Phase 33 : valeurs de la dérogation d'un ordre de Kevin, posées par le Grand Chef dans la charge utile (`orderPlan`). */
export type MissionOrderPlan = {
  windowStart?: string | null;
  windowEnd?: string | null;
  mix?: { video: number; photo: number; text: number } | null;
  themes?: string[] | null;
  personaId?: string | null;
  campaignId?: string | null;
  postsPerDay?: number | null;
};

/** Plan du canal corrigé par la dérogation d'un ordre (pur) : fenêtre, mélange, thèmes, persona, campagne, quota. */
export function withOrderPlan(plan: PlanInfo, payload: Mission["payload"] | undefined): PlanInfo {
  const o = payload && typeof payload.orderPlan === "object" && payload.orderPlan ? (payload.orderPlan as MissionOrderPlan) : null;
  if (!o) return plan;
  const out: PlanInfo = { ...plan };
  if (typeof o.windowStart === "string" && typeof o.windowEnd === "string") {
    out.windowStart = o.windowStart;
    out.windowEnd = o.windowEnd;
  }
  if (o.mix && o.mix.video + o.mix.photo + o.mix.text > 0) {
    out.mix = { video: o.mix.video, photo: o.mix.photo, text: o.mix.text };
    out.rawMix = { ...out.mix };
  }
  if (Array.isArray(o.themes) && o.themes.length) {
    out.themes = [...o.themes];
    out.themeWeights = o.themes.map((theme) => ({ theme, weight: 1 }));
  }
  if (typeof o.personaId === "string" && o.personaId) out.personaId = o.personaId;
  if (typeof o.campaignId === "string" && o.campaignId) out.campaignId = o.campaignId;
  if (typeof o.postsPerDay === "number" && o.postsPerDay > 0 && !plan.test) out.postsPerDay = o.postsPerDay;
  return out;
}

async function loadBasePlan(prisma: PrismaClient, mission: Pick<Mission, "channelId" | "isTest"> & { payload?: Mission["payload"] }): Promise<PlanInfo> {
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
    themes: parsePlanThemes(row.themes).map((t) => t.theme),
    themeWeights: parsePlanThemes(row.themes),
    rawMix: rawMixOf(row.mix),
    test: false,
    styleNotes: row.styleNotes ?? null,
    suggestedWindows: Array.isArray(row.suggestedWindows) ? row.suggestedWindows : [],
    // Test A/B « mélange » en cours : la mission suit le mélange de sa variante.
    ...(experimentMix(mission.payload) ? { mix: experimentMix(mission.payload)! } : {}),
  };
}

function experimentMix(payload: Mission["payload"] | undefined): PlanInfo["mix"] | null {
  const e = missionExperimentOf(payload as Record<string, unknown> | undefined);
  return e?.kind === "MELANGE" && e.config.mix ? e.config.mix : null;
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

export type PersonaInfo = {
  id: string;
  name: string;
  tone: string;
  personality: string;
  styleExamples: string | null;
  mediaNotes?: string | null;
};

export async function loadPersona(prisma: PrismaClient, id: string | null): Promise<PersonaInfo | null> {
  if (!id) return null;
  return (await prisma.persona.findUnique({
    where: { id },
    select: { id: true, name: true, tone: true, personality: true, styleExamples: true, mediaNotes: true },
  })) as PersonaInfo | null;
}

/** Médias du personnage (phase 20) : images de référence (la première sert au remplacement), LoRA, consignes. */
export type PersonaMedia = {
  id: string;
  name: string;
  referenceImageIds: string[];
  loraUrl: string | null;
  loraTrigger: string | null;
  loraScale: number;
  mediaNotes: string | null;
};

export async function loadPersonaMedia(prisma: PrismaClient, id: string | null | undefined): Promise<PersonaMedia | null> {
  if (!id) return null;
  const p = await prisma.persona.findUnique({
    where: { id },
    select: { id: true, name: true, referenceImageIds: true, loraUrl: true, loraTrigger: true, loraScale: true, mediaNotes: true },
  });
  if (!p) return null;
  const refs = Array.isArray(p.referenceImageIds) ? p.referenceImageIds.filter((x): x is string => typeof x === "string" && x !== "") : [];
  const scale = Number(p.loraScale);
  return {
    id: p.id,
    name: p.name,
    referenceImageIds: refs,
    loraUrl: p.loraUrl?.trim() || null,
    loraTrigger: p.loraTrigger?.trim() || null,
    loraScale: Number.isFinite(scale) && scale > 0 ? scale : 0.8,
    mediaNotes: p.mediaNotes?.trim() || null,
  };
}

/** Persona d'une mission : celle du plan du canal, sinon celle posée à la création (post de test). */
export function personaIdOf(mission: Pick<Mission, "payload">, plan: Pick<PlanInfo, "personaId">): string | null {
  if (plan.personaId) return plan.personaId;
  return typeof mission.payload.personaId === "string" && mission.payload.personaId ? mission.payload.personaId : null;
}
