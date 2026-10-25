import { describe, expect, it } from "vitest";
import { fromParisLocal, nextOccurrence, startOfParisWeek, toParisLocalInput } from "./time";

describe("heure de Paris", () => {
  it("convertit un horaire d'été et d'hiver", () => {
    expect(fromParisLocal("2026-07-01T14:30")!.toISOString()).toBe("2026-07-01T12:30:00.000Z");
    expect(fromParisLocal("2026-12-01T14:30")!.toISOString()).toBe("2026-12-01T13:30:00.000Z");
    expect(toParisLocalInput(new Date("2026-10-09T12:05:00Z"))).toBe("2026-10-09T14:05");
  });
  it("trouve le lundi de la semaine", () => {
    expect(toParisLocalInput(startOfParisWeek(new Date("2026-10-09T12:00:00Z")))).toBe("2026-10-05T00:00");
    expect(toParisLocalInput(startOfParisWeek(new Date("2026-10-04T23:30:00Z")))).toBe("2026-10-05T00:00");
  });
});

describe("prochaine occurrence d'un créneau (Paris)", () => {
  // Vendredi 9 octobre 2026, 12:00 UTC = 14:00 à Paris.
  const from = new Date("2026-10-09T12:00:00Z");
  it("renvoie plus tard dans la journée si l'heure n'est pas passée", () => {
    expect(toParisLocalInput(nextOccurrence(5, 19, from))).toBe("2026-10-09T19:00");
  });
  it("passe à la semaine suivante si l'heure est passée aujourd'hui", () => {
    expect(toParisLocalInput(nextOccurrence(5, 9, from))).toBe("2026-10-16T09:00");
  });
  it("trouve le prochain mardi et le prochain dimanche", () => {
    expect(toParisLocalInput(nextOccurrence(2, 19, from))).toBe("2026-10-13T19:00");
    expect(toParisLocalInput(nextOccurrence(7, 0, from))).toBe("2026-10-11T00:00");
  });
  it("laisse au moins 5 minutes et borne les valeurs", () => {
    // 13:57 Paris, créneau 14 h → trop juste : semaine suivante.
    expect(toParisLocalInput(nextOccurrence(5, 14, new Date("2026-10-09T11:57:00Z")))).toBe("2026-10-16T14:00");
    expect(toParisLocalInput(nextOccurrence(9, 30, from))).toBe("2026-10-11T23:00");
  });
  it("passe le changement d'heure (fin octobre)", () => {
    const f = new Date("2026-10-24T12:00:00Z"); // samedi 24 octobre, 14:00 Paris (été)
    expect(nextOccurrence(1, 9, f).toISOString()).toBe("2026-10-26T08:00:00.000Z"); // lundi 26 oct. 9 h hiver = 08:00 UTC
  });
});

describe("fromParisLocal : heure avec fuseau explicite (phase 34, Kevin)", () => {
  it("« …Z » et « …+02:00 » gardent l'instant exact ; l'heure du champ du site reste lue en heure de Paris", () => {
    expect(fromParisLocal("2026-10-26T19:00:00Z")?.toISOString()).toBe("2026-10-26T19:00:00.000Z");
    expect(fromParisLocal("2026-10-26T20:00+01:00")?.toISOString()).toBe("2026-10-26T19:00:00.000Z");
    expect(fromParisLocal("2026-10-26T20:00")?.toISOString()).toBe("2026-10-26T19:00:00.000Z");
  });
});
