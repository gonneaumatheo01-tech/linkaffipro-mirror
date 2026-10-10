/**
 * Icônes du site générées depuis le logo (public/brand/logo.png) : favicon.ico (16, 32, 48 px), icon.png (512 px),
 * apple-icon.png (180 px), et logo utilisé par la barre de menu et l'écran de connexion (public/brand/logo.webp).
 * Lecture des en-têtes de fichiers seulement (pas de dépendance d'image).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..");
const PUBLIC = join(__dirname, "..", "..", "public");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(buf.toString("ascii", 12, 16)).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("icônes du site", () => {
  it("icon.png fait 512 × 512", () => {
    expect(pngSize(readFileSync(join(APP, "icon.png")))).toEqual({ width: 512, height: 512 });
  });

  it("apple-icon.png fait 180 × 180", () => {
    expect(pngSize(readFileSync(join(APP, "apple-icon.png")))).toEqual({ width: 180, height: 180 });
  });

  it("favicon.ico contient les tailles 16, 32 et 48 px (images PNG)", () => {
    const ico = readFileSync(join(APP, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0); // réservé
    expect(ico.readUInt16LE(2)).toBe(1); // type icône
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const w = ico.readUInt8(entry) || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + length);
      expect(pngSize(png)).toEqual({ width: w, height: w });
      sizes.push(w);
    }
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it("le logo webp de l'interface est présent", () => {
    const webp = readFileSync(join(PUBLIC, "brand", "logo.webp"));
    expect(webp.toString("ascii", 0, 4)).toBe("RIFF");
    expect(webp.toString("ascii", 8, 12)).toBe("WEBP");
  });
});
