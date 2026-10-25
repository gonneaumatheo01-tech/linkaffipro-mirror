import { beforeEach, describe, expect, it, vi } from "vitest";

// Lecture d'un short de l'équipe Montage (phase 28) : session obligatoire, short produit seulement, octets d'un short
// gardé dans Telegram par la chaîne Montage (`resolveAssetBytes`, gardés en mémoire entre deux morceaux), lecture par
// morceaux (`Range`), trop lourd pour le bot → « ouvrez-le dans Telegram » avec le lien de la médiathèque.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "MANAGER" } as { id: string; role: string } | null,
  clip: null as Record<string, unknown> | null,
  library: { username: null as string | null } as { username: string | null } | null,
  engine: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/ai/api-user", () => ({ apiUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@/lib/agents/montage-engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/montage-engine")>()),
  loadMontageEngine: vi.fn(async () => m.engine),
}));
vi.mock("@linkaffipro/agents", () => ({
  createTelegramDownloader: vi.fn((impl: { bot: unknown; account: unknown }) => ({ kind: "router", ...impl })),
}));
vi.mock("@linkaffipro/telegram", () => ({ createBotFileDownloader: vi.fn(() => "kevin-bot") }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    shortClip: { findUnique: vi.fn(async () => m.clip) },
    channel: { findFirst: vi.fn(async () => m.library) },
  },
}));

import { clearShortBytesCache } from "@/lib/agents/montage-bytes";
import { GET } from "./route";

const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
const MB = 1024 * 1024;

function call(id: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/agents/montage/short/${id}`, { headers }), { params: Promise.resolve({ id }) } as never);
}

const tgAsset = (size = bytes.byteLength) => ({
  id: "a1",
  filename: "short-3.mp4",
  mimeType: "video/mp4",
  size,
  storage: "telegram",
  bytes: new Uint8Array(0),
  telegramRef: { chatId: "-1001234567890", messageId: 77 },
  kind: "SHORT",
});

beforeEach(() => {
  clearShortBytesCache();
  m.user = { id: "u1", role: "MANAGER" };
  m.library = { username: null };
  m.clip = { index: 3, asset: tgAsset() };
  m.engine = { resolveAssetBytes: vi.fn(async () => bytes) };
});

describe("GET /api/agents/montage/short/[id]", () => {
  it("non connecté : 401 ; identifiant douteux, short inconnu ou pas encore produit : 404", async () => {
    m.user = null;
    expect((await call("c1")).status).toBe(401);
    m.user = { id: "u1", role: "MANAGER" };
    expect((await call("..%2Fx")).status).toBe(404);
    m.clip = null;
    expect((await call("c1")).status).toBe(404);
    m.clip = { index: 1, asset: null };
    expect((await call("c1")).status).toBe(404);
  });

  it("responsable connecté : le short entier, en continu, depuis Telegram", async () => {
    const res = await call("c1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    // Bot de Kevin seulement (20 Mo au plus), dossier temporaire propre au site.
    expect(m.engine.resolveAssetBytes).toHaveBeenCalledWith(
      expect.objectContaining({ deps: true, downloadTelegramFile: { kind: "router", bot: "kevin-bot", account: null }, montage: { workDir: expect.stringContaining("montage-web") } }),
      "a1",
    );
  });

  it("par morceaux : 206 avec la bonne plage, sans retélécharger le short ; plage impossible : 416", async () => {
    const res = await call("c1", { range: "bytes=100-199" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.subarray(100, 200));
    const tail = await call("c1", { range: "bytes=-10" });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.subarray(990));
    expect(m.engine.resolveAssetBytes).toHaveBeenCalledTimes(1);
    const bad = await call("c1", { range: "bytes=5000-6000" });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */1000");
  });

  it("short en base : servi sans la chaîne Montage", async () => {
    m.clip = { index: 2, asset: { ...tgAsset(), storage: "db", bytes: bytes.subarray(0, 50) } };
    const res = await call("c2");
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(50);
    expect(m.engine.resolveAssetBytes).not.toHaveBeenCalled();
  });

  it("trop lourd pour le bot (plus de 20 Mo) : 413, « ouvrez-le dans Telegram » et le lien du message", async () => {
    m.clip = { index: 3, asset: tgAsset(30 * MB) };
    const res = await call("c1");
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).toContain("ouvrez-le dans Telegram");
    expect(text).toContain("https://t.me/c/1234567890/77");
    expect(m.engine.resolveAssetBytes).not.toHaveBeenCalled();
    // Nom public du canal Médiathèque connu : lien t.me/<nom>.
    m.library = { username: "media_lap" };
    expect(await (await call("c1")).text()).toContain("https://t.me/media_lap/77");
  });

  it("la chaîne répond « trop lourd », n'est pas livrée ou tombe en panne : message clair, jamais d'erreur brute", async () => {
    m.engine = { resolveAssetBytes: vi.fn(async () => ({ tooBig: true })) };
    expect((await call("c1")).status).toBe(413);
    clearShortBytesCache();
    m.engine = { resolveAssetBytes: vi.fn(async () => Promise.reject(Object.assign(new Error("fichier de plus de 20 Mo"), { code: "too_big" }))) };
    expect((await call("c1")).status).toBe(413);
    clearShortBytesCache();
    m.engine = {};
    const notYet = await call("c1");
    expect(notYet.status).toBe(503);
    expect(await notYet.text()).toContain("ouvrez le short dans Telegram");
    m.engine = { resolveAssetBytes: vi.fn(async () => Promise.reject(new Error("telegram down"))) };
    const down = await call("c1");
    expect(down.status).toBe(503);
    expect(await down.text()).not.toContain("telegram down");
  });
});
