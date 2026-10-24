/**
 * Choix des fournisseurs de médias d'une équipe (phase 20) :
 * - clé fal.ai présente → fal (vidéo et photo), sinon faux fournisseur (simulation : la vidéo source revient telle
 *   quelle, la photo est l'image de référence de la persona) ;
 * - Magic Hour (visage seulement) si l'équipe l'a choisi (`settings.videoProvider = "magichour"`) ou si fal a échoué
 *   deux fois pour la mission, à condition que sa clé soit là ;
 * - résolution `settings.videoResolution` (480p / 580p / 720p, 580p par défaut) ;
 * - un travail déjà soumis est TOUJOURS relu chez son propre fournisseur (`byName`) dès que sa clé existe, quelle que
 *   soit la préférence du moment : la préférence ne sert qu'aux nouvelles soumissions.
 * Les tests imposent leurs fournisseurs par `providers.video` / `videoFallback` / `image`.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { readSecret } from "../human/secrets";
import type { Providers, TeamSettings } from "../types";
import { MAGICHOUR_DEFAULT_CENTS_PER_CREDIT } from "./costs";
import { createFalClient, createFalImageProvider, createFalVideoProvider } from "./fal";
import { createFakeImageProvider, createFakeVideoProvider, type FakeAssetLoader } from "./fake";
import type { ImageProvider } from "./image";
import { createMagicHourVideoProvider } from "./magichour";
import type { VideoProvider, VideoResolution } from "./video";

export const FAL_SECRET_KEY = "providers.fal.apiKey";
export const MAGICHOUR_SECRET_KEY = "providers.magichour.apiKey";
export const VIDEO_RESOLUTIONS: readonly VideoResolution[] = ["480p", "580p", "720p"];
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "580p";
/** Durée maximale d'une vidéo source (non documentée chez fal : borne prudente, réglable `settings.maxVideoSeconds`). */
export const DEFAULT_MAX_VIDEO_SECONDS = 15;
/** Échecs fal d'une mission avant de passer à Magic Hour. */
export const FAL_FAILURES_BEFORE_FALLBACK = 2;

export type MediaSettings = {
  videoProvider: "fal" | "magichour";
  resolution: VideoResolution;
  maxVideoSeconds: number;
  magicHourCentsPerCredit: number;
};

/** Réglages de médias d'une équipe (`AgentTeamConfig.settings`), avec les valeurs par défaut (pur). */
export function mediaSettings(settings: Pick<TeamSettings, "settings">): MediaSettings {
  const s = settings.settings ?? {};
  const res = s.videoResolution;
  const max = Number(s.maxVideoSeconds);
  const rate = Number(s.magicHourCentsPerCredit);
  return {
    videoProvider: s.videoProvider === "magichour" ? "magichour" : "fal",
    resolution: VIDEO_RESOLUTIONS.includes(res as VideoResolution) ? (res as VideoResolution) : DEFAULT_VIDEO_RESOLUTION,
    maxVideoSeconds: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_VIDEO_SECONDS,
    magicHourCentsPerCredit: Number.isFinite(rate) && rate > 0 ? rate : MAGICHOUR_DEFAULT_CENTS_PER_CREDIT,
  };
}

export type MediaProviders = {
  video: VideoProvider;
  /** Repli vidéo pour la même mission (Magic Hour quand le principal est fal), ou null. */
  fallbackVideo: VideoProvider | null;
  image: ImageProvider;
  /** Tous les fournisseurs vidéo utilisables (clé présente ; faux fournisseur toujours) : relecture d'un travail en cours. */
  byName: Partial<Record<VideoProvider["name"], VideoProvider>>;
  settings: MediaSettings;
  keys: { fal: boolean; magichour: boolean };
};

/** Pur : quel fournisseur vidéo pour cette mission ? */
export function pickVideoProviderName(i: {
  falKey: boolean;
  magicHourKey: boolean;
  preferred: "fal" | "magichour";
  falFailures: number;
}): "fal" | "magichour" | "fake" {
  if (i.magicHourKey && (i.preferred === "magichour" || (i.falKey && i.falFailures >= FAL_FAILURES_BEFORE_FALLBACK))) return "magichour";
  if (i.falKey) return "fal";
  return "fake";
}

export function assetLoader(prisma: PrismaClient): FakeAssetLoader {
  return async (id) => {
    const a = await prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } });
    return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename } : null;
  };
}

export type ResolveMediaInput = {
  prisma: PrismaClient;
  settings: Pick<TeamSettings, "settings">;
  providers?: Partial<Providers>;
  fetch?: typeof fetch;
  now?: () => Date;
  falFailures?: number;
};

export async function resolveMediaProviders(i: ResolveMediaInput): Promise<MediaProviders> {
  const settings = mediaSettings(i.settings);
  const [falKey, mhKey] = await Promise.all([readSecret(i.prisma, FAL_SECRET_KEY), readSecret(i.prisma, MAGICHOUR_SECRET_KEY)]);
  const keys = { fal: !!falKey, magichour: !!mhKey };
  const loadAsset = assetLoader(i.prisma);
  const fal = falKey ? createFalClient({ apiKey: falKey, fetch: i.fetch }) : null;
  const mh = mhKey ? createMagicHourVideoProvider({ apiKey: mhKey, fetch: i.fetch, centsPerCredit: settings.magicHourCentsPerCredit }) : null;

  const name = pickVideoProviderName({ falKey: !!fal, magicHourKey: !!mh, preferred: settings.videoProvider, falFailures: i.falFailures ?? 0 });
  const falVideo = fal ? createFalVideoProvider({ client: fal }) : null;
  const fakeVideo = createFakeVideoProvider({ loadAsset, now: i.now });
  let video: VideoProvider = name === "magichour" ? mh! : name === "fal" ? falVideo! : fakeVideo;
  let fallbackVideo: VideoProvider | null = name === "fal" ? mh : null;
  const byName: MediaProviders["byName"] = { fake: fakeVideo, ...(falVideo ? { fal: falVideo } : {}), ...(mh ? { magichour: mh } : {}) };
  let image: ImageProvider = fal ? createFalImageProvider({ client: fal }) : createFakeImageProvider({ loadAsset });

  // Fournisseurs imposés (tests) : la même règle de repli s'applique.
  if (i.providers?.video) {
    const forcedFallback = i.providers.videoFallback ?? null;
    const useFallback = forcedFallback && (i.falFailures ?? 0) >= FAL_FAILURES_BEFORE_FALLBACK;
    video = useFallback ? forcedFallback : i.providers.video;
    fallbackVideo = useFallback ? null : forcedFallback;
    byName[i.providers.video.name] = i.providers.video;
    if (forcedFallback) byName[forcedFallback.name] = forcedFallback;
  }
  if (i.providers?.image) image = i.providers.image;
  return { video, fallbackVideo, image, byName, settings, keys };
}
