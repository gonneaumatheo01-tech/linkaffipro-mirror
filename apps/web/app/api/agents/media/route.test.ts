import { beforeEach, describe, expect, it, vi } from "vitest";

// Dépôt et aperçu des médias des agents (phase 20) : session obligatoire, persona vérifiée, types et tailles,
// rangement (persona, nature, origine humaine, équipe Rencontres), fichier déjà en base, lecture par morceaux.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "MANAGER" } as { id: string; role: string } | null,
  persona: { id: "p1" } as { id: string } | null,
  existing: null as Record<string, unknown> | null,
  casinoSettings: {} as unknown,
  asset: null as Record<string, unknown> | null,
  create: vi.fn(async (_a: unknown) => ({ id: "new1" })),
  update: vi.fn(async (_a: unknown) => ({})),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("@/lib/ai/api-user", () => ({ apiUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: {
    persona: { findUnique: vi.fn(async () => m.persona) },
    agentTeamConfig: { findUnique: vi.fn(async () => ({ settings: m.casinoSettings })) },
    mediaAsset: {
      findUnique: vi.fn(async (a: { select: Record<string, boolean> }) => (a.select.bytes ? m.asset : m.existing)),
      create: m.create,
      update: m.update,
    },
  },
}));

import { POST } from "./route";
import { GET } from "./[id]/route";

function upload(fields: Record<string, string>, files: File[]): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const f of files) fd.append("files", f);
  return new Request("http://localhost/api/agents/media", { method: "POST", body: fd });
}
const video = (name = "v.mp4", size = 10) => new File([new Uint8Array(size)], name, { type: "video/mp4" });

beforeEach(() => {
  m.user = { id: "u1", role: "MANAGER" };
  m.persona = { id: "p1" };
  m.existing = null;
  m.casinoSettings = {};
  m.asset = null;
  m.create.mockClear();
  m.update.mockClear();
  m.audit.mockClear();
});

