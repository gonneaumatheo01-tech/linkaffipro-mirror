import { describe, expect, it } from "vitest";
import { parseSiteDate } from "./dates";

const NOW = new Date("2026-10-25T10:00:00Z");

describe("relecture adverse : jamais une date de match inventée", () => {
  it("jour écrit en lettres : illisible (null), jamais aujourd'hui", () => {
    expect(parseSiteDate("Sam. 26 oct. 21:00", "Europe/Paris", NOW)).toBeNull();
    expect(parseSiteDate("Samedi 21:00", "Europe/Paris", NOW)).toBeNull();
  });
  it("heure seule ou « Aujourd'hui » : aujourd'hui", () => {
    const today = new Date("2026-10-25T20:00:00Z").getTime();
    expect(parseSiteDate("21:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("21:00:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("Aujourd'hui 21h00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("Today, 21:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
  });
});
