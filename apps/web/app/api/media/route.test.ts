import { beforeEach, describe, expect, it, vi } from "vitest";

// Téléversement des médias : même contrôle que requireUser (compte actif, session à jour), sinon 401.
// On simule seulement la session (`@/auth`) et la base : la vraie fonction `apiUser` est exécutée,
// pour que le retrait d'un de ses contrôles (compte désactivé, session révoquée) fasse échouer ces tests.
type DbUser = { id: string; role: "ADMIN" | "MANAGER"; isActive: boolean; sessionVersion: number };
const mocks = vi.hoisted(() => ({
  // Jeton encore valide (auth() renvoie une session)…
  session: null as { user: { id: string; sessionVersion?: number } } | null,
  // … mais l'utilisateur relu en base peut être désactivé ou sa session révoquée.
  dbUser: null as DbUser | null,
  userFindUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
  create: vi.fn(async (_args: unknown) => ({ id: "m1" })),
  audit: vi.fn(async (_args: unknown) => undefined),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    mediaAsset: { findUnique: vi.fn(async () => null), create: mocks.create },
  },
  audit: mocks.audit,
}));

import { POST } from "./route";

function upload(): Request {
  const fd = new FormData();
  fd.append("files", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
  return new Request("http://localhost/api/media", { method: "POST", body: fd });
}

const ACTIVE: DbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 0 };

beforeEach(() => {
  mocks.session = { user: { id: "u1", sessionVersion: 0 } };
  mocks.dbUser = { ...ACTIVE };
  mocks.userFindUnique.mockReset();
  mocks.userFindUnique.mockImplementation(async () => mocks.dbUser);
  mocks.create.mockClear();
  mocks.audit.mockClear();
});

describe("POST /api/media", () => {
  it("sans session : 401, rien d'enregistré", async () => {
    mocks.session = null;
    const res = await POST(upload());
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("compte désactivé (jeton encore valide) : 401, rien d'enregistré", async () => {
    mocks.dbUser = { ...ACTIVE, isActive: false };
    const res = await POST(upload());
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("session révoquée (version du jeton dépassée) : 401, rien d'enregistré", async () => {
    mocks.dbUser = { ...ACTIVE, sessionVersion: 1 };
    const res = await POST(upload());
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("compte supprimé (absent de la base) : 401", async () => {
    mocks.dbUser = null;
    const res = await POST(upload());
    expect(res.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("utilisateur actif : relu en base, média enregistré et journalisé à son nom", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(mocks.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
    const body = (await res.json()) as { files: Array<{ id: string }> };
    expect(body.files[0]!.id).toBe("m1");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: "u1" }) }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", action: "media.uploaded" }),
    );
  });
});
