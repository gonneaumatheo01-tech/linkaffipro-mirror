import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Aperçu d'un emoji animé : même contrôle que requireUser (compte actif, session à jour), sinon 401. On simule la
// session (`@/auth`) et la base ; la vraie fonction `apiUser` est exécutée.
type DbUser = { id: string; role: "ADMIN" | "MANAGER"; isActive: boolean; sessionVersion: number };
const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; sessionVersion?: number } } | null,
  dbUser: null as DbUser | null,
  row: null as null | {
    previewBytes: Buffer | null;
    previewMime: string | null;
    previewAt: Date | null;
  },
  findUnique: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => mocks.dbUser) },
    customEmoji: { findUnique: mocks.findUnique },
  },
}));

import { GET } from "./route";

const ID = "5368324170671202286";
const get = (id = ID, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/custom-emoji/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  } as never);
const LOTTIE = { v: "5.5.2", fr: 60, ip: 0, op: 60, w: 512, h: 512, layers: [] };
const AT = new Date("2026-10-11T10:00:00Z");

beforeEach(() => {
  mocks.session = { user: { id: "u1", sessionVersion: 1 } };
  mocks.dbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 1 };
  mocks.row = {
    previewBytes: gzipSync(Buffer.from(JSON.stringify(LOTTIE))),
    previewMime: "application/x-tgsticker",
    previewAt: AT,
  };
  mocks.findUnique.mockReset();
  mocks.findUnique.mockImplementation(async () => mocks.row);
});

describe("GET /api/custom-emoji/[id]", () => {
  it("sans session, compte désactivé ou session révoquée : 401, base non lue", async () => {
    mocks.session = null;
    expect((await get()).status).toBe(401);
    mocks.session = { user: { id: "u1", sessionVersion: 1 } };
    mocks.dbUser = { ...mocks.dbUser!, isActive: false };
    expect((await get()).status).toBe(401);
    mocks.dbUser = { ...mocks.dbUser!, isActive: true, sessionVersion: 2 };
    expect((await get()).status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("animation .tgs : JSON décompressé, cache privé, étiquette", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("etag")).toMatch(/^"ce-5368324170671202286-/);
    expect(await res.json()).toEqual(LOTTIE);
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customEmojiId: ID } }),
    );
  });
  it("même étiquette déjà en cache : 304 sans corps", async () => {
    const etag = (await get()).headers.get("etag")!;
    const res = await get(ID, { "If-None-Match": etag });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });
  it("vidéo et image : renvoyées telles quelles", async () => {
    mocks.row = { previewBytes: Buffer.from([1, 2, 3]), previewMime: "video/webm", previewAt: AT };
    const res = await get();
    expect(res.headers.get("content-type")).toBe("video/webm");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("pas d'aperçu ou emoji inconnu : 204 sans contenu (l'emoji de remplacement reste) ; identifiant invalide : 404", async () => {
    mocks.row = { previewBytes: null, previewMime: null, previewAt: null };
    expect((await get()).status).toBe(204);
    mocks.row = null;
    expect((await get()).status).toBe(204);
    mocks.findUnique.mockClear();
    expect((await get("abc")).status).toBe(404);
    expect((await get("0")).status).toBe(404);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("aperçu illisible : 204 sans contenu", async () => {
    mocks.row = {
      previewBytes: Buffer.from("x"),
      previewMime: "application/x-tgsticker",
      previewAt: AT,
    };
    expect((await get()).status).toBe(204);
  });
});
