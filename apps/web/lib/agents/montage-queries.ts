/**
 * Lectures de la page Agents → Montage (phase 28) : travaux, fiche d'un travail (source, plan de coupe, shorts),
 * médiathèque des vidéos longues et des shorts. Jamais les octets (`bytes` reste vide pour les médias gardés dans
 * Telegram) : seulement les métadonnées.
 *
 * Miniature « si disponible » : une image rangée par l'équipe avec `sourceAssetId` = la vidéo (photo en base, servie
 * par `/api/agents/media/<id>`). Sans image, la page montre un pictogramme : aucune vidéo n'est téléchargée pour une
 * miniature.
 */
import { prisma } from "@linkaffipro/db";
import { assetThemes, type LibraryKind } from "./montage";

/** Miniature (image en base) de chaque vidéo, par identifiant de vidéo. */
async function thumbsOf(videoIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (videoIds.length === 0) return out;
  const rows = await prisma.mediaAsset.findMany({
    where: { sourceAssetId: { in: videoIds }, mimeType: { startsWith: "image/" }, storage: "db", kind: { not: null } },
    select: { id: true, sourceAssetId: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) if (r.sourceAssetId && !out.has(r.sourceAssetId)) out.set(r.sourceAssetId, r.id);
  return out;
}

export type MontageJobRow = {
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  instructions: unknown;
  sourceMeta: unknown;
  error: string | null;
  source: { id: string; filename: string; size: number; width: number | null; height: number | null; duration: number | null };
  thumbId: string | null;
  clipStatuses: string[];
};

export async function loadMontageList(limit = 100): Promise<MontageJobRow[]> {
  const jobs = await prisma.montageJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      instructions: true,
      sourceMeta: true,
      error: true,
      sourceAsset: { select: { id: true, filename: true, size: true, width: true, height: true, duration: true } },
      shorts: { select: { status: true } },
    },
  });
  const thumbs = await thumbsOf(jobs.map((j) => j.sourceAsset.id));
  return jobs.map((j) => ({
    id: j.id,
    status: String(j.status),
    createdAt: j.createdAt,
    completedAt: j.completedAt,
    instructions: j.instructions,
    sourceMeta: j.sourceMeta,
    error: j.error,
    source: j.sourceAsset,
    thumbId: thumbs.get(j.sourceAsset.id) ?? null,
    clipStatuses: j.shorts.map((s) => String(s.status)),
  }));
}

export type ShortClipView = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  description: string | null;
  score: number | null;
  format: string;
  pipPosition: string;
  subtitles: boolean;
  overlayText: string | null;
  status: string;
  qc: unknown;
  compressed: boolean;
  clientFeedback: string | null;
  redoCount: number;
  updatedAt: Date;
  asset: { id: string; storage: string; size: number; mimeType: string; width: number | null; height: number | null; telegramRef: unknown } | null;
  thumbId: string | null;
};

export type MontageDetail = Omit<MontageJobRow, "clipStatuses"> & {
  currentStep: string | null;
  planApprovedAt: Date | null;
  createdByName: string | null;
  source: MontageJobRow["source"] & { telegramRef: unknown };
  shorts: ShortClipView[];
};

export async function loadMontageDetail(id: string): Promise<MontageDetail | null> {
  const j = await prisma.montageJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      instructions: true,
      sourceMeta: true,
      error: true,
      currentStep: true,
      planApprovedAt: true,
      createdById: true,
      sourceAsset: { select: { id: true, filename: true, size: true, width: true, height: true, duration: true, telegramRef: true } },
      shorts: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          startMs: true,
          endMs: true,
          durationMs: true,
          description: true,
          score: true,
          format: true,
          pipPosition: true,
          subtitles: true,
          overlayText: true,
          status: true,
          qc: true,
          compressed: true,
          clientFeedback: true,
          redoCount: true,
          updatedAt: true,
          asset: { select: { id: true, storage: true, size: true, mimeType: true, width: true, height: true, telegramRef: true } },
        },
      },
    },
  });
  if (!j) return null;
  const [thumbs, creator] = await Promise.all([
    thumbsOf([j.sourceAsset.id, ...j.shorts.flatMap((s) => (s.asset ? [s.asset.id] : []))]),
    j.createdById ? prisma.user.findUnique({ where: { id: j.createdById }, select: { name: true, email: true } }) : null,
  ]);
  return {
    id: j.id,
    status: String(j.status),
    createdAt: j.createdAt,
    completedAt: j.completedAt,
    instructions: j.instructions,
    sourceMeta: j.sourceMeta,
    error: j.error,
    currentStep: j.currentStep,
    planApprovedAt: j.planApprovedAt,
    createdByName: creator ? creator.name || creator.email : null,
    source: j.sourceAsset,
    thumbId: thumbs.get(j.sourceAsset.id) ?? null,
    shorts: j.shorts.map((s) => ({
      ...s,
      format: String(s.format),
      pipPosition: String(s.pipPosition),
      status: String(s.status),
      thumbId: s.asset ? (thumbs.get(s.asset.id) ?? null) : null,
    })),
  };
}

export type LibraryItem = {
  id: string;
  kind: "SHORT" | "LONG_VIDEO";
  filename: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  themes: string[];
  createdAt: Date;
  telegramRef: unknown;
  clip: { id: string; index: number; montageJobId: string; status: string } | null;
  jobId: string | null;
};

/** Médiathèque : vidéos longues et shorts, filtrés par type et par thème (colonne `theme` ou tag `theme:<clé>`). */
export async function loadMontageLibrary(kind: LibraryKind, theme: string | null, limit = 200): Promise<{ items: LibraryItem[]; themes: string[] }> {
  const kinds = kind === "ALL" ? (["SHORT", "LONG_VIDEO"] as const) : ([kind] as const);
  const rows = await prisma.mediaAsset.findMany({
    where: {
      kind: { in: [...kinds] },
      ...(theme ? { OR: [{ theme }, { tags: { array_contains: [`theme:${theme}`] } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      filename: true,
      size: true,
      duration: true,
      width: true,
      height: true,
      theme: true,
      tags: true,
      createdAt: true,
      telegramRef: true,
      shortClips: { select: { id: true, index: true, montageJobId: true, status: true }, take: 1 },
      montageSources: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" } },
    },
  });
  const allThemes = await prisma.mediaAsset.findMany({
    where: { kind: { in: ["SHORT", "LONG_VIDEO"] } },
    select: { theme: true, tags: true },
    take: 2000,
  });
  const themes = [...new Set(allThemes.flatMap((r) => assetThemes(r.theme, r.tags)))].sort((a, b) => a.localeCompare(b, "fr"));
  return {
    themes,
    items: rows.map((r) => {
      const clip = r.shortClips[0] ? { ...r.shortClips[0], status: String(r.shortClips[0].status) } : null;
      return {
        id: r.id,
        kind: r.kind === "LONG_VIDEO" ? "LONG_VIDEO" : "SHORT",
        filename: r.filename,
        size: r.size,
        duration: r.duration,
        width: r.width,
        height: r.height,
        themes: assetThemes(r.theme, r.tags),
        createdAt: r.createdAt,
        telegramRef: r.telegramRef,
        clip,
        jobId: clip?.montageJobId ?? r.montageSources[0]?.id ?? null,
      };
    }),
  };
}

/** Nom public du canal Médiathèque (lien `t.me/<nom>/<message>`), s'il en a un. */
export async function loadLibraryChannelUsername(): Promise<string | null> {
  const ch = await prisma.channel.findFirst({ where: { isMediaLibrary: true }, select: { username: true } });
  return ch?.username ?? null;
}
