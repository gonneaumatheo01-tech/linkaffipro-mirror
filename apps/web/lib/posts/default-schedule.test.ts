import { describe, expect, it } from "vitest";
import { defaultScheduleAt, QUIET_END_HOUR, QUIET_START_HOUR } from "./default-schedule";
import { toParisLocalInput } from "./time";

const at = (iso: string) => toParisLocalInput(defaultScheduleAt(new Date(iso)));

describe("date proposée par défaut (heure de Paris)", () => {
  it("garde une heure de journée : dans au moins une heure, au quart d'heure suivant", () => {
    // 14:05 Paris (été) → 15:15.
    expect(at("2026-10-09T12:05:00Z")).toBe("2026-10-09T15:15");
    // 06:50 Paris → 07:50 arrondi à 08:00 : début de journée accepté.
    expect(at("2026-10-09T04:50:00Z")).toBe("2026-10-09T08:00");
    // 20:40 Paris → 21:45 : encore avant 22 h.
    expect(at("2026-10-09T18:40:00Z")).toBe("2026-10-09T21:45");
  });

  it("en pleine nuit, propose 18:00 le jour même", () => {
    // 01:15 Paris → 02:15 serait en pleine nuit : 18:00 le même jour.
    expect(at("2026-10-10T23:15:00Z")).toBe("2026-10-11T18:00");
    // 06:30 Paris → 07:30 : encore la nuit, 18:00 le jour même.
    expect(at("2026-10-11T04:30:00Z")).toBe("2026-10-11T18:00");
  });

  it("le soir après 21 h, propose 18:00 le lendemain", () => {
    // 21:30 Paris → 22:30 : 18:00 du jour est passé, donc le lendemain.
    expect(at("2026-10-09T19:30:00Z")).toBe("2026-10-10T18:00");
    // 23:50 Paris → 00:50 le lendemain : 18:00 ce lendemain-là.
    expect(at("2026-10-09T21:50:00Z")).toBe("2026-10-10T18:00");
  });

  it("passe le changement d'heure et le dernier jour du mois", () => {
    // Samedi 24 octobre, 23:00 Paris (été) → dimanche 25 (hiver) 18:00 = 17:00 UTC.
    expect(defaultScheduleAt(new Date("2026-10-24T21:00:00Z")).toISOString()).toBe(
      "2026-10-25T17:00:00.000Z",
    );
    // 31 octobre, 22:30 Paris → 1er novembre 18:00.
    expect(at("2026-10-31T21:30:00Z")).toBe("2026-11-01T18:00");
  });

  it("la nuit va de 22 h à 8 h", () => {
    expect(QUIET_START_HOUR).toBe(22);
    expect(QUIET_END_HOUR).toBe(8);
  });
});
