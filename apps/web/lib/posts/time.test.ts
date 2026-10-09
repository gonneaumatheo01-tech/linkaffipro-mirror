import { describe, expect, it } from "vitest";
import { fromParisLocal, startOfParisWeek, toParisLocalInput } from "./time";

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
