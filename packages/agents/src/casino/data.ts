/**
 * Lectures de l'équipe Casino (requêtes à plat, même code en base réelle et dans le faux client des tests) : canaux
 * casino, plans, médias de la médiathèque casino (sans les octets), utilisations.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { CasinoAsset, CasinoUsage } from "./pick";
import { parsePlanThemes, type WeightedTheme } from "./rotation";
import { themeKey, type CasinoSettings } from "./settings";

export type CasinoChannel = { id: string; title: string; isTest: boolean };

/** Canaux casino actifs (univers CASINO), du plus ancien au plus récent. */
export async function casinoChannels(prisma: PrismaClient, channelId?: string): Promise<CasinoChannel[]> {
  return (await prisma.channel.findMany({
    where: { vertical: "CASINO", isActive: true, ...(channelId ? { id: channelId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, isTest: true },
  })) as CasinoChannel[];
}

export type CasinoPlanRow = { channelId: string; enabled: boolean; themes: WeightedTheme[]; campaignId: string | null };

export async function casinoPlans(prisma: PrismaClient): Promise<Map<string, CasinoPlanRow>> {
  const rows = await prisma.channelAgentPlan.findMany({
    where: { teamKey: "casino" },
    select: { channelId: true, enabled: true, themes: true, campaignId: true },
  });
  return new Map(rows.map((r) => [r.channelId, { channelId: r.channelId, enabled: r.enabled, themes: casinoThemesOf(r.themes), campaignId: r.campaignId }]));
}

/** Thèmes d'un plan casino ramenés à des clés (« Machines à sous » → `machines-a-sous`), doublons fusionnés. */
export function casinoThemesOf(v: unknown): WeightedTheme[] {
  const out: WeightedTheme[] = [];
  for (const t of parsePlanThemes(v)) {
    const theme = themeKey(t.theme);
    if (theme && !out.some((x) => x.theme === theme)) out.push({ theme, weight: t.weight });
  }
  return out;
}

/** Thèmes d'un canal : ceux de son plan, sinon tous ceux de l'équipe (poids 1). */
export function channelThemes(plan: Pick<CasinoPlanRow, "themes"> | null | undefined, settings: CasinoSettings): WeightedTheme[] {
  return plan?.themes.length ? plan.themes : settings.themes.map((theme) => ({ theme, weight: 1 }));
}

/** Médias de la médiathèque casino (tous, le choix filtre l'origine). */
export async function loadCasinoAssets(prisma: PrismaClient): Promise<CasinoAsset[]> {
  return (await prisma.mediaAsset.findMany({
    where: { teamKey: "casino" },
    select: { id: true, createdAt: true, mimeType: true, origin: true, theme: true, tags: true },
  })) as CasinoAsset[];
}

export async function loadUsages(prisma: PrismaClient, assetIds: readonly string[]): Promise<CasinoUsage[]> {
  if (!assetIds.length) return [];
  return (await prisma.mediaUsage.findMany({
    where: { assetId: { in: [...assetIds] } },
    select: { assetId: true, channelId: true, usedAt: true },
  })) as CasinoUsage[];
}
