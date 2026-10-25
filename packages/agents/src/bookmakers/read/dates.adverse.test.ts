import { describe, expect, it } from "vitest";
import { parseSiteDate } from "./dates";

const NOW = new Date("2026-10-25T10:00:00Z");

describe("relecture adverse : jamais une date de match inventée", () => {
  it("jour de la semaine seul : illisible (null), jamais aujourd'hui ; jour et mois en lettres : lus", () => {
    expect(parseSiteDate("Samedi 21:00", "Europe/Paris", NOW)).toBeNull();
    expect(parseSiteDate("Sam. 26 oct. 21:00", "Europe/Paris", NOW)?.toISOString()).toBe("2026-10-26T20:00:00.000Z");
    // Formats des vrais sites (Betby) : « 28 oct., 18:30 », « Après-demain, 18:30 », « Aujourd’hui21:00 ».
    expect(parseSiteDate("28 oct., 18:30", "Europe/Paris", NOW)?.toISOString()).toBe("2026-10-28T17:30:00.000Z");
    expect(parseSiteDate("Après-demain, 18:30", "Europe/Paris", NOW)?.toISOString()).toBe("2026-10-27T17:30:00.000Z");
    expect(parseSiteDate("Aujourd’hui21:00", "Europe/Paris", NOW)?.toISOString()).toBe("2026-10-25T20:00:00.000Z");
    expect(parseSiteDate("12 janv., 20:00", "Europe/Paris", NOW)?.toISOString()).toBe("2027-01-12T19:00:00.000Z");
    expect(parseSiteDate("14′ 1re mi-temps", "Europe/Paris", NOW)).toBeNull();
  });
  it("heure seule ou « Aujourd'hui » : aujourd'hui", () => {
    const today = new Date("2026-10-25T20:00:00Z").getTime();
    expect(parseSiteDate("21:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("21:00:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("Aujourd'hui 21h00", "Europe/Paris", NOW)?.getTime()).toBe(today);
    expect(parseSiteDate("Today, 21:00", "Europe/Paris", NOW)?.getTime()).toBe(today);
  });
});
