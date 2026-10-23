import { describe, expect, it } from "vitest";
import {
  agentUploadProblem,
  existingAssetProblem,
  mergeDatingSettings,
  parseDatingSettings,
  parseDatingSettingsForm,
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

describe("réglages vidéo de l'équipe Rencontres", () => {
  it("valeurs par défaut : fal.ai en 580p ; valeurs inconnues ignorées", () => {
    expect(parseDatingSettings(null)).toEqual({ videoProvider: "fal", videoResolution: "580p" });
    expect(parseDatingSettings({ videoProvider: "autre", videoResolution: "1080p" })).toEqual({
      videoProvider: "fal",
      videoResolution: "580p",
    });
    expect(parseDatingSettings({ videoProvider: "magichour", videoResolution: "720p" })).toEqual({
      videoProvider: "magichour",
      videoResolution: "720p",
    });
  });

  it("fusion : les autres clés du moteur sont gardées", () => {
    expect(
      mergeDatingSettings({ similarityThreshold: 0.8, videoProvider: "fal" }, { videoProvider: "magichour", videoResolution: "480p" }),
    ).toEqual({ similarityThreshold: 0.8, videoProvider: "magichour", videoResolution: "480p" });
  });

  it("formulaire : fournisseur et résolution de la liste seulement", () => {
    expect(parseDatingSettingsForm(fd({ videoProvider: "fal", videoResolution: "720p" }))).toEqual({
      ok: true,
      data: { videoProvider: "fal", videoResolution: "720p" },
    });
    expect(parseDatingSettingsForm(fd({ videoProvider: "x", videoResolution: "720p" })).ok).toBe(false);
    expect(parseDatingSettingsForm(fd({ videoProvider: "fal", videoResolution: "1080p" })).ok).toBe(false);
  });
});

describe("Produire un post de test", () => {
  it("type obligatoire ; persona obligatoire pour une vidéo ou une photo, facultative pour un texte", () => {
    expect(parseTestPostForm(fd({ format: "video", personaId: "p1" }))).toEqual({
      ok: true,
      data: { format: "video", personaId: "p1" },
    });
    expect(parseTestPostForm(fd({ format: "text" }))).toEqual({ ok: true, data: { format: "text", personaId: null } });
    expect(parseTestPostForm(fd({ format: "photo" })).ok).toBe(false);
    expect(parseTestPostForm(fd({ format: "gif", personaId: "p1" })).ok).toBe(false);
    expect(parseTestPostForm(fd({ format: "photo", personaId: "../x" })).ok).toBe(false);
  });
});

describe("dépôt des médias des agents", () => {
  it("types et tailles, avec un message clair", () => {
    expect(parsePurpose("source")).toBe("source");
    expect(parsePurpose("autre")).toBeNull();
    expect(agentUploadProblem("source", "video/mp4", 20 * MB)).toBeNull();
    expect(agentUploadProblem("source", "image/png", 1000)).toContain("vidéo MP4, MOV ou WebM");
    expect(agentUploadProblem("source", "video/mp4", 60 * MB)).toContain("Vidéo trop lourde (60 Mo, 50 Mo au plus)");
    expect(agentUploadProblem("reference", "image/webp", 2 * MB)).toBeNull();
    expect(agentUploadProblem("reference", "video/mp4", 2 * MB)).toContain("image JPEG, PNG ou WebP");
    expect(agentUploadProblem("reference", "image/png", 12 * MB)).toContain("Image trop lourde");
    expect(agentUploadProblem("reference", "image/png", 0)).toBe("Fichier vide.");
  });

  it("fichier déjà en base : rangé pour la même persona, refusé pour une autre ou rangé autrement", () => {
    expect(existingAssetProblem({ personaId: null, kind: null }, { personaId: "p1", kind: "SOURCE" })).toBeNull();
    expect(existingAssetProblem({ personaId: "p1", kind: "SOURCE" }, { personaId: "p1", kind: "SOURCE" })).toBeNull();
    expect(existingAssetProblem({ personaId: "p2", kind: "SOURCE" }, { personaId: "p1", kind: "SOURCE" })).toContain(
      "autre persona",
    );
    expect(existingAssetProblem({ personaId: "p1", kind: "GENERATED" }, { personaId: "p1", kind: "SOURCE" })).toContain(
      "rangé autrement",
    );
    expect(existingAssetProblem({ personaId: null, kind: "PHOTO" }, { personaId: "p1", kind: "REFERENCE" })).toBeNull();
  });

  it("noms des fournisseurs", () => {
    expect(providerLabel("fal")).toBe("fal.ai");
    expect(providerLabel("magichour")).toBe("Magic Hour");
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
