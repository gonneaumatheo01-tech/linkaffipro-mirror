import { describe, expect, it } from "vitest";
import {
  agentUploadProblem,
  existingAssetProblem,
  parsePurpose,
  parseTestPostForm,
  providerLabel,
} from "./dating";
import { parseRange } from "./media-range";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const MB = 1024 * 1024;

describe("Produire un post de test", () => {
  it("type obligatoire (photo ou texte) ; persona obligatoire pour une photo, facultative pour un texte", () => {
    expect(parseTestPostForm(fd({ format: "photo", personaId: "p1" }))).toEqual({
      ok: true,
      data: { format: "photo", personaId: "p1" },
    });
    // Vidéos IA retirées le 29 octobre 2026.
    expect(parseTestPostForm(fd({ format: "video", personaId: "p1" })).ok).toBe(false);
    expect(parseTestPostForm(fd({ format: "text" }))).toEqual({ ok: true, data: { format: "text", personaId: null } });
    expect(parseTestPostForm(fd({ format: "photo" })).ok).toBe(false);
    expect(parseTestPostForm(fd({ format: "gif", personaId: "p1" })).ok).toBe(false);
    expect(parseTestPostForm(fd({ format: "photo", personaId: "../x" })).ok).toBe(false);
  });
});

describe("dépôt des médias des agents", () => {
  it("types et tailles, avec un message clair", () => {
    expect(parsePurpose("reference")).toBe("reference");
    // Vidéos sources retirées avec les vidéos IA (29 octobre 2026).
    expect(parsePurpose("source")).toBeNull();
    expect(parsePurpose("autre")).toBeNull();
    expect(agentUploadProblem("reference", "image/webp", 2 * MB)).toBeNull();
    expect(agentUploadProblem("reference", "video/mp4", 2 * MB)).toContain("image JPEG, PNG ou WebP");
    expect(agentUploadProblem("reference", "image/png", 12 * MB)).toContain("Image trop lourde");
    expect(agentUploadProblem("reference", "image/png", 0)).toBe("Fichier vide.");
  });

  it("fichier déjà en base : rangé pour la même persona, refusé pour une autre ou rangé autrement", () => {
    expect(existingAssetProblem({ personaId: null, kind: null }, { personaId: "p1", kind: "REFERENCE" })).toBeNull();
    expect(existingAssetProblem({ personaId: "p1", kind: "REFERENCE" }, { personaId: "p1", kind: "REFERENCE" })).toBeNull();
    expect(existingAssetProblem({ personaId: "p2", kind: "REFERENCE" }, { personaId: "p1", kind: "REFERENCE" })).toContain(
      "autre persona",
    );
    expect(existingAssetProblem({ personaId: "p1", kind: "GENERATED" }, { personaId: "p1", kind: "REFERENCE" })).toContain(
      "rangé autrement",
    );
    expect(existingAssetProblem({ personaId: null, kind: "PHOTO" }, { personaId: "p1", kind: "REFERENCE" })).toBeNull();
  });

  it("noms des fournisseurs", () => {
    expect(providerLabel("fal")).toBe("fal.ai");
    expect(providerLabel("fake")).toBe("simulation");
    expect(providerLabel(null)).toBe("");
  });
});

describe("lecture des vidéos par morceaux", () => {
  it("plages valides, ouvertes, finales ; illisibles ou hors fichier → null", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=50-10", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});
