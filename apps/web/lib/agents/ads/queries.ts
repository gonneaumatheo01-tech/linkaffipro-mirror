/**
 * Lectures de la page Agent Ads (`/agents/ads`, phase 24) : analyse du moteur, recommandations de l'agent avec le
 * nom de leur cible, rapports archivés, seuils. Lecture seule : aucune tâche enfilée, aucun appel d'IA, rien vers
 * Meta ou TikTok (le moteur n'a aucune fonction d'écriture).
 */
import { computeAdsAnalysis, type AdsAnalysis, type AdsPeriod, type AdsThresholds } from "@linkaffipro/agents";
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { errorText } from "../redirect";
import type { AdsRecommendationView } from "./display";
import { ADS_THRESHOLDS_KEY, parseAdsThresholds } from "./thresholds";
import { ADS_ALERTS_KEY, parseAdsAlertSettingsValue, type AdsAlertSettingsValues } from "./alert-settings";

export const ADS_TEAM_KEY = "ads";

/** Analyse du moteur ; une panne ne casse pas la page (message à la place des chiffres). */
export async function loadAdsAnalysis(
  period: AdsPeriod,
  now = new Date(),
): Promise<{ ok: true; analysis: AdsAnalysis } | { ok: false; error: string }> {
  try {
    // Le client partagé omet `Channel.photoSmall` : même base, type plus étroit que `PrismaClient` du contrat.
    const analysis = await computeAdsAnalysis(prisma as unknown as PrismaClient, { period, now });
    return { ok: true, analysis };
  } catch (err) {
    console.error("[agents/ads] analyse impossible", err);
    return { ok: false, error: errorText(err) };
  }
}

const REC_SELECT = {
  id: true,
  target: true,
  targetId: true,
  action: true,
  evidence: true,
  expectedGain: true,
  status: true,
  comment: true,
  doneAt: true,
  rejectedAt: true,
  createdAt: true,
} as const;

/** Recommandations de l'agent (à décider d'abord, puis l'historique), avec le nom de la campagne, du groupe ou de la pub. */
export async function loadAdsRecommendations(take = 200): Promise<AdsRecommendationView[]> {
  const rows = await prisma.recommendation.findMany({
    where: { teamKey: ADS_TEAM_KEY },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: REC_SELECT,
  });
  const ids = (t: string) => [...new Set(rows.filter((r) => r.target === t).map((r) => r.targetId))];
  const [campaigns, adSets, ads] = await Promise.all([
    prisma.campaign.findMany({ where: { id: { in: ids("CAMPAIGN") } }, select: { id: true, name: true, vertical: true } }),
    prisma.adSet.findMany({
      where: { id: { in: ids("ADSET") } },
      select: { id: true, name: true, campaign: { select: { id: true, vertical: true } } },
    }),
    prisma.ad.findMany({
      where: { id: { in: ids("AD") } },
      select: { id: true, name: true, adSet: { select: { name: true, campaign: { select: { id: true, vertical: true } } } } },
    }),
  ]);
  const byId = new Map<string, { label: string; campaignId: string | null; vertical: string | null }>();
  for (const c of campaigns) byId.set(`CAMPAIGN:${c.id}`, { label: c.name, campaignId: c.id, vertical: c.vertical });
  for (const s of adSets)
    byId.set(`ADSET:${s.id}`, { label: s.name, campaignId: s.campaign.id, vertical: s.campaign.vertical });
  for (const a of ads)
    byId.set(`AD:${a.id}`, {
      label: `${a.name} (${a.adSet.name})`,
      campaignId: a.adSet.campaign.id,
      vertical: a.adSet.campaign.vertical,
    });
  return rows.map((r) => {
    const t = byId.get(`${r.target}:${r.targetId}`);
    return {
      ...r,
      targetLabel: t?.label ?? "Supprimée depuis",
      campaignId: t?.campaignId ?? null,
      vertical: t?.vertical ?? null,
    };
  });
}

export type AdsReportView = {
  id: string;
  weekStart: string;
  content: string;
  stats: unknown;
  sentAt: Date | null;
  createdAt: Date;
};

/** Rapports archivés de l'agent (quotidiens et hebdomadaires), du plus récent au plus ancien. */
export async function loadAdsReports(take = 20): Promise<AdsReportView[]> {
  return prisma.insightReport.findMany({
    where: { teamKey: ADS_TEAM_KEY },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: { id: true, weekStart: true, content: true, stats: true, sentAt: true, createdAt: true },
  });
}

export async function loadAdsThresholds(): Promise<AdsThresholds> {
  const row = await prisma.setting.findUnique({ where: { key: ADS_THRESHOLDS_KEY }, select: { value: true } });
  return parseAdsThresholds(row?.value);
}

export async function loadAdsAlertSettings(): Promise<AdsAlertSettingsValues> {
  const row = await prisma.setting.findUnique({ where: { key: ADS_ALERTS_KEY }, select: { value: true } });
  return parseAdsAlertSettingsValue(row?.value);
}

export type AdsCardFigures = { toDecide: number; done30d: number; lastReportAt: Date | null };

/** Chiffres de la carte « Agent Ads » du tableau de bord (sans calculer l'analyse : la carte reste rapide). */
export async function loadAdsCardFigures(now = new Date()): Promise<AdsCardFigures> {
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const [toDecide, done30d, last] = await Promise.all([
    prisma.recommendation.count({ where: { teamKey: ADS_TEAM_KEY, status: "PROPOSED" } }),
    prisma.recommendation.count({ where: { teamKey: ADS_TEAM_KEY, status: "DONE", doneAt: { gte: since } } }),
    prisma.insightReport.findFirst({
      where: { teamKey: ADS_TEAM_KEY },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return { toDecide, done30d, lastReportAt: last?.createdAt ?? null };
}
