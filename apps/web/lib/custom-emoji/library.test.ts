import { describe, expect, it } from "vitest";
import { fmtNum } from "@/lib/format";
import {
  addedSummary,
  emojiCount,
  groupByPack,
  packLabel,
  packRows,
  recentEmojis,
  searchEmojis,
  stickerFormat,
} from "./library";

const e = (fallback: string, setName: string | null, setTitle: string | null = null) => ({
  fallback,
  setName,
  setTitle,
});

describe("format et pack", () => {
  it("format d'un autocollant Telegram", () => {
    expect(stickerFormat({ is_animated: true, is_video: false })).toBe("tgs");
    expect(stickerFormat({ is_animated: false, is_video: true })).toBe("webm");
    expect(stickerFormat({})).toBe("webp");
  });
  it("nom affiché d'un pack", () => {
    expect(packLabel({ setTitle: "Casino Pack", setName: "CasinoPack" })).toBe("Casino Pack");
    expect(packLabel({ setTitle: null, setName: "CasinoPack" })).toBe("CasinoPack");
    expect(packLabel({ setTitle: null, setName: null })).toBe("Autres emojis");
  });
  it("regroupe par pack, ordre alphabétique, sans pack en dernier, ordre du pack gardé", () => {
    const groups = groupByPack([
      e("🎰", "Zeta", "Zêta"),
      e("⭐", null),
      e("🔥", "alpha", "Alpha"),
      e("💰", "Zeta", "Zêta"),
      e("🎲", "ALPHA", "Alpha"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Alpha", "Zêta", "Autres emojis"]);
    expect(groups[0]!.items.map((i) => i.fallback)).toEqual(["🔥", "🎲"]);
    expect(groups[1]!.items.map((i) => i.fallback)).toEqual(["🎰", "💰"]);
  });
});

describe("recherche", () => {
  const items = [
    e("🔥", "HotPack", "Feu et flammes"),
    e("❤️", "Love", "Cœurs animés"),
    e("🎰", "Casino", "Casino Royal"),
    e("👍🏽", null),
  ];
  it("par emoji (variation et couleur de peau tolérées)", () => {
    expect(searchEmojis(items, "🔥").map((i) => i.fallback)).toEqual(["🔥"]);
    expect(searchEmojis(items, "❤").map((i) => i.fallback)).toEqual(["❤️"]);
    expect(searchEmojis(items, "👍").map((i) => i.fallback)).toEqual(["👍🏽"]);
  });
  it("par nom de pack, sans accents ni majuscules", () => {
    expect(searchEmojis(items, "coeurs").map((i) => i.fallback)).toEqual(["❤️"]);
    expect(searchEmojis(items, "casino roy").map((i) => i.fallback)).toEqual(["🎰"]);
    expect(searchEmojis(items, "hotpack").map((i) => i.fallback)).toEqual(["🔥"]);
    expect(searchEmojis(items, "rien")).toEqual([]);
  });
  it("requête vide : tout", () => {
    expect(searchEmojis(items, "  ")).toHaveLength(4);
  });
});

describe("récents de l'équipe", () => {
  it("les derniers utilisés d'abord, jamais les emojis jamais utilisés", () => {
    const list = [
      { id: "a", lastUsedAt: "2026-10-01T10:00:00Z", useCount: 5 },
      { id: "b", lastUsedAt: null, useCount: 0 },
      { id: "c", lastUsedAt: "2026-10-11T10:00:00Z", useCount: 1 },
      { id: "d", lastUsedAt: "2026-10-11T10:00:00Z", useCount: 3 },
    ];
    expect(recentEmojis(list).map((i) => i.id)).toEqual(["d", "c", "a"]);
    expect(recentEmojis(list, 1).map((i) => i.id)).toEqual(["d"]);
  });
});

describe("phrases", () => {
  it("compte au singulier et au pluriel", () => {
    expect(emojiCount(1)).toBe("1 emoji animé");
    expect(emojiCount(1200)).toBe(`${fmtNum(1200)} emojis animés`);
  });
  it("retour après un ajout", () => {
    expect(addedSummary(6, 0)).toBe("6 emojis animés ajoutés ✅.");
    expect(addedSummary(6, 2)).toBe("6 emojis animés ajoutés ✅ (2 déjà dans la bibliothèque).");
    expect(addedSummary(1, 0)).toBe("1 emoji animé ajouté ✅.");
    expect(addedSummary(0, 40)).toBe(
      "Rien de nouveau : les 40 emojis animés étaient déjà dans la bibliothèque.",
    );
    expect(addedSummary(0, 1)).toBe(
      "Rien de nouveau : cet emoji animé était déjà dans la bibliothèque.",
    );
    expect(addedSummary(0, 0)).toBe("Aucun emoji animé trouvé.");
  });
});

describe("emojis d'un pack", () => {
  it("identifiants valides seulement, sans doublon, emoji de remplacement du pack", () => {
    expect(
      packRows([
        { custom_emoji_id: "111", emoji: "🔥", is_animated: true },
        { custom_emoji_id: "111", emoji: "🔥", is_animated: true },
        { custom_emoji_id: "abc", emoji: "x" },
        { emoji: "🙂" },
        { custom_emoji_id: "222", is_video: true },
      ]),
    ).toEqual([
      { customEmojiId: "111", fallback: "🔥", format: "tgs" },
      { customEmojiId: "222", fallback: "⭐", format: "webm" },
    ]);
  });
});
