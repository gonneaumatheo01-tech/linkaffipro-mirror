/**
 * Lectures de la fiche d'équipe Casino (phase 22) : réglages de l'équipe, stock par canal et par thème (calcul du
 * moteur, `casinoStock`), médias « à classer », demandes de vidéos envoyées, dernières utilisations des médias,
 * nombre de médias par thème. Lecture seule.
 */
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { casinoStock } from "@linkaffipro/agents";
import {
  TO_CLASSIFY_TAG,
  THEME_TAG_PREFIX,
  mediaThemes,
  parseCasinoSettings,
  parseMediaRequest,
  type CasinoSettings,
  type MediaRequestView,
  type StockRow,
} from "./casino";

export async function loadCasinoSettings(): Promise<CasinoSettings> {
  const row = await prisma.agentTeamConfig.findUnique({
    where: { teamKey: "casino" },
    select: { settings: true },
  });
  return parseCasinoSettings(row?.settings);
}

/** Stock du moteur ; `null` si le calcul échoue (la fiche le dit au lieu de planter). */
export async function loadCasinoStock(now: Date): Promise<StockRow[] | null> {
  try {
    return await casinoStock(prisma as unknown as PrismaClient, { now });
  } catch {
    return null;
  }
}

export type ToClassifyView = {
  id: string;
  filename: string;
  mimeType: string;
  createdAt: Date;
  themes: string[];
};

/** Médias de l'équipe sans thème (« à classer »), les plus anciens d'abord, 24 au plus. */
export async function loadToClassify(): Promise<{ rows: ToClassifyView[]; total: number }> {
  const where = { teamKey: "casino", theme: null, tags: { array_contains: [TO_CLASSIFY_TAG] } };
  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 24,
      select: {
        id: true,
        filename: true,
        mimeType: true,
        createdAt: true,
        theme: true,
        tags: true,
      },
    }),
    prisma.mediaAsset.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      createdAt: r.createdAt,
      themes: mediaThemes(r),
    })),
    total,
  };
}

/** Demandes de vidéos de l'équipe (ouvertes d'abord, puis les plus récentes), 20 au plus. */
export async function loadCasinoRequests(): Promise<MediaRequestView[]> {
  const rows = await prisma.humanRequest.findMany({
    where: { teamKey: "casino", kind: "MEDIA" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      key: true,
      expected: true,
      status: true,
      question: true,
      createdAt: true,
      askedAt: true,
      answeredAt: true,
    },
  });
  const open = (s: string) => s === "PENDING" || s === "QUEUED";
  return rows
    .map(parseMediaRequest)
    .sort((a, b) => Number(open(b.status)) - Number(open(a.status)));
}

export type CasinoUsageView = {
  id: string;
  usedAt: Date;
  channelTitle: string;
  asset: { id: string; mimeType: string; themes: string[] };
};

/** Dernières publications de médias de l'équipe (12), avec le canal et les thèmes du média. */
export async function loadCasinoRecentUsages(): Promise<CasinoUsageView[]> {
  const rows = await prisma.mediaUsage.findMany({
    where: { asset: { teamKey: "casino" } },
    orderBy: { usedAt: "desc" },
    take: 12,
    select: {
      id: true,
      usedAt: true,
      channel: { select: { title: true } },
      asset: { select: { id: true, mimeType: true, theme: true, tags: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    usedAt: r.usedAt,
    channelTitle: r.channel.title,
    asset: { id: r.asset.id, mimeType: r.asset.mimeType, themes: mediaThemes(r.asset) },
  }));
}

/** Médias de l'équipe par thème (tous, utilisés ou non) : sert au retrait d'un thème et à la liste des thèmes. */
export async function loadThemeMediaCounts(keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    keys.map(async (k) => {
      out[k] = await prisma.mediaAsset.count({
        where: {
          teamKey: "casino",
          OR: [{ theme: k }, { tags: { array_contains: [`${THEME_TAG_PREFIX}${k}`] } }],
        },
      });
    }),
  );
  return out;
}

/** Canaux dont le plan Casino contient ce thème (titres). */
export async function loadChannelsUsingTheme(key: string): Promise<string[]> {
  const plans = await prisma.channelAgentPlan.findMany({
    where: { teamKey: "casino" },
    select: { themes: true, channel: { select: { title: true } } },
  });
  return plans
    .filter(
      (p) =>
        Array.isArray(p.themes) &&
        p.themes.some(
          (t) =>
            t === key || (t && typeof t === "object" && (t as { theme?: unknown }).theme === key),
        ),
    )
    .map((p) => p.channel.title);
}
