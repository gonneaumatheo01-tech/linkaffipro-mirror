import { beforeEach, describe, expect, it, vi } from "vitest";

// apiUser : même contrôle que requireUser pour les routes API (compte actif, session à jour), sans redirection.
type DbUser = { id: string; role: "ADMIN" | "MANAGER"; isActive: boolean; sessionVersion: number };
const mocks = vi.hoisted(() => ({
  session: null as { user: { id?: string; sessionVersion?: number } } | null,
  dbUser: null as DbUser | null,
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: { user: { findUnique: vi.fn(async () => mocks.dbUser) } },
}));

import { apiUser } from "./api-user";

beforeEach(() => {
  mocks.session = { user: { id: "u1", sessionVersion: 2 } };
  mocks.dbUser = { id: "u1", role: "ADMIN", isActive: true, sessionVersion: 2 };
});

describe("apiUser", () => {
  it("renvoie l'utilisateur actif dont la session est à jour", async () => {
    expect(await apiUser()).toEqual({ id: "u1", role: "ADMIN" });
  });

  it("refuse sans session ou sans identifiant", async () => {
    mocks.session = null;
    expect(await apiUser()).toBeNull();
    mocks.session = { user: {} };
    expect(await apiUser()).toBeNull();
  });

  it("refuse un compte désactivé ou absent de la base", async () => {
    mocks.dbUser = { id: "u1", role: "ADMIN", isActive: false, sessionVersion: 2 };
    expect(await apiUser()).toBeNull();
    mocks.dbUser = null;
    expect(await apiUser()).toBeNull();
  });

  it("refuse une session révoquée (version différente, ou jeton sans version)", async () => {
    mocks.dbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 3 };
    expect(await apiUser()).toBeNull();
    mocks.session = { user: { id: "u1" } };
    mocks.dbUser = { id: "u1", role: "MANAGER", isActive: true, sessionVersion: 2 };
    expect(await apiUser()).toBeNull();
  });
});
