import { beforeEach, describe, expect, it, vi } from "vitest";

// Liste du sélecteur d'emojis animés : utilisateurs connectés et actifs, emojis visibles seulement, sans aperçu.
const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; sessionVersion?: number } } | null,
  findMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: "u1",
        role: "MANAGER",
        isActive: true,
        sessionVersion: 0,
      })),
    },
    customEmoji: { findMany: mocks.findMany },
  },
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.session = { user: { id: "u1" } };
  mocks.findMany.mockReset();
  mocks.findMany.mockResolvedValue([
    {
      customEmojiId: "111",
      fallback: "🔥",
      setName: "Hot",
      setTitle: "Hot pack",
      format: "tgs",
      previewMime: "application/x-tgsticker",
      useCount: 3,
      lastUsedAt: new Date("2026-10-11T10:00:00Z"),
    },
    {
      customEmojiId: "222",
      fallback: "⭐",
      setName: null,
      setTitle: null,
      format: null,
      previewMime: null,
      useCount: 0,
      lastUsedAt: null,
    },
  ]);
});

describe("GET /api/custom-emoji", () => {
  it("sans session : 401", async () => {
    mocks.session = null;
    expect((await GET()).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("emojis visibles, sans fichier d'aperçu, jamais en cache", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.items).toEqual([
      {
        id: "111",
        fallback: "🔥",
        setName: "Hot",
        setTitle: "Hot pack",
        format: "tgs",
        hasPreview: true,
        useCount: 3,
        lastUsedAt: "2026-10-11T10:00:00.000Z",
      },
      {
        id: "222",
        fallback: "⭐",
        setName: null,
        setTitle: null,
        format: null,
        hasPreview: false,
        useCount: 0,
        lastUsedAt: null,
      },
    ]);
    const args = mocks.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ hiddenAt: null });
    expect(args.select.previewBytes).toBeUndefined();
  });
});
