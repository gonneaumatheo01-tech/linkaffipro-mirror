import { describe, expect, it } from "vitest";
import {
  addTheme,
  casinoClassification,
  casinoExistingProblem,
  casinoMixText,
  casinoUploadProblem,
  groupStock,
  mediaThemes,
  mergeCasinoSettings,
  parseCasinoPlanThemesForm,
  parseCasinoSettings,
  parseCasinoTeamForm,
  parseClassifyForm,
  parseMediaRequest,
  parsePlanThemes,
  planThemesText,
  removeTheme,
  renameTheme,
  themeKeyFromLabel,
  themeLabel,
} from "./casino";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

describe("équipe Casino : réglages", () => {
  it("thèmes de départ, libellés français, seuil 3 et rotation 30 par défaut", () => {
    const s = parseCasinoSettings(null);
    expect(s.themes.map((t) => t.key)).toContain("machines-a-sous");
    expect(s.themes.find((t) => t.key === "machines-a-sous")!.label).toBe("Machines à sous");
    expect(s).toMatchObject({ lowStock: 3, rotationDays: 30 });
    expect(themeLabel("poker")).toBe("Poker");
  });

  it("fusion : les autres clés du moteur sont gardées, libellés renommés relus", () => {
    const before = { other: 1, casino: { themes: ["roulette"], extra: true } };
    const merged = mergeCasinoSettings(before, {
      themes: [
        { key: "roulette", label: "La roulette" },
        { key: "bonus", label: "Bonus" },
      ],
      lowStock: 4,
      rotationDays: 20,
    });
    expect(merged).toEqual({
      other: 1,
      casino: {
        themes: ["roulette", "bonus"],
        extra: true,
        themeLabels: { roulette: "La roulette" },
        lowStock: 4,
        rotationDays: 20,
      },
    });
    const s = parseCasinoSettings(merged);
    expect(s.themes).toEqual([
      { key: "roulette", label: "La roulette" },
      { key: "bonus", label: "Bonus" },
    ]);
  });

  it("seuil et rotation bornés", () => {
    expect(parseCasinoTeamForm(fd({ casinoLowStock: "3", casinoRotationDays: "30" }))).toEqual({
      ok: true,
      data: { lowStock: 3, rotationDays: 30 },
    });
    expect(parseCasinoTeamForm(fd({ casinoLowStock: "0", casinoRotationDays: "30" })).ok).toBe(
      false,
    );
    expect(parseCasinoTeamForm(fd({ casinoLowStock: "3", casinoRotationDays: "400" })).ok).toBe(
      false,
    );
  });

  it("ajout, renommage, retrait des thèmes", () => {
    const base = parseCasinoSettings(null).themes;
    expect(themeKeyFromLabel("Poker à gogo !")).toBe("poker-a-gogo");
    expect(themeKeyFromLabel("!!!")).toBeNull();
    const added = addTheme(base, "Poker");
    expect(added.ok && added.data.at(-1)).toEqual({ key: "poker", label: "Poker" });
    expect(addTheme(base, "Roulette").ok).toBe(false);
    const renamed = renameTheme(base, "live", "Tables en direct");
    expect(renamed.ok && renamed.data.find((t) => t.key === "live")!.label).toBe(
      "Tables en direct",
    );
    expect(renameTheme(base, "inconnu", "X").ok).toBe(false);
    expect(removeTheme(base, "live", { media: 2, channels: [] })).toEqual({
      ok: false,
      error: "« Casino en direct » a encore 2 médias : il ne peut pas être retiré.",
    });
    expect(removeTheme(base, "live", { media: 0, channels: ["VIP"] }).ok).toBe(false);
    const removed = removeTheme(base, "live", { media: 0, channels: [] });
    expect(removed.ok && removed.data.some((t) => t.key === "live")).toBe(false);
  });
});

