/**
 * Estimations de coût des fournisseurs de médias (règles pures, centimes d'euro arrondis au centime supérieur pour
 * rester prudent face aux plafonds). Tarifs relevés dans la documentation officielle le 23 octobre 2026.
 */
import { USD_TO_EUR } from "@linkaffipro/ai";
import type { ImageAspect } from "./image";
import type { VideoResolution } from "./video";

/** fal Wan 2.2 Animate « replace » : dollars par « seconde vidéo » facturée (= 16 images). */
export const FAL_VIDEO_USD_PER_BILLED_SECOND: Record<VideoResolution, number> = { "480p": 0.04, "580p": 0.06, "720p": 0.08 };
/** Images par seconde facturée chez fal. */
export const FAL_FRAMES_PER_BILLED_SECOND = 16;
/** Images par seconde supposées quand la source ne le dit pas (la plupart des vidéos de téléphone). */
export const DEFAULT_SOURCE_FPS = 30;
/** fal Flux + LoRA : dollars par mégapixel (arrondi au mégapixel supérieur). */
export const FAL_IMAGE_USD_PER_MEGAPIXEL = 0.035;
/** Magic Hour : estimation réglable du prix d'un crédit (centimes d'euro), le prix réel dépend de l'abonnement. */
export const MAGICHOUR_DEFAULT_CENTS_PER_CREDIT = 0.12;

const usdToCents = (usd: number) => (usd > 0 ? Math.ceil(usd * USD_TO_EUR * 100 - 1e-9) : 0);

function fpsOf(fps: number | null | undefined): number {
  return typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_SOURCE_FPS;
}

/** Coût fal d'un remplacement : (durée × images par seconde ÷ 16) × tarif de la résolution. */
export function falVideoCents(durationSec: number, fps: number | null | undefined, resolution: VideoResolution): number {
  if (!(durationSec > 0)) return 0;
  const frames = Math.ceil(durationSec * fpsOf(fps));
  return usdToCents((frames / FAL_FRAMES_PER_BILLED_SECOND) * FAL_VIDEO_USD_PER_BILLED_SECOND[resolution]);
}

/** Taille fal (`image_size`) et dimensions de chaque forme d'image. */
export const FAL_IMAGE_SIZES: Record<ImageAspect, { name: string; width: number; height: number }> = {
  portrait: { name: "portrait_4_3", width: 768, height: 1024 },
  square: { name: "square_hd", width: 1024, height: 1024 },
  landscape: { name: "landscape_4_3", width: 1024, height: 768 },
};

/** Mégapixels facturés d'une image : 1 mégapixel = 1024 × 1024 pixels, arrondi au supérieur, au moins 1. */
export function billedMegapixels(width: number, height: number): number {
  return Math.max(1, Math.ceil((width * height) / (1024 * 1024) - 1e-9));
}

/** Coût fal de `count` images de la forme demandée. */
export function falImageCents(count: number, aspect: ImageAspect): number {
  const size = FAL_IMAGE_SIZES[aspect];
  return usdToCents(Math.max(0, count) * billedMegapixels(size.width, size.height) * FAL_IMAGE_USD_PER_MEGAPIXEL);
}

/** Crédits Magic Hour estimés d'un échange de visage : une image traitée = un crédit (estimation). */
export function magicHourCredits(durationSec: number, fps: number | null | undefined): number {
  return durationSec > 0 ? Math.ceil(durationSec * fpsOf(fps)) : 0;
}

export function magicHourCents(credits: number, centsPerCredit = MAGICHOUR_DEFAULT_CENTS_PER_CREDIT): number {
  return credits > 0 ? Math.ceil(credits * centsPerCredit - 1e-9) : 0;
}
