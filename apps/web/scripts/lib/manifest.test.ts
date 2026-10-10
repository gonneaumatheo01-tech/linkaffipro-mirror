import { describe, expect, it } from "vitest";
import {
  emptyManifest,
  mergeEntries,
  parseManifest,
  renderIndex,
  type CaptureEntry,
} from "./manifest";

const at = "2026-10-10T12:00:00.000Z";

function entry(over: Partial<CaptureEntry>): CaptureEntry {
  return {
    route: "/",
    path: "/",
    title: "Accueil",
    status: "ok",
    httpStatus: 200,
    redirectedTo: null,
    note: null,
    files: { "1440": "accueil-1440.webp", "390": "accueil-390.webp" },
    jsErrors: 0,
    capturedAt: at,
    ...over,
  };
}

describe("manifeste des captures (docs/captures/index.json)", () => {
  it("fusion : une nouvelle capture remplace l'ancienne de la même adresse, les autres restent", () => {
    const prev = [
      entry({ route: "/campaigns", title: "Ancien titre" }),
      entry({ route: "/members", title: "Membres" }),
    ];
    const next = [entry({ route: "/campaigns", title: "Campagnes" }), entry({ route: "/" })];
    const merged = mergeEntries(prev, next);
    expect(merged.map((e) => e.route)).toEqual(["/", "/campaigns", "/members"]);
    expect(merged.find((e) => e.route === "/campaigns")?.title).toBe("Campagnes");
  });

  it("fusion avec élagage : seules les adresses de la nouvelle passe restent", () => {
    const merged = mergeEntries([entry({ route: "/members" })], [entry({ route: "/" })], {
      prune: true,
    });
    expect(merged.map((e) => e.route)).toEqual(["/"]);
  });

  it("lecture tolérante : fichier absent ou illisible → manifeste vide", () => {
    expect(parseManifest(null)).toEqual(emptyManifest());
    expect(parseManifest("pas du json")).toEqual(emptyManifest());
    expect(
      parseManifest(JSON.stringify({ version: 1, updatedAt: at, entries: [entry({})] })).entries,
    ).toHaveLength(1);
  });
});

describe("index docs/REFONTE-CAPTURES.md", () => {
  const md = renderIndex(
    {
      version: 1,
      updatedAt: at,
      entries: [
        entry({}),
        entry({
          route: "/campaigns/[id]",
          path: "/campaigns/abc",
          title: "Démo · Casino | TikTok",
          files: { "1440": "campaigns-id-1440.webp", "390": "campaigns-id-390.webp" },
          jsErrors: 2,
        }),
        entry({
          route: "/stats",
          path: "/stats",
          title: null,
          status: "absent",
          httpStatus: 404,
          files: {},
        }),
        entry({
          route: "/links",
          path: "/links",
          title: null,
          status: "redirect",
          redirectedTo: "/campaigns/links",
          files: {},
        }),
        entry({
          route: "/messages/ab/[groupId]",
          path: null,
          title: null,
          status: "no-id",
          files: {},
        }),
      ],
    },
    { imageDir: "captures", widths: [1440, 390] },
  );

  it("un tableau : page, adresse, une colonne par largeur", () => {
    expect(md).toContain("| Page | Adresse | 1440 px | 390 px |");
    expect(md).toContain("| --- | --- | --- | --- |");
  });
  it("images en miniature cliquable, chemins relatifs au dossier docs", () => {
    expect(md).toContain(
      '<a href="captures/accueil-1440.webp"><img src="captures/accueil-1440.webp" alt="Accueil, 1440 px" width="360"></a>',
    );
    expect(md).toContain('alt="Accueil, 390 px" width="120"');
  });
  it("échappe la barre verticale des titres et signale les erreurs JavaScript", () => {
    expect(md).toContain("Démo · Casino \\| TikTok");
    expect(md).toContain("2 erreur(s) JavaScript");
  });
  it("note les pages absentes (404), les redirections et les fiches sans identifiant", () => {
    expect(md).toMatch(/`\/stats`.*absente \(404\)/);
    expect(md).toMatch(/`\/links`.*redirige vers `\/campaigns\/links`/);
    expect(md).toMatch(/`\/messages\/ab\/\[groupId\]`.*aucun identifiant/);
  });
  it("redirection : seule l'adresse d'arrivée est affichée, sans ses paramètres", () => {
    const out = renderIndex(
      {
        version: 1,
        updatedAt: at,
        entries: [
          entry({
            route: "/settings/connectors/tiktok/choose",
            status: "redirect",
            redirectedTo: "/settings/connectors/tiktok?error=Aucune+connexion",
            files: {},
          }),
        ],
      },
      { imageDir: "captures", widths: [1440] },
    );
    expect(out).toContain("redirige vers `/settings/connectors/tiktok` (avec paramètres)");
    expect(out).not.toContain("Aucune+connexion");
  });
  it("rappelle comment régénérer", () => {
    expect(md).toContain("pnpm captures");
    expect(md).toContain("2026-10-10");
  });
});
