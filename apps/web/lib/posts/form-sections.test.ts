import { describe, expect, it } from "vitest";
import {
  ADVANCED_DEFAULTS,
  advancedModifiedCount,
  initialSections,
  scheduleSummary,
} from "./form-sections";
import { postFormSchema } from "./schema";

describe("formulaire de message : niveau 3 « Avancé »", () => {
  it("les valeurs par défaut sont celles du schéma du formulaire", () => {
    const parsed = postFormSchema.parse({ channelIds: ["c"], intent: "draft" });
    expect(parsed.pinAfterSend).toBe(ADVANCED_DEFAULTS.pinAfterSend);
    expect(parsed.unpinPrevious).toBe(ADVANCED_DEFAULTS.unpinPrevious);
    expect(parsed.disableNotification).toBe(ADVANCED_DEFAULTS.disableNotification);
    expect(parsed.protectContent).toBe(ADVANCED_DEFAULTS.protectContent);
    expect(parsed.disableLinkPreview).toBe(ADVANCED_DEFAULTS.disableLinkPreview);
    expect(parsed.language).toBe(ADVANCED_DEFAULTS.language);
    expect(String(parsed.abDelayMinutes)).toBe(ADVANCED_DEFAULTS.abDelayMinutes);
    expect(parsed.deleteAfterMinutes).toBeNull();
  });
  it("compte les réglages modifiés", () => {
    expect(advancedModifiedCount(ADVANCED_DEFAULTS)).toBe(0);
    expect(
      advancedModifiedCount({
        ...ADVANCED_DEFAULTS,
        pinAfterSend: true,
        disableLinkPreview: false,
        deleteAfterMinutes: "60",
      }),
    ).toBe(3);
    expect(advancedModifiedCount({ ...ADVANCED_DEFAULTS, language: "EN" })).toBe(1);
    expect(advancedModifiedCount({ ...ADVANCED_DEFAULTS, language: " " })).toBe(0);
    expect(advancedModifiedCount({ ...ADVANCED_DEFAULTS, abDelayMinutes: "45" })).toBe(1);
    const { abDelayMinutes: _unused, ...withoutAb } = ADVANCED_DEFAULTS;
    expect(advancedModifiedCount(withoutAb)).toBe(0);
  });
});

describe("formulaire de message : niveau 2 « un clic »", () => {
  it("médias et boutons ouverts d'office seulement s'ils ont un contenu", () => {
    expect(initialSections({ mediaCount: 0, buttonRows: 0 })).toEqual({
      media: false,
      buttons: false,
    });
    expect(initialSections({ mediaCount: 2, buttonRows: 0 })).toEqual({
      media: true,
      buttons: false,
    });
    expect(initialSections({ mediaCount: 0, buttonRows: 1 })).toEqual({
      media: false,
      buttons: true,
    });
  });
});

describe("récapitulatif avant « Programmer »", () => {
  it("dit quand et où le message part (heure de Paris)", () => {
    expect(scheduleSummary({ scheduledAt: "2026-10-06T14:30", channelCount: 1 })).toBe(
      "Partira le mardi 6 octobre à 14:30.",
    );
    expect(scheduleSummary({ scheduledAt: "2026-10-06T14:30", channelCount: 3 })).toBe(
      "Partira le mardi 6 octobre à 14:30 dans 3 canaux.",
    );
  });
  it("test A/B", () => {
    expect(
      scheduleSummary({
        scheduledAt: "2026-10-06T14:30",
        channelCount: 1,
        ab: { mode: "same-channel", delayMinutes: "45" },
      }),
    ).toBe("Partira le mardi 6 octobre à 14:30, version B 45 minutes plus tard.");
    expect(
      scheduleSummary({
        scheduledAt: "2026-10-06T14:30",
        channelCount: 1,
        ab: { mode: "other-channel", delayMinutes: "" },
      }),
    ).toContain("même heure dans l'autre canal");
  });
  it("dit ce qu'il manque", () => {
    expect(scheduleSummary({ scheduledAt: "", channelCount: 1 })).toMatch(/date/);
    expect(scheduleSummary({ scheduledAt: "2026-10-06T14:30", channelCount: 0 })).toMatch(/canal/);
  });
});
