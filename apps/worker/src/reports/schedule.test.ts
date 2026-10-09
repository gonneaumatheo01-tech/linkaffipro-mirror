import { describe, expect, it } from "vitest";
import { DEFAULT_REPORTS_CONFIG, dueReports, parisParts, parseReportsConfig } from "./schedule";

describe("configuration des rapports", () => {
  it("applique les valeurs par défaut et tolère les valeurs invalides", () => {
    expect(parseReportsConfig(null)).toEqual(DEFAULT_REPORTS_CONFIG);
    expect(parseReportsConfig({ daily: false, hour: 7.9 })).toEqual({ daily: false, weekly: true, hour: 7 });
    expect(parseReportsConfig({ hour: 30 })).toEqual({ daily: true, weekly: true, hour: 9 });
  });
});

describe("heure de Paris", () => {
  it("convertit en heure, jour de semaine et clé de jour", () => {
    // Lundi 5 octobre 2026, 07:30 UTC = 09:30 Paris (heure d'été).
    expect(parisParts(new Date("2026-10-05T07:30:00Z"))).toEqual({ hour: 9, weekday: 1, dayKey: "2026-10-05" });
    // Dimanche 4 octobre 2026, 23:30 UTC = lundi 01:30 Paris.
    expect(parisParts(new Date("2026-10-04T23:30:00Z"))).toEqual({ hour: 1, weekday: 1, dayKey: "2026-10-05" });
  });
});

describe("rapports dus", () => {
  const config = DEFAULT_REPORTS_CONFIG;
  it("envoie le brief une fois l'heure atteinte, une seule fois par jour", () => {
    const early = new Date("2026-10-06T06:50:00Z"); // mardi 08:50 Paris
    const late = new Date("2026-10-06T07:05:00Z"); // mardi 09:05 Paris
    expect(dueReports({ now: early, config, lastDaily: null, lastWeekly: null })).toEqual({ daily: false, weekly: false, dayKey: "2026-10-06" });
    expect(dueReports({ now: late, config, lastDaily: null, lastWeekly: null })).toEqual({ daily: true, weekly: false, dayKey: "2026-10-06" });
    expect(dueReports({ now: late, config, lastDaily: "2026-10-06", lastWeekly: null }).daily).toBe(false);
  });
  it("envoie l'hebdo le lundi seulement, et respecte l'activation", () => {
    const monday = new Date("2026-10-05T08:00:00Z"); // lundi 10:00 Paris
    expect(dueReports({ now: monday, config, lastDaily: "2026-10-05", lastWeekly: null })).toEqual({ daily: false, weekly: true, dayKey: "2026-10-05" });
    expect(dueReports({ now: monday, config: { ...config, weekly: false }, lastDaily: null, lastWeekly: null }).weekly).toBe(false);
    expect(dueReports({ now: monday, config: { ...config, hour: 12 }, lastDaily: null, lastWeekly: null })).toEqual({ daily: false, weekly: false, dayKey: "2026-10-05" });
  });
});
