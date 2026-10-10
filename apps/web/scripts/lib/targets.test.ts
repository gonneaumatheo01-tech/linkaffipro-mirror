import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAdminRoutes, isLocalDatabaseUrl, planTargets } from "./targets";

const WEB_DIR = path.resolve(__dirname, "..", "..");

describe("identifiants des fiches : base locale seulement", () => {
  it("accepte localhost, 127.0.0.1 et ::1", () => {
    expect(isLocalDatabaseUrl("postgresql://postgres:lap@localhost:54329/linkaffipro")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@127.0.0.1/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u:p@[::1]:5432/db")).toBe(true);
  });
  it("refuse tout le reste (hôte distant, paramètre host, autre protocole, valeur vide)", () => {
    expect(isLocalDatabaseUrl("postgresql://u:p@postgres.railway.internal:5432/railway")).toBe(
      false,
    );
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost.example.com/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost/db?host=db.example.com")).toBe(false);
    expect(isLocalDatabaseUrl("mysql://u:p@localhost/db")).toBe(false);
    expect(isLocalDatabaseUrl("")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
  });
});

describe("liste des pages", () => {
  it("trouve les pages de l'admin dans app/(admin)", () => {
    const routes = discoverAdminRoutes(WEB_DIR);
    expect(routes).toContain("/");
    expect(routes).toContain("/campaigns");
    expect(routes.length).toBeGreaterThan(20);
  });
  it("--pages explicite sans fiche : aucune lecture de la base", async () => {
    const { targets, notes } = await planTargets("/,/campaigns", {
      webDir: WEB_DIR,
      repoRoot: path.resolve(WEB_DIR, "..", ".."),
      env: {},
    });
    expect(targets).toEqual([
      { route: "/", path: "/" },
      { route: "/campaigns", path: "/campaigns" },
    ]);
    expect(notes).toEqual([]);
  });
  it("fiche sans base : adresse null et note explicative", async () => {
    const { targets, notes } = await planTargets("/campaigns/:id", {
      webDir: WEB_DIR,
      repoRoot: path.resolve(WEB_DIR, "..", ".."),
      env: {},
    });
    expect(targets).toEqual([{ route: "/campaigns/[id]", path: null }]);
    expect(notes[0]).toMatch(/DATABASE_URL absente/);
  });
});
