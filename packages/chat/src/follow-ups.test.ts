import { describe, expect, it } from "vitest";
import {
  isQuietHour,
  nextFollowUpAt,
  shiftOutOfQuietHours,
  type FollowUpState,
} from "./follow-ups";

const HOUR = 3_600_000;
const rules = { followUpAfterHours: 24, followUpsMax: 2 };
// 18 octobre 2026 : heure d'été à Paris (UTC+2). 12:00 UTC = 14:00 Paris.
const noonUtc = new Date("2026-10-18T12:00:00.000Z");
const state = (over: Partial<FollowUpState> = {}): FollowUpState => ({
  status: "BOT",
  stage: "CHAT",
  isMinor: false,
  stoppedAt: null,
  followUpCount: 0,
  lastAssistantAt: noonUtc,
  ...over,
});

describe("relances", () => {
  it("1re relance : followUpAfterHours après le dernier message de l'assistant (au moins 4 h)", () => {
    expect(nextFollowUpAt(state(), rules)).toEqual(new Date(noonUtc.getTime() + 24 * HOUR));
    expect(nextFollowUpAt(state(), { ...rules, followUpAfterHours: 1 })).toEqual(
      new Date(noonUtc.getTime() + 4 * HOUR),
    );
  });

  it("2e relance au moins 24 h après la 1re, jamais plus de 2", () => {
    const after1 = nextFollowUpAt(state({ followUpCount: 1, stage: "FOLLOW_UP" }), {
      ...rules,
      followUpAfterHours: 6,
    });
    expect(after1).toEqual(new Date(noonUtc.getTime() + 24 * HOUR));
    expect(nextFollowUpAt(state({ followUpCount: 2, stage: "FOLLOW_UP" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ followUpCount: 2 }), { ...rules, followUpsMax: 5 })).toBeNull();
    expect(nextFollowUpAt(state({ followUpCount: 1 }), { ...rules, followUpsMax: 1 })).toBeNull();
    expect(nextFollowUpAt(state(), { ...rules, followUpsMax: 0 })).toBeNull();
  });

  it("jamais après /stop, un mineur, une reprise par l'équipe, une fermeture, ou après la seule présentation", () => {
    expect(nextFollowUpAt(state({ stoppedAt: noonUtc }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ isMinor: true }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ status: "HUMAN" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ status: "PAUSED" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ status: "CLOSED" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ stage: "CLOSED" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ stage: "CONVERTED" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ stage: "WELCOME" }), rules)).toBeNull();
    expect(nextFollowUpAt(state({ lastAssistantAt: null }), rules)).toBeNull();
    for (const stage of ["CHAT", "PROPOSAL", "LINK_SENT", "FOLLOW_UP"] as const)
      expect(nextFollowUpAt(state({ stage }), rules)).not.toBeNull();
  });

  it("heures calmes (22 h – 9 h Paris) → 10 h", () => {
    // 21:30 UTC = 23:30 Paris → lendemain 10:00 Paris = 08:00 UTC
    expect(shiftOutOfQuietHours(new Date("2026-10-18T21:30:00Z"))).toEqual(
      new Date("2026-10-19T08:00:00Z"),
    );
    // 03:00 UTC = 05:00 Paris → même jour 10:00 Paris
    expect(shiftOutOfQuietHours(new Date("2026-10-18T03:00:00Z"))).toEqual(
      new Date("2026-10-18T08:00:00Z"),
    );
    // 07:30 UTC = 09:30 Paris : pas calme
    const ok = new Date("2026-10-18T07:30:00Z");
    expect(shiftOutOfQuietHours(ok)).toBe(ok);
    // 20:00 UTC = 22:00 Paris : calme
    expect(isQuietHour(new Date("2026-10-18T20:00:00Z"))).toBe(true);
    expect(isQuietHour(new Date("2026-10-18T19:59:00Z"))).toBe(false);
    // Hiver (UTC+1) : 22:30 UTC le 31 déc. = 23:30 Paris → 1er janvier 10:00 Paris = 09:00 UTC
    expect(shiftOutOfQuietHours(new Date("2026-12-31T22:30:00Z"))).toEqual(
      new Date("2027-01-01T09:00:00Z"),
    );
    // Changement d'heure (25 oct. 2026) : 01:30 UTC = 02:30 Paris (heure d'hiver) → 10:00 Paris = 09:00 UTC
    expect(shiftOutOfQuietHours(new Date("2026-10-25T01:30:00Z"))).toEqual(
      new Date("2026-10-25T09:00:00Z"),
    );
  });

  it("une relance due la nuit part à 10 h", () => {
    // dernier message à 23:00 Paris (21:00 UTC) + 24 h → 23:00 Paris le lendemain → décalée au surlendemain 10 h
    const late = state({ lastAssistantAt: new Date("2026-10-18T21:00:00Z") });
    expect(nextFollowUpAt(late, rules)).toEqual(new Date("2026-10-20T08:00:00Z"));
  });
});
