import { describe, expect, it } from "vitest";
import type { PickerEmoji } from "@/lib/custom-emoji/library";
import {
  emojiButtonLabel,
  gridMove,
  initialTab,
  NO_PACK_TAB,
  pickerItems,
  pickerTabs,
  RECENT_TAB,
  tabMove,
} from "./picker-logic";

const e = (
  id: string,
  fallback: string,
  setName: string | null,
  setTitle: string | null,
  lastUsedAt: string | null = null,
): PickerEmoji => ({
  id,
  fallback,
  setName,
  setTitle,
  format: "tgs",
  hasPreview: true,
  useCount: lastUsedAt ? 1 : 0,
  lastUsedAt,
});

const items = [
  e("1", "🎰", "casino", "Casino Royal", "2026-10-10T10:00:00Z"),
  e("2", "💰", "casino", "Casino Royal"),
  e("3", "⚽", "foot", "Foot animé", "2026-10-11T10:00:00Z"),
  e("4", "⭐", null, null),
];

describe("onglets du sélecteur", () => {
  it("récents de l'équipe d'abord, puis un onglet par pack, sans pack en dernier", () => {
    expect(pickerTabs(items)).toEqual([
      { key: RECENT_TAB, label: "Récents de l'équipe", count: 2 },
      { key: "casino", label: "Casino Royal", count: 2 },
      { key: "foot", label: "Foot animé", count: 1 },
      { key: NO_PACK_TAB, label: "Autres emojis", count: 1 },
    ]);
  });
  it("aucun emoji utilisé : pas d'onglet des récents", () => {
    expect(pickerTabs([e("2", "💰", "casino", "Casino")]).map((t) => t.key)).toEqual(["casino"]);
    expect(pickerTabs([])).toEqual([]);
  });
  it("emojis d'un onglet, et recherche dans toute la bibliothèque", () => {
    expect(pickerItems(items, RECENT_TAB, "").map((i) => i.id)).toEqual(["3", "1"]);
    expect(pickerItems(items, "casino", "").map((i) => i.id)).toEqual(["1", "2"]);
    expect(pickerItems(items, NO_PACK_TAB, "").map((i) => i.id)).toEqual(["4"]);
    expect(pickerItems(items, "inconnu", "")).toEqual([]);
    expect(pickerItems(items, "casino", "⚽").map((i) => i.id)).toEqual(["3"]);
    expect(pickerItems(items, RECENT_TAB, "royal").map((i) => i.id)).toEqual(["1", "2"]);
  });
  it("onglet de départ : le dernier ouvert s'il existe encore", () => {
    const tabs = pickerTabs(items);
    expect(initialTab(tabs, "foot")).toBe("foot");
    expect(initialTab(tabs, "disparu")).toBe(RECENT_TAB);
    expect(initialTab([], null)).toBe(RECENT_TAB);
  });
  it("nom lu par les lecteurs d'écran", () => {
    expect(emojiButtonLabel(items[0]!)).toBe("Emoji animé 🎰 (Casino Royal)");
    expect(emojiButtonLabel(items[3]!)).toBe("Emoji animé ⭐ (Autres emojis)");
  });
});

describe("clavier", () => {
  it("grille de 8 colonnes : flèches, Début, Fin, pages", () => {
    expect(gridMove(0, "ArrowRight", 20)).toBe(1);
    expect(gridMove(19, "ArrowRight", 20)).toBe(19);
    expect(gridMove(0, "ArrowLeft", 20)).toBe(0);
    expect(gridMove(3, "ArrowDown", 20)).toBe(11);
    expect(gridMove(15, "ArrowDown", 20)).toBe(15);
    expect(gridMove(11, "ArrowUp", 20)).toBe(3);
    expect(gridMove(3, "ArrowUp", 20)).toBe(-1);
    expect(gridMove(7, "Home", 20)).toBe(0);
    expect(gridMove(0, "End", 20)).toBe(19);
    expect(gridMove(0, "PageDown", 100)).toBe(32);
    expect(gridMove(40, "PageUp", 100)).toBe(8);
    expect(gridMove(0, "Enter", 20)).toBeNull();
    expect(gridMove(0, "ArrowRight", 0)).toBeNull();
  });
  it("onglets : flèches en boucle, Début, Fin", () => {
    expect(tabMove(0, "ArrowRight", 3)).toBe(1);
    expect(tabMove(2, "ArrowRight", 3)).toBe(0);
    expect(tabMove(0, "ArrowLeft", 3)).toBe(2);
    expect(tabMove(1, "Home", 3)).toBe(0);
    expect(tabMove(1, "End", 3)).toBe(2);
    expect(tabMove(1, "ArrowDown", 3)).toBeNull();
  });
});
