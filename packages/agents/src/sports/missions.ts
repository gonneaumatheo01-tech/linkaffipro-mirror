/**
 * Missions BET de l'équipe Paris sportifs (phase 23) : une mission de sélection par catégorie et par passage (agent
 * Cotes), puis une mission par pari retenu (le 1er continue dans la mission de sélection, les suivants dans des
 * missions sœurs qui commencent à la Capture). Canal de la mission = 1er canal de destination de la catégorie (canal
 * Test pour un pari de test) ; tous les canaux de destination sont gardés dans la charge utile.
 */
import { createMission, type CreateMissionResult } from "../missions/lifecycle";
import type { AgentsDeps } from "../types";
import { findTestChannel } from "../agents/data";
import type { BetCategoryInfo } from "./data";

export type BetMissionInput = {
  category: BetCategoryInfo;
  createdBy: "GRAND_CHEF" | "HUMAN";
  createdById?: string | null;
  isTest?: boolean;
  /** Pari déjà choisi (mission sœur). */
  pickId?: string | null;
  oddsSource?: "fake" | "live";
  planDay?: string | null;
  reason?: string;
  /** Phase 33 (ordre de Kevin) : canaux de destination de l'ordre, à la place de `BetCategory.channelIds`. */
  channelIds?: string[] | null;
  orderId?: string | null;
  /** Phase 33 : paris voulus par cette sélection (manquants du jour de l'ordre). */
  picksWanted?: number | null;
};

/** Quota d'un canal pour les paris : somme des paris par jour des catégories actives qui le visent. */
export async function betChannelQuota(deps: AgentsDeps, channelId: string): Promise<number> {
  const cats = await deps.prisma.betCategory.findMany({ where: { active: true }, select: { channelIds: true, picksPerDay: true } });
  const total = cats.filter((c) => Array.isArray(c.channelIds) && (c.channelIds as unknown[]).includes(channelId)).reduce((s, c) => s + c.picksPerDay, 0);
  return Math.max(1, total);
}

export async function createBetMission(deps: AgentsDeps, i: BetMissionInput): Promise<CreateMissionResult> {
  let channelId: string | null = null;
  const destinations = i.channelIds?.length ? i.channelIds : i.category.channelIds;
  if (i.isTest) channelId = (await findTestChannel(deps.prisma))?.id ?? null;
  else {
    const channels = await deps.prisma.channel.findMany({ where: { id: { in: destinations }, isActive: true }, select: { id: true } });
    channelId = destinations.find((id) => channels.some((c) => c.id === id)) ?? null;
  }
  if (!channelId)
    return { ok: false, reason: i.isTest ? "Aucun canal Test : cochez « canal de test » sur un canal (page Canaux)." : `La catégorie « ${i.category.name} » n'a aucun canal de destination actif.` };
  return createMission(deps, {
    teamKey: "sports",
    kind: "BET",
    channelId,
    createdBy: i.createdBy,
    createdById: i.createdById ?? null,
    isTest: i.isTest === true,
    planDay: i.planDay ?? null,
    format: "photo",
    postsPerDay: i.isTest ? undefined : i.orderId ? Math.max(1, i.picksWanted ?? 1) + (await betChannelQuota(deps, channelId)) : await betChannelQuota(deps, channelId),
    skipAgents: i.pickId ? ["cotes"] : [],
    orderId: i.orderId ?? null,
    payload: {
      categoryId: i.category.id,
      oddsSource: i.oddsSource ?? "live",
      targetChannelIds: i.isTest ? [channelId] : destinations,
      ...(i.picksWanted ? { picksWanted: i.picksWanted } : {}),
      ...(i.pickId ? { pickId: i.pickId } : {}),
      ...(i.reason ? { passage: i.reason } : {}),
    },
  });
}
