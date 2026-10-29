/**
 * Estimations de coût des fournisseurs de médias (règles pures, centimes d'euro arrondis au centime supérieur pour
 * rester prudent face aux plafonds). Tarifs relevés dans la documentation officielle le 23 octobre 2026.
 */
import { USD_TO_EUR } from "@linkaffipro/ai";
import type { ImageAspect } from "./image";

/** fal Flux + LoRA : dollars par mégapixel (arrondi au mégapixel supérieur). */
export const FAL_IMAGE_USD_PER_MEGAPIXEL = 0.035;

const usdToCents = (usd: number) => (usd > 0 ? Math.ceil(usd * USD_TO_EUR * 100 - 1e-9) : 0);

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
