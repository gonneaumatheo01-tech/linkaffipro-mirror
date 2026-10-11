import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_LOTTIE_BYTES, previewEtag, previewPayload } from "./preview";
import { importRunning } from "./queries";

const LOTTIE = { v: "5.5.2", fr: 60, ip: 0, op: 60, w: 512, h: 512, layers: [] };

describe("aperçu d'un emoji animé", () => {
  it(".tgs : décompressé et renvoyé en JSON", () => {
    const tgs = gzipSync(Buffer.from(JSON.stringify(LOTTIE)));
    const p = previewPayload(tgs, "application/x-tgsticker");
    expect(p?.contentType).toBe("application/json; charset=utf-8");
    expect(JSON.parse(Buffer.from(p!.body).toString("utf8"))).toEqual(LOTTIE);
  });
  it(".tgs corrompu, pas une animation, ou trop gros une fois décompressé : rien", () => {
    expect(previewPayload(Buffer.from("pas du gzip"), "application/x-tgsticker")).toBeNull();
    expect(previewPayload(gzipSync(Buffer.from('{"a":1}')), "application/x-tgsticker")).toBeNull();
    expect(previewPayload(gzipSync(Buffer.from("{oups")), "application/x-tgsticker")).toBeNull();
    const bomb = gzipSync(Buffer.alloc(MAX_LOTTIE_BYTES + 10, 32));
    expect(bomb.length).toBeLessThan(100_000);
    expect(previewPayload(bomb, "application/x-tgsticker")).toBeNull();
  });
  it("vidéo et image renvoyées telles quelles ; type inconnu ou vide : rien", () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(previewPayload(bytes, "video/webm")).toEqual({
      body: new Uint8Array([1, 2, 3]),
      contentType: "video/webm",
    });
    expect(previewPayload(bytes, "image/webp")?.contentType).toBe("image/webp");
    expect(previewPayload(bytes, "text/html")).toBeNull();
    expect(previewPayload(Buffer.alloc(0), "image/webp")).toBeNull();
    expect(previewPayload(null, "image/webp")).toBeNull();
    expect(previewPayload(bytes, null)).toBeNull();
  });
  it("étiquette de cache : change avec la date de l'aperçu", () => {
    const a = previewEtag("123", new Date("2026-10-11T10:00:00Z"));
    expect(a).toMatch(/^"ce-123-[0-9a-z]+"$/);
    expect(previewEtag("123", new Date("2026-10-11T11:00:00Z"))).not.toBe(a);
    expect(previewEtag("123", null)).toBe('"ce-123-0"');
  });
});

describe("import des packs du compte : « en cours »", () => {
  const t = (iso: string) => new Date(iso);
  const now = t("2026-10-11T12:00:00Z");
  it("demande récente sans import après elle : en cours", () => {
    expect(importRunning(t("2026-10-11T11:58:00Z"), null, now)).toBe(true);
    expect(importRunning(t("2026-10-11T11:58:00Z"), t("2026-10-10T08:00:00Z"), now)).toBe(true);
  });
  it("import arrivé après la demande, demande trop ancienne, ou aucune demande : pas en cours", () => {
    expect(importRunning(t("2026-10-11T11:58:00Z"), t("2026-10-11T11:59:00Z"), now)).toBe(false);
    expect(importRunning(t("2026-10-11T11:40:00Z"), null, now)).toBe(false);
    expect(importRunning(null, null, now)).toBe(false);
  });
});
