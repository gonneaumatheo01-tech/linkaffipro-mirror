/**
 * Lectures de la fiche d'équipe Rencontres (phase 20) : médias par persona (vidéos sources non utilisées, vidéos et
 * photos produites ce mois, dernières productions), réglages vidéo de l'équipe, clés des fournisseurs présentes ou
 * non (jamais la clé elle-même). Lecture seule.
 */
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { secretSummary } from "@linkaffipro/agents";
import { parisMidnightUtc } from "@/lib/periods";
import { parseDatingSettings, type DatingMediaSettings } from "./dating";
import { currentMonth } from "./missions";
import { parseReferenceIds } from "@/lib/personas/media";

export type ProductionView = {
  id: string;
  mimeType: string;
  createdAt: Date;
  providerName: string | null;
  resolution: string | null;
};

export type DatingPersonaView = {
  id: string;
  name: string;
  isActive: boolean;
  references: number;
  hasCharacterFile: boolean;
  sourcesUnused: number;
  sourcesTotal: number;
  videosMonth: number;
  photosMonth: number;
  latest: ProductionView[];
};

/** Premier jour du mois de Paris (minuit, en UTC). */
export function monthStart(now: Date): Date {
  return parisMidnightUtc(`${currentMonth(now)}-01`);
}

/**
 * Personas de l'équipe Rencontres : celles d'un plan de canal de l'équipe, celles qui ont des médias rangés pour
 * l'équipe, et les personas « Une fille » (comptes réels). Actives d'abord, puis par prénom.
 */
export async function loadDatingPersonas(now: Date): Promise<DatingPersonaView[]> {
  const [plans, withMedia] = await Promise.all([
    prisma.channelAgentPlan.findMany({
      where: { teamKey: "dating", personaId: { not: null } },
      select: { personaId: true },
    }),
    prisma.mediaAsset.findMany({
      where: { teamKey: "dating", personaId: { not: null } },
      distinct: ["personaId"],
      select: { personaId: true },
    }),
  ]);
  const ids = [...plans, ...withMedia].map((r) => r.personaId).filter((x): x is string => Boolean(x));
  const personas = await prisma.persona.findMany({
    where: { OR: [{ id: { in: ids } }, { identityKind: "GIRL" }] },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, referenceImageIds: true, loraUrl: true, loraTrigger: true },
  });
  const since = monthStart(now);
  return Promise.all(
    personas.map(async (p) => {
      const [sourcesUnused, sourcesTotal, videosMonth, photosMonth, latest] = await Promise.all([
        prisma.mediaAsset.count({ where: { personaId: p.id, kind: "SOURCE", usages: { none: {} } } }),
        prisma.mediaAsset.count({ where: { personaId: p.id, kind: "SOURCE" } }),
        prisma.mediaAsset.count({
          where: { personaId: p.id, kind: "GENERATED", mimeType: { startsWith: "video/" }, createdAt: { gte: since } },
        }),
        prisma.mediaAsset.count({
          where: { personaId: p.id, kind: "GENERATED", mimeType: { startsWith: "image/" }, createdAt: { gte: since } },
        }),
        prisma.mediaAsset.findMany({
          where: { personaId: p.id, kind: "GENERATED" },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, mimeType: true, createdAt: true, providerName: true, resolution: true },
        }),
      ]);
      return {
        id: p.id,
        name: p.name,
        isActive: p.isActive,
        references: parseReferenceIds(p.referenceImageIds).length,
        hasCharacterFile: Boolean(p.loraUrl && p.loraTrigger),
        sourcesUnused,
        sourcesTotal,
        videosMonth,
        photosMonth,
        latest,
      };
    }),
  );
}

export async function loadDatingSettings(): Promise<DatingMediaSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "dating" }, select: { settings: true } });
  return parseDatingSettings(row?.settings);
}

/** Clés des fournisseurs de médias présentes (true) ou non ; une lecture impossible compte comme absente. */
export async function loadMediaKeys(): Promise<{ fal: boolean; magichour: boolean }> {
  const db = prisma as unknown as PrismaClient;
  const has = (key: string) =>
    secretSummary(db, key)
      .then((s) => s.set)
      .catch(() => false);
  const [fal, magichour] = await Promise.all([has("providers.fal.apiKey"), has("providers.magichour.apiKey")]);
  return { fal, magichour };
}
