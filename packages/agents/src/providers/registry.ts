/**
 * Choix du fournisseur de photos d'une équipe (phase 20) : clé fal.ai présente → fal (Flux + LoRA), sinon faux
 * fournisseur (simulation : la photo est l'image de référence de la persona). Les vidéos IA (fal Wan 2.2 Animate,
 * Magic Hour) ont été retirées le 29 octobre 2026 (décision du client). Les tests imposent leur fournisseur par
 * `providers.image`.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { readSecret } from "../human/secrets";
import type { Providers, TeamSettings } from "../types";
import { createFalClient, createFalImageProvider } from "./fal";
import { createFakeImageProvider, type FakeAssetLoader } from "./fake";
import type { ImageProvider } from "./image";

export const FAL_SECRET_KEY = "providers.fal.apiKey";

export type MediaProviders = {
  image: ImageProvider;
  keys: { fal: boolean };
};

export function assetLoader(prisma: PrismaClient): FakeAssetLoader {
  return async (id) => {
    const a = await prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } });
    return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename } : null;
  };
}

export type ResolveMediaInput = {
  prisma: PrismaClient;
  settings?: Pick<TeamSettings, "settings">;
  providers?: Partial<Providers>;
  fetch?: typeof fetch;
  now?: () => Date;
};

export async function resolveMediaProviders(i: ResolveMediaInput): Promise<MediaProviders> {
  const falKey = await readSecret(i.prisma, FAL_SECRET_KEY);
  const fal = falKey ? createFalClient({ apiKey: falKey, fetch: i.fetch }) : null;
  const image: ImageProvider = i.providers?.image ?? (fal ? createFalImageProvider({ client: fal }) : createFakeImageProvider({ loadAsset: assetLoader(i.prisma) }));
  return { image, keys: { fal: !!falKey } };
}