describe("POST /api/agents/media", () => {
  it("sans session : 401", async () => {
    m.user = null;
    expect((await POST(upload({ purpose: "source", personaId: "p1" }, [video()]))).status).toBe(401);
  });

  it("type de dépôt ou persona inconnus : refus clair", async () => {
    expect((await POST(upload({ purpose: "autre", personaId: "p1" }, [video()]))).status).toBe(400);
    expect((await POST(upload({ purpose: "source", personaId: "" }, [video()]))).status).toBe(400);
    m.persona = null;
    const res = await POST(upload({ purpose: "source", personaId: "p9" }, [video()]));
    expect(res.status).toBe(404);
  });

  it("vidéo source d'un responsable : rangée pour la persona, journalisée", async () => {
    const res = await POST(upload({ purpose: "source", personaId: "p1" }, [video()]));
    const body = (await res.json()) as { files: Array<{ id: string; error?: string }> };
    expect(body.files).toEqual([expect.objectContaining({ id: "new1" })]);
    const data = (m.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ personaId: "p1", kind: "SOURCE", origin: "HUMAN", teamKey: "dating", createdById: "u1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.media_uploaded", entityId: "new1" }));
  });

  it("mauvais type : refusé fichier par fichier, rien n'est créé", async () => {
    const img = new File([new Uint8Array(5)], "a.png", { type: "image/png" });
    const body = (await (await POST(upload({ purpose: "source", personaId: "p1" }, [img]))).json()) as {
      files: Array<{ error?: string }>;
    };
    expect(body.files[0]!.error).toContain("MP4, MOV ou WebM");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("même fichier déjà en base : rangé à son tour, ou refusé s'il est à une autre persona", async () => {
    m.existing = { id: "old1", personaId: null, kind: null };
    let body = (await (await POST(upload({ purpose: "reference", personaId: "p1" }, [
      new File([new Uint8Array(5)], "a.png", { type: "image/png" }),
    ]))).json()) as { files: Array<{ id: string; error?: string }> };
    expect(body.files[0]).toMatchObject({ id: "old1" });
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old1" }, data: expect.objectContaining({ kind: "REFERENCE", personaId: "p1" }) }),
    );
    expect(m.audit).toHaveBeenCalledWith({
      userId: "u1",
      action: "agents.media_reclassified",
      entityType: "MediaAsset",
      entityId: "old1",
      metadata: expect.objectContaining({
        from: { personaId: null, kind: null, origin: null, teamKey: null },
        to: { personaId: "p1", kind: "REFERENCE", origin: "HUMAN", teamKey: "dating" },
      }),
    });
    m.audit.mockClear();
    m.existing = { id: "old1", personaId: "p2", kind: "SOURCE" };
    body = (await (await POST(upload({ purpose: "source", personaId: "p1" }, [video()]))).json()) as typeof body;
    expect(body.files[0]!.error).toContain("autre persona");
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("GET /api/agents/media/[id]", () => {
  const ctx = (id = "a1") => ({ params: Promise.resolve({ id }) }) as never;
  const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("sans session : 401 ; média hors agents : 404", async () => {
    m.user = null;
    expect((await GET(new Request("http://x/api/agents/media/a1"), ctx())).status).toBe(401);
    m.user = { id: "u1", role: "MANAGER" };
    m.asset = { filename: "x.mp4", mimeType: "video/mp4", size: 10, bytes, kind: null };
    expect((await GET(new Request("http://x/api/agents/media/a1"), ctx())).status).toBe(404);
  });

  it("vidéo entière ou par morceaux, en-têtes de cache privés", async () => {
    m.asset = { filename: "x.mp4", mimeType: "video/mp4", size: 10, bytes, kind: "GENERATED" };
    const full = await GET(new Request("http://x/api/agents/media/a1"), ctx());
    expect(full.status).toBe(200);
    expect(full.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    const part = await GET(new Request("http://x/api/agents/media/a1", { headers: { range: "bytes=2-4" } }), ctx());
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);
    const bad = await GET(new Request("http://x/api/agents/media/a1", { headers: { range: "bytes=20-" } }), ctx());
    expect(bad.status).toBe(416);
  });
});

describe("POST /api/agents/media (équipe Casino, phase 22)", () => {
  function casino(themes: string[], files: File[]): Request {
    const fd = new FormData();
    fd.set("purpose", "casino");
    for (const t of themes) fd.append("themes", t);
    for (const f of files) fd.append("files", f);
    return new Request("http://localhost/api/agents/media", { method: "POST", body: fd });
  }

  it("vidéo et image rangées pour l'équipe Casino, origine humaine, tous les thèmes en étiquettes", async () => {
    const img = new File([new Uint8Array(5)], "a.png", { type: "image/png" });
    const body = (await (await POST(casino(["roulette", "bonus"], [video(), img]))).json()) as { files: unknown[] };
    expect(body.files).toHaveLength(2);
    const v = (m.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(v).toMatchObject({
      teamKey: "casino",
      origin: "HUMAN",
      kind: "SOURCE",
      theme: "roulette",
      tags: ["casino", "theme:roulette", "theme:bonus"],
      createdById: "u1",
    });
    expect((m.create.mock.calls[1]![0] as { data: Record<string, unknown> }).data.kind).toBe("PHOTO");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.media_uploaded" }));
  });

  it("sans thème ou thème inconnu : refus", async () => {
    expect((await POST(casino([], [video()]))).status).toBe(400);
    expect((await POST(casino(["poker"], [video()]))).status).toBe(400);
    m.casinoSettings = { casino: { themes: ["poker"] } };
    expect((await POST(casino(["poker"], [video()]))).status).toBe(200);
  });

  it("même fichier : thèmes ajoutés, « à classer » retiré ; média de l'IA refusé", async () => {
    m.existing = { id: "old", teamKey: "casino", origin: "HUMAN", theme: null, tags: ["casino", "a-classer"] };
    await POST(casino(["live"], [video()]));
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "old" },
      data: expect.objectContaining({ theme: "live", tags: ["casino", "theme:live"] }),
    });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agents.media_reclassified",
        entityId: "old",
        metadata: expect.objectContaining({
          from: expect.objectContaining({ theme: null, tags: ["casino", "a-classer"] }),
          to: expect.objectContaining({ theme: "live", tags: ["casino", "theme:live"] }),
        }),
      }),
    );
    m.update.mockClear();
    m.existing = { id: "ai", teamKey: "casino", origin: "AI", theme: "live", tags: [] };
    const body = (await (await POST(casino(["live"], [video()]))).json()) as { files: Array<{ error?: string }> };
    expect(body.files[0]!.error).toContain("IA");
    expect(m.update).not.toHaveBeenCalled();
  });
});
