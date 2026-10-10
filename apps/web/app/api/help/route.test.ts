import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HelpResponse } from "@/lib/help/page-help";

const session = vi.hoisted(() => ({
  user: null as { id: string; role: "ADMIN" | "MANAGER" } | null,
}));
vi.mock("@/lib/ai/api-user", () => ({ apiUser: async () => session.user }));
// Le guide est lu depuis apps/web (process.cwd() des tests) : docs/GUIDE-UTILISATEUR.md à la racine du dépôt.

const { GET } = await import("./route");

const call = async (path: string) => {
  const res = await GET(new Request(`http://localhost/api/help?path=${encodeURIComponent(path)}`));
  return { status: res.status, body: (await res.json()) as HelpResponse & { error?: string } };
};

describe("GET /api/help", () => {
  beforeEach(() => {
    session.user = { id: "u1", role: "MANAGER" };
  });

  it("401 sans session valide", async () => {
    session.user = null;
    const { status, body } = await call("/campaigns");
    expect(status).toBe(401);
    expect(body.error).toBe("Non connecté.");
  });

  it("sections du guide de la page, en HTML sûr, titres en <h3>, ancres préfixées", async () => {
    const { status, body } = await call("/campaigns/abc?tab=ads");
    expect(status).toBe(200);
    expect(body.path).toBe("/campaigns/abc");
    expect(body.label).toBe("Campagnes");
    expect(body.fallback).toBe(false);
    expect(body.anchor).toBe("campagnes");
    expect(body.sections[0]!.title).toBe("Campagnes");
    expect(body.sections[0]!.html.startsWith('<h3 id="aide-campagnes">Campagnes</h3>')).toBe(true);
    for (const s of body.sections) {
      expect(s.html).not.toMatch(/<script|<h2|href="#/);
    }
  });

  it("une sous-section du guide (###) devient aussi un <h3>", async () => {
    const { body } = await call("/settings/team");
    expect(body.sections.map((s) => s.id)).toEqual([
      "reglages-equipe",
      "utilisateurs-et-invitations",
    ]);
    expect(body.sections[1]!.html.startsWith('<h3 id="aide-utilisateurs-et-invitations">')).toBe(
      true,
    );
  });

  it("page sans aide propre : « Les 10 premières minutes »", async () => {
    const { body } = await call("/styleguide");
    expect(body.fallback).toBe(true);
    expect(body.anchor).toBe("les-10-premieres-minutes");
    expect(body.sections.map((s) => s.title)).toEqual(["Les 10 premières minutes"]);
  });

  it("adresse invalide : traitée comme l'accueil", async () => {
    const { body } = await call("javascript:alert(1)");
    expect(body.path).toBe("/");
    expect(body.label).toBe("Accueil");
  });

  it("accueil : la section « Accueil » (intégrée tant que le guide ne l'a pas), ancre de la page /help", async () => {
    const { body } = await call("/");
    expect(body.fallback).toBe(false);
    expect(body.anchor).toBe("accueil");
    expect(body.sections.map((s) => s.title)).toEqual(["Accueil"]);
    expect(body.sections[0]!.html.startsWith('<h3 id="aide-accueil">Accueil</h3>')).toBe(true);
    expect(body.sections[0]!.html).not.toMatch(/Webhook|Dating|Menu <strong>Bots/);
  });
});
