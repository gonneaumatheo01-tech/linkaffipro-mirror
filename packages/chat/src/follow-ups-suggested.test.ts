import { describe, expect, it } from "vitest";
import {
  nextFollowUpAt,
  parseSuggestedFollowUpHours,
  shiftToSuggestedHour,
  type FollowUpState,
} from "./follow-ups";

const HOUR = 3_600_000;
// 18 octobre 2026 : heure d'été (UTC+2). 12:00 UTC = 14:00 Paris.
const noonUtc = new Date("2026-10-18T12:00:00.000Z");
const state: FollowUpState = {
  status: "BOT",
  stage: "CHAT",
  isMinor: false,
  stoppedAt: null,
  followUpCount: 0,
  lastAssistantAt: noonUtc,
};

describe("heures de relance conseillées (phase 21)", () => {
  it("champ vide ou absent : calcul habituel inchangé", () => {
    const base = new Date(noonUtc.getTime() + 24 * HOUR);
    expect(nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2 })).toEqual(base);
    expect(nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: [] })).toEqual(base);
    expect(nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: null })).toEqual(base);
  });

  it("appliquées : la relance part à la prochaine heure conseillée (jamais plus tôt)", () => {
    // Due à 14 h Paris le 19 → prochaine heure conseillée 19 h le 19 (17:00 UTC).
    expect(
      nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: [19, 20] }),
    ).toEqual(new Date("2026-10-19T17:00:00.000Z"));
    // Due à 14 h, conseillée 11 h → lendemain 11 h (pas le matin même, déjà passé).
    expect(
      nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: [11] }),
    ).toEqual(new Date("2026-10-20T09:00:00.000Z"));
    // Heure déjà conseillée : inchangée.
    expect(
      nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: [14] }),
    ).toEqual(new Date(noonUtc.getTime() + 24 * HOUR));
  });

  it("jamais la nuit : les heures calmes conseillées sont ignorées", () => {
    expect(parseSuggestedFollowUpHours([23, 3, 8, 21, 9, 9, 12.5, "10", 22])).toEqual([9, 21]);
    expect(parseSuggestedFollowUpHours([0, 23])).toBeNull();
    expect(parseSuggestedFollowUpHours("19")).toBeNull();
    // Seules des heures de nuit : calcul habituel.
    const base = new Date(noonUtc.getTime() + 24 * HOUR);
    expect(nextFollowUpAt(state, { followUpAfterHours: 24, followUpsMax: 2, suggestedFollowUpHours: [2, 23] })).toEqual(base);
  });

  it("2e relance : toujours au moins 24 h après la 1re, puis heure conseillée", () => {
    const at = nextFollowUpAt(
      { ...state, followUpCount: 1, stage: "FOLLOW_UP" },
      { followUpAfterHours: 4, followUpsMax: 2, suggestedFollowUpHours: [10] },
    );
    expect(at!.getTime()).toBeGreaterThanOrEqual(noonUtc.getTime() + 24 * HOUR);
    expect(at).toEqual(new Date("2026-10-20T08:00:00.000Z"));
  });

  it("changement d'heure (25 octobre) : 19 h de Paris reste 19 h", () => {
    // 24 oct 20:00 UTC = 22 h Paris (été) ; prochaine 19 h = 25 oct 19 h hiver = 18:00 UTC.
    expect(shiftToSuggestedHour(new Date("2026-10-24T20:00:00.000Z"), [19])).toEqual(
      new Date("2026-10-25T18:00:00.000Z"),
    );
  });
});
