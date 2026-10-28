/**
 * Image d'un pari (phase 23) : capture envoyée par l'équipe (agent Capture, paris par capture), sinon image de repli
 * (origine TEMPLATE, TOUJOURS validée par le client ; plus de capture automatique des sites depuis le 28 octobre 2026). L'image de repli fabriquée ici est un simple fond aux couleurs de la marque
 * (aucun moteur de rendu) : le texte du post porte le match, le marché et la cote.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { AgentContext, Mission } from "../types";
import type { PickRow } from "./data";

export type PickImage =
  | { kind: "screenshot"; assetId: string; readOdds: number | null }
  | { kind: "fallback"; assetId: string; reason: string };

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG uni (RVB) : bandeau orange en haut, fond nuit. Pur et déterministe. */
export function fallbackPng(width = 640, height = 336): Uint8Array {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    const [r, g, b] = y < 48 ? [255, 138, 0] : [20, 24, 38];
    for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Uint8Array.from(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", new Uint8Array())]),
  );
}

async function storeFallback(ctx: AgentContext, pick: PickRow, bytes: Uint8Array): Promise<string> {
  // Empreinte salée par le pari : deux paris n'ont jamais la même ligne de média (le repli est identique en octets).
  const sha256 = createHash("sha256").update(bytes).update(`repli:${pick.id}`).digest("hex");
  const existing = await ctx.prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) return existing.id;
  const a = await ctx.prisma.mediaAsset.create({
    data: {
      filename: `repli-${pick.bookmaker}-${pick.id}.png`,
      mimeType: "image/png",
      size: bytes.length,
      sha256,
      bytes: Buffer.from(bytes),
      teamKey: "sports",
      kind: "SCREENSHOT",
      origin: "TEMPLATE",
      tags: ["screenshot", pick.bookmaker, "repli"],
    },
    select: { id: true },
  });
  return a.id;
}

/** Image déjà déposée par l'agent Capture (charge utile ou pari), sinon repli. */
export async function ensurePickImage(ctx: AgentContext, mission: Mission, pick: PickRow): Promise<PickImage> {
  const given = (typeof mission.payload.screenshotAssetId === "string" && mission.payload.screenshotAssetId) || pick.screenshotAssetId;
  if (given) {
    const a = await ctx.prisma.mediaAsset.findUnique({ where: { id: given }, select: { id: true, origin: true } });
    if (a) {
      // Agent Capture (chantier B) : `payload.capture` = { status, reason, readOdds… } ; il a déjà comparé la cote.
      const cap = (mission.payload.capture ?? {}) as { reason?: unknown; readOdds?: unknown };
      const readOdds = typeof cap.readOdds === "number" && cap.readOdds > 1 ? cap.readOdds : typeof mission.payload.readOdds === "number" ? mission.payload.readOdds : null;
      const why = typeof cap.reason === "string" && cap.reason ? cap.reason : String(mission.payload.captureError ?? "capture impossible");
      return a.origin === "TEMPLATE" ? { kind: "fallback", assetId: a.id, reason: why } : { kind: "screenshot", assetId: a.id, readOdds };
    }
  }
  const reason = "pas de capture envoyée par l'équipe";
  const assetId = await storeFallback(ctx, pick, fallbackPng());
  await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { screenshotAssetId: assetId } });
  return { kind: "fallback", assetId, reason };
}
