import { describe, expect, it } from "vitest";
import { calendarReturnParams, channelsReturnPath, withFlash } from "./return-to";

describe("retour après les réglages d'un canal", () => {
  it("n'accepte que la liste ou la fiche d'un canal", () => {
    expect(channelsReturnPath("/channels")).toBe("/channels");
    expect(channelsReturnPath("/channels/ck_12-ab")).toBe("/channels/ck_12-ab");
    expect(channelsReturnPath("/channels/ck1?tab=requests")).toBe("/channels/ck1?tab=requests");
    expect(channelsReturnPath(null)).toBe("/channels");
    expect(channelsReturnPath("https://evil.example/channels")).toBe("/channels");
    expect(channelsReturnPath("//evil.example")).toBe("/channels");
    expect(channelsReturnPath("/channels/../settings")).toBe("/channels");
    expect(channelsReturnPath("/channels/ck1?tab=x&next=/evil")).toBe("/channels");
    expect(channelsReturnPath("/members")).toBe("/channels");
  });

  it("ajoute le message de retour", () => {
    expect(withFlash("/channels", { ok: "Fait." })).toBe("/channels?ok=Fait.");
    expect(withFlash("/channels/ck1?tab=rules", { error: "Non" })).toBe(
      "/channels/ck1?tab=rules&error=Non",
    );
    expect(withFlash("/channels", {})).toBe("/channels");
  });
});

describe("retour vers le calendrier après « Recalculer maintenant »", () => {
  it("garde la semaine, le jour, l'univers, la campagne et la catégorie", () => {
    const f = new FormData();
    f.append("week", "2026-10-19");
    f.append("day", "2026-10-21");
    f.append("vertical", "CASINO");
    f.append("campaignId", "cmp_1");
    f.append("category", "cat-2");
    expect(calendarReturnParams((k) => f.get(k))).toEqual({
      week: "2026-10-19",
      day: "2026-10-21",
      vertical: "CASINO",
      campaignId: "cmp_1",
      category: "cat-2",
    });
  });

  it("ignore les valeurs absentes ou douteuses", () => {
    const f = new FormData();
    f.append("week", "lundi");
    f.append("vertical", "POKER");
    f.append("campaignId", "../x");
    f.append("category", "");
    expect(calendarReturnParams((k) => f.get(k))).toEqual({});
  });
});
