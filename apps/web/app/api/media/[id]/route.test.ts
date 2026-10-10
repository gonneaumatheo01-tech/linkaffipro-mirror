import { beforeEach, describe, expect, it, vi } from "vitest";

// Aperçu d'un média : même contrôle que requireUser (compte actif, session à jour), sinon 401.
// On simule seulement la session (`@/auth`) et la base : la vraie fonction `apiUser` est exécutée,
// pour que le retrait d'un de ses contrôles (compte désactivé, session révoquée) fasse échouer ces tests.
type DbUser = { id: string; role: "ADMIN" | "MANAGER"; isActive: boolean; sessionVersion: number };
const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; sessionVersion?: number } } | null,
  dbUser: null as DbUser | null,
  userFindUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
  findUnique: vi.fn(async (_args: unknown) => ({
    id: "m1",
    filename: "photo.png",
    mimeType: "image/png",
    size: 3,
    bytes: Buffer.from([1, 2, 3]),
  })),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    mediaAsset: { findUnique: mocks.findUnique },
  },
}));

import { GET } from "./route";

const ctx = { params: Promise.resolve({ id: "m1" }) } as never;
const get = () => GET(new Request("http://localhost/api/media/m1"), ctx);
const ACTIVE: DbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 2 };

beforeEach(() => {
  mocks.session = { user: { id: "u1", sessionVersion: 2 } };
  mocks.dbUser = { ...ACTIVE };
  mocks.userFindUnique.mockReset();
  mocks.userFindUnique.mockImplementation(async () => mocks.dbUser);
  mocks.findUnique.mockClear();
});

describe("GET /api/media/[id]", () => {
  it("sans session : 401, média non lu", async () => {
    mocks.session = null;
    const res = await get();
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("compte désactivé (jeton encore valide) : 401, média non lu", async () => {
    mocks.dbUser = { ...ACTIVE, isActive: false };
    const res = await get();
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("session révoquée (version du jeton dépassée) : 401, média non lu", async () => {
    mocks.dbUser = { ...ACTIVE, sessionVersion: 3 };
    const res = await get();
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("jeton sans version alors que la session a été révoquée : 401", async () => {
    mocks.session = { user: { id: "u1" } };
    const res = await get();
    expect(res.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("utilisateur actif, session à jour : le média est servi", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(mocks.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
