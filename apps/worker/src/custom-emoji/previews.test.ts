import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  PREVIEW_MAX_BYTES,
  PREVIEW_MIME,
  previewFileOf,
  stickerFormat,
  thumbnailMime,
} from "./previews";

const base = { file_id: "F", is_animated: false, is_video: false };

describe("aperçus des emojis animés : règles pures", () => {
  it("format du fichier : animation compressée, vidéo ou image", () => {
    expect(stickerFormat({ is_animated: true, is_video: false })).toBe("tgs");
    expect(stickerFormat({ is_animated: false, is_video: true })).toBe("webm");
    expect(stickerFormat({ is_animated: false, is_video: false })).toBe("webp");
    expect(PREVIEW_MIME).toEqual({
      tgs: "application/x-tgsticker",
      webm: "video/webm",
      webp: "image/webp",
    });
  });

  it("l'emoji lui-même s'il tient dans 512 Ko (ou taille inconnue)", () => {
    expect(previewFileOf({ ...base, is_animated: true, file_size: 4000 })).toEqual({
      fileId: "F",
      mime: "application/x-tgsticker",
      thumbnail: false,
    });
    expect(previewFileOf({ ...base, is_video: true })).toEqual({
      fileId: "F",
      mime: "video/webm",
      thumbnail: false,
    });
    expect(previewFileOf({ ...base, file_size: PREVIEW_MAX_BYTES })?.thumbnail).toBe(false);
  });

  it("trop lourd : sa vignette fixe si elle tient, sinon rien", () => {
    const thumb = { file_id: "T", file_unique_id: "UT", width: 100, height: 100, file_size: 3000 };
    expect(
      previewFileOf({
        ...base,
        is_video: true,
        file_size: PREVIEW_MAX_BYTES + 1,
        thumbnail: thumb,
      }),
    ).toEqual({ fileId: "T", mime: null, thumbnail: true });
    expect(previewFileOf({ ...base, file_size: PREVIEW_MAX_BYTES + 1 })).toBeNull();
    expect(
      previewFileOf({
        ...base,
        file_size: PREVIEW_MAX_BYTES + 1,
        thumbnail: { ...thumb, file_size: PREVIEW_MAX_BYTES + 1 },
      }),
    ).toBeNull();
  });

  it("type d'une vignette d'après son chemin", () => {
    expect(thumbnailMime("thumbnails/file_1.jpg")).toBe("image/jpeg");
    expect(thumbnailMime("thumbnails/file_1.JPEG")).toBe("image/jpeg");
    expect(thumbnailMime("thumbnails/file_2.webp")).toBe("image/webp");
  });
});
