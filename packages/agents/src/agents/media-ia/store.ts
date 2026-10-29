/**
 * Rangement d'une photo produite par un fournisseur (`MediaAsset` PHOTO, origine AI, persona, travail et
 * fournisseur). En simulation, le fichier est l'image de référence : son empreinte est salée pour rester unique
 * (la référence garde la sienne), et le média porte le mot-clé « simulation ».
 */
import { createHash } from "node:crypto";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { ProviderFile } from "../../providers/image";

export type StoreProducedInput = {
  file: ProviderFile;
  teamKey: string;
  personaId: string | null;
  providerName: string;
  providerJobId?: string | null;
  simulation: boolean;
  /** Rend l'empreinte unique en simulation (identifiant de mission et de travail). */
  salt: string;
  width?: number | null;
  height?: number | null;
  tags?: string[];
};

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function producedSha256(bytes: Uint8Array, simulation: boolean, salt: string): string {
  const h = createHash("sha256").update(bytes);
  if (simulation) h.update(`simulation:${salt}`);
  return h.digest("hex");
}

export async function storeProducedMedia(prisma: PrismaClient, i: StoreProducedInput): Promise<{ id: string; created: boolean }> {
  const sha256 = producedSha256(i.file.bytes, i.simulation, i.salt);
  const existing = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const mime = i.file.mimeType && i.file.mimeType !== "application/octet-stream" ? i.file.mimeType : "image/jpeg";
  const ext = EXT[mime] ?? "jpg";
  const tags = [i.teamKey, "photo", "ia", ...(i.simulation ? ["simulation"] : []), ...(i.tags ?? [])];
  const row = await prisma.mediaAsset.create({
    data: {
      filename: `${i.simulation ? "simulation-" : ""}photo-${i.salt.replace(/[^a-z0-9]/gi, "").slice(0, 24)}.${ext}`,
      mimeType: mime,
      size: i.file.bytes.byteLength,
      sha256,
      bytes: Buffer.from(i.file.bytes),
      width: i.width ?? null,
      height: i.height ?? null,
      teamKey: i.teamKey,
      personaId: i.personaId,
      kind: "PHOTO",
      origin: "AI",
      tags: [...new Set(tags)],
      providerJobId: i.providerJobId ?? null,
      providerName: i.providerName,
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}
