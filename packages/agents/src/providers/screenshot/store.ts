/**
 * Rangement des images de l'équipe Paris (phase 23) : capture du site (SCREENSHOT / HUMAN_SITE) ou image de repli
 * (SCREENSHOT / TEMPLATE). Empreinte salée par la demande : deux captures identiques de deux paris restent distinctes.
 */
import { createHash } from "node:crypto";
import type { Db as PrismaClient } from "@linkaffipro/db";

export async function storeCapturePng(
  prisma: PrismaClient,
  i: { png: Uint8Array; bookmaker: string; salt: string; origin?: "HUMAN_SITE" | "TEMPLATE"; tags?: string[]; width?: number | null; height?: number | null },
): Promise<{ id: string; created: boolean }> {
  const origin = i.origin ?? "HUMAN_SITE";
  const sha256 = createHash("sha256").update(i.png).update(`capture:${i.salt}`).digest("hex");
  const existing = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const size = pngSize(i.png);
  const row = await prisma.mediaAsset.create({
    data: {
      filename: `${origin === "TEMPLATE" ? "repli" : "capture"}-${i.bookmaker}-${i.salt.replace(/[^a-z0-9]/gi, "").slice(0, 20)}.png`,
      mimeType: "image/png",
      size: i.png.byteLength,
      sha256,
      bytes: Buffer.from(i.png),
      width: i.width ?? size?.width ?? null,
      height: i.height ?? size?.height ?? null,
      teamKey: "sports",
      kind: "SCREENSHOT",
      origin,
      tags: [...new Set(["sports", "SCREENSHOT", origin === "TEMPLATE" ? "repli" : "capture", `bookmaker:${i.bookmaker}`, ...(i.tags ?? [])])],
      providerName: origin === "TEMPLATE" ? "gabarit" : i.bookmaker,
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/** Pur : largeur et hauteur lues dans l'en-tête PNG (IHDR). */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.byteLength < 24 || png[0] !== 0x89 || png[1] !== 0x50) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