describe("équipe Casino : plan, médias, stock, demandes", () => {
  const themes = parseCasinoSettings(null).themes;

  it("thèmes du canal avec poids", () => {
    const r = parseCasinoPlanThemesForm(
      fd({
        ptheme_roulette: "on",
        pweight_roulette: "2",
        ptheme_bonus: "on",
        pweight_bonus: "",
        pweight_live: "5",
      }),
      themes,
    );
    expect(r).toEqual({
      ok: true,
      data: [
        { theme: "roulette", weight: 2 },
        { theme: "bonus", weight: 1 },
      ],
    });
    expect(
      parseCasinoPlanThemesForm(fd({ ptheme_roulette: "on", pweight_roulette: "11" }), themes).ok,
    ).toBe(false);
    expect(
      parsePlanThemes(["roulette", { theme: "bonus", weight: 3 }, { theme: "bonus" }]),
    ).toEqual([
      { theme: "roulette", weight: 1 },
      { theme: "bonus", weight: 3 },
    ]);
    expect(
      planThemesText(
        [
          { theme: "roulette", weight: 2 },
          { theme: "bonus", weight: 1 },
        ],
        themes,
      ),
    ).toBe("Roulette ×2, Bonus");
    expect(casinoMixText({ video: 2, photo: 1, text: 1 })).toBe("2 vidéos, 1 image, 1 texte");
  });

  it("classement : un thème connu au moins", () => {
    expect(parseClassifyForm(fd({ assetId: "a1", theme: ["roulette", "bonus"] }), themes)).toEqual({
      ok: true,
      data: { assetId: "a1", themes: ["roulette", "bonus"] },
    });
    expect(parseClassifyForm(fd({ assetId: "a1" }), themes).ok).toBe(false);
    expect(parseClassifyForm(fd({ assetId: "a1", theme: "poker" }), themes).ok).toBe(false);
    expect(
      mediaThemes({ theme: "roulette", tags: ["casino", "theme:roulette", "theme:bonus"] }),
    ).toEqual(["roulette", "bonus"]);
  });

  it("dépôt : types, tailles, origine humaine, jamais un média de l'IA", () => {
    expect(casinoUploadProblem("video/mp4", 10)).toBeNull();
    expect(casinoUploadProblem("image/png", 10)).toBeNull();
    expect(casinoUploadProblem("application/pdf", 10)).toContain("MP4");
    expect(casinoUploadProblem("image/png", 11 * 1024 * 1024)).toContain("Image trop lourde");
    expect(casinoClassification("video/mp4", ["roulette", "bonus"])).toEqual({
      teamKey: "casino",
      origin: "HUMAN",
      kind: "SOURCE",
      theme: "roulette",
      tags: ["casino", "theme:roulette", "theme:bonus"],
    });
    expect(casinoClassification("image/jpeg", ["bonus"]).kind).toBe("PHOTO");
    expect(casinoExistingProblem({ teamKey: "casino", origin: "AI" })).toContain("IA");
    expect(casinoExistingProblem({ teamKey: "dating", origin: "HUMAN" })).toContain("autre équipe");
    expect(casinoExistingProblem({ teamKey: null, origin: null })).toBeNull();
  });

  it("stock regroupé par canal, ce qui manque d'abord", () => {
    const g = groupStock([
      { channelId: "c1", channelTitle: "VIP", theme: "bonus", unused: 5, state: "ok" },
      { channelId: "c1", channelTitle: "VIP", theme: "roulette", unused: 0, state: "empty" },
      { channelId: "c2", channelTitle: "Free", theme: "live", unused: 2, state: "low" },
    ]);
    expect(g.map((x) => x.channelTitle)).toEqual(["VIP", "Free"]);
    expect(g[0]!.rows.map((r) => r.theme)).toEqual(["roulette", "bonus"]);
  });

  it("demande de vidéos : thèmes tirés des mots-clés attendus", () => {
    const r = parseMediaRequest({
      id: "h1",
      key: "casino.media.roulette",
      expected: { tags: ["casino", "roulette"], count: 5, received: 2, channelId: "c1" },
      status: "PENDING",
      question: "Envoie 5 vidéos",
      createdAt: new Date(),
      askedAt: null,
      answeredAt: null,
    });
    expect(r).toMatchObject({ themes: ["roulette"], channelIds: ["c1"], count: 5, received: 2 });
  });
});
