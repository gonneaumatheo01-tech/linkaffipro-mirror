/**
 * Phase 28, chantier D — octets d'un média au moment de l'envoi par un bot de canal (posts, envois groupés, messages du
 * bot) ou par le compte connecté. Un média en base (`storage = "db"`) : la colonne `bytes`, rien ne change. Un média
 * gardé dans Telegram (short du montage) : retrouvé par `resolveAssetBytes` (bot de Kevin ≤ 20 Mo, compte connecté
 * au-delà), car l'identifiant de fichier du bot de Kevin ne vaut pas pour un autre bot.
 * Règle 1 du montage : un short qui n'est pas VALIDÉ par le client ne part jamais (erreur, l'envoi échoue).
 */
import { resolveAssetBytes, type MontagePipelineDeps } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { workerMontageDeps } from "./deps";

export type SendableAsset = {
  id: string;
  kind?: string | null;
  storage?: string | null;
  bytes?: Uint8Array | null;
  telegramRef?: unknown;
  size?: number | null;
};

/** Short pas encore validé : jamais envoyé. */
export class ShortNotApproved extends Error {
  constructor() {
    super("short pas encore validé par le client : il ne part sur aucun canal");
    this.name = "ShortNotApproved";
  }
}

let depsOf: () => MontagePipelineDeps = workerMontageDeps;

/** Tests : dépendances imposées. */
export function setSendableBytesDeps(next: (() => MontagePipelineDeps) | null): void {
  depsOf = next ?? workerMontageDeps;
}

export async function assertShortApproved(asset: Pick<SendableAsset, "id" | "kind">, db: Pick<MontagePipelineDeps["prisma"], "shortClip"> = prisma): Promise<void> {
  if (asset.kind !== "SHORT") return;
  const ok = await db.shortClip.findFirst({ where: { assetId: asset.id, status: "APPROVED" }, select: { id: true } });
  if (!ok) throw new ShortNotApproved();
}

export async function sendableBytes(asset: SendableAsset): Promise<Uint8Array> {
  const deps = depsOf();
  await assertShortApproved(asset, deps.prisma);
  if (asset.storage !== "telegram") return new Uint8Array(asset.bytes ?? new Uint8Array());
  return resolveAssetBytes(deps, asset);
}
