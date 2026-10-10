import { describe, expect, it } from "vitest";
import {
  addDayKey,
  calendarHref,
  canEdit,
  canMove,
  countByDay,
  dayAgenda,
  dayLabelLong,
  dayLabelShort,
  dayNeighbours,
  dropTarget,
  isDayKey,
  isPastLocal,
  isPastSlot,
  momentLabel,
  mondayOf,
  newPostHref,
  placeInWeek,
  presetScheduleLocal,
  resolveDay,
  resolveWeek,
  slotStartLocal,
  splitLocal,
  visibleHours,
  weekDayKeys,
  weekLabel,
  weekdayOf,
  type DaySlot,
} from "./calendar";
import { fromParisLocal } from "./time";

// Vendredi 9 octobre 2026, 14:00 à Paris (heure d'été, UTC+2).
const NOW = new Date("2026-10-09T12:00:00Z");

describe("jours du calendrier (date de Paris)", () => {
  it("reconnaît une vraie date", () => {
    expect(isDayKey("2026-10-05")).toBe(true);
    expect(isDayKey("2026-02-31")).toBe(false);
    expect(isDayKey("2026-10-5")).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
  it("trouve le lundi et les 7 jours de la semaine", () => {
    expect(weekdayOf("2026-10-05")).toBe(1);
    expect(weekdayOf("2026-10-11")).toBe(7);
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(weekDayKeys("2026-10-05")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });
  it("passe la semaine du changement d'heure sans sauter ni répéter (fin octobre)", () => {
    // Le 25 octobre 2026 dure 25 h : ajouter 7 × 24 h à un instant retomberait le dimanche soir.
    expect(addDayKey("2026-10-19", 7)).toBe("2026-10-26");
    expect(resolveWeek("2026-10-26")).toBe("2026-10-26");
    expect(weekDayKeys("2026-10-19").at(-1)).toBe("2026-10-25");
    expect(addDayKey("2026-03-23", 7)).toBe("2026-03-30");
  });
  it("semaine demandée, sinon semaine en cours", () => {
    expect(resolveWeek("2026-10-14", NOW)).toBe("2026-10-12");
    expect(resolveWeek(undefined, NOW)).toBe("2026-10-05");
    expect(resolveWeek("n'importe quoi", NOW)).toBe("2026-10-05");
    // Dimanche 23:30 à Paris = déjà lundi en UTC ? Non : 21:30 UTC, toujours dimanche.
    expect(resolveWeek(undefined, new Date("2026-10-11T21:30:00Z"))).toBe("2026-10-05");
  });
  it("jour affiché sur téléphone : demandé, sinon aujourd'hui, sinon lundi", () => {
    expect(resolveDay("2026-10-07", "2026-10-05", NOW)).toBe("2026-10-07");
    expect(resolveDay(undefined, "2026-10-05", NOW)).toBe("2026-10-09");
    expect(resolveDay("2026-10-20", "2026-10-05", NOW)).toBe("2026-10-09");
    expect(resolveDay(undefined, "2026-10-12", NOW)).toBe("2026-10-12");
  });
});

describe("libellés", () => {
  it("« Semaine du 5 au 11 octobre » (plus de date tronquée)", () => {
    expect(weekLabel("2026-10-05", "2026-10-09")).toBe("Semaine du 5 au 11 octobre");
  });
  it("semaine à cheval sur deux mois, ou une autre année", () => {
    expect(weekLabel("2026-09-28", "2026-10-09")).toBe("Semaine du 28 septembre au 4 octobre");
    expect(weekLabel("2025-10-06", "2026-10-09")).toBe("Semaine du 6 au 12 octobre 2025");
    expect(weekLabel("2025-12-29", "2026-01-02")).toBe(
      "Semaine du 29 décembre 2025 au 4 janvier 2026",
    );
    expect(weekLabel("2026-06-01", "2026-10-09")).toBe("Semaine du 1er au 7 juin");
  });
  it("jours courts et longs", () => {
    expect(dayLabelShort("2026-10-05")).toBe("lun. 5 oct.");
    expect(dayLabelLong("2026-10-11")).toBe("dimanche 11 octobre");
    expect(momentLabel("2026-10-06T19:30")).toBe("mardi 6 octobre à 19:30");
  });
});

describe("placement dans la grille", () => {
  const items = [
    { id: "b", local: "2026-10-06T19:30" },
    { id: "a", local: "2026-10-06T19:05" },
    { id: "c", local: "2026-10-06T07:00" },
    { id: "hors", local: "2026-10-13T10:00" },
  ];
  const days = weekDayKeys("2026-10-05");
  it("range les messages par jour et par heure, triés par minute", () => {
    const grid = placeInWeek(items, days);
    expect(grid.get("2026-10-06:19")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(grid.get("2026-10-06:7")?.map((i) => i.id)).toEqual(["c"]);
    expect([...grid.values()].flat().some((i) => i.id === "hors")).toBe(false);
  });
  it("compte les messages de chaque jour", () => {
    expect(countByDay(items, days)["2026-10-06"]).toBe(3);
    expect(countByDay(items, days)["2026-10-07"]).toBe(0);
  });
  it("affiche 6 h → 23 h, et plus tôt si un message tombe la nuit", () => {
    expect(visibleHours([])).toHaveLength(18);
    expect(visibleHours([19])[0]).toBe(6);
    expect(visibleHours([2, 19])[0]).toBe(2);
    expect(visibleHours([2]).at(-1)).toBe(23);
  });
  it("lit une heure de Paris", () => {
    expect(splitLocal("2026-10-06T19:30")).toEqual({ day: "2026-10-06", hour: 19, minute: 30 });
    expect(splitLocal("2026-10-06T25:00")).toBeNull();
    expect(splitLocal("2026-10-06 19:30")).toBeNull();
  });
});

describe("glisser-déposer : conversion en date de Paris", () => {
  it("garde les minutes du message, prend le jour et l'heure de la case", () => {
    expect(dropTarget("2026-10-06T19:30", "2026-10-08", 12)).toBe("2026-10-08T12:30");
    expect(dropTarget("2026-10-06T19:05", "2026-10-06", 21)).toBe("2026-10-06T21:05");
  });
  it("la date de Paris devient l'instant UTC correct, été comme hiver", () => {
    expect(fromParisLocal(dropTarget("2026-10-06T19:30", "2026-10-08", 12))!.toISOString()).toBe(
      "2026-10-08T10:30:00.000Z",
    );
    // Après le changement d'heure (26 octobre), Paris = UTC+1.
    expect(fromParisLocal(dropTarget("2026-10-23T09:00", "2026-10-26", 9))!.toISOString()).toBe(
      "2026-10-26T08:00:00.000Z",
    );
  });
  it("refuse le passé (tolérance d'une minute, comme le formulaire)", () => {
    expect(isPastLocal("2026-10-09T13:59", NOW)).toBe(false);
    expect(isPastLocal("2026-10-09T13:58", NOW)).toBe(true);
    expect(isPastLocal("2026-10-09T15:00", NOW)).toBe(false);
    expect(isPastLocal("pas une date", NOW)).toBe(true);
  });
  it("une case est passée quand son heure est finie", () => {
    expect(isPastSlot("2026-10-09", 13, NOW)).toBe(true);
    expect(isPastSlot("2026-10-09", 14, NOW)).toBe(false);
    expect(isPastSlot("2026-10-08", 23, NOW)).toBe(true);
    expect(isPastSlot("2026-10-10", 6, NOW)).toBe(false);
  });
  it("seuls un brouillon et un message programmé se déplacent", () => {
    expect(canMove({ status: "SCHEDULED" })).toBe(true);
    expect(canMove({ status: "DRAFT" })).toBe(true);
    for (const s of ["SENT", "SENDING", "DELETED", "FAILED", "CANCELLED"])
      expect(canMove({ status: s })).toBe(false);
    expect(canMove({ status: "DRAFT", isTemplate: true })).toBe(false);
    expect(canEdit({ status: "FAILED" })).toBe(true);
    expect(canEdit({ status: "SENT" })).toBe(false);
  });
});

describe("navigation et adresses", () => {
  it("garde les filtres (campagne, canal, univers, catégorie)", () => {
    expect(
      calendarHref({
        week: "2026-10-12",
        campaignId: "c1",
        channelId: "ch1",
        vertical: "CASINO",
        categoryId: "k1",
      }),
    ).toBe("/messages?week=2026-10-12&channelId=ch1&vertical=CASINO&campaignId=c1&category=k1");
    expect(calendarHref({})).toBe("/messages");
  });
  it("jour précédent / suivant, en changeant de semaine aux bords", () => {
    expect(dayNeighbours("2026-10-05")).toEqual({
      prev: { day: "2026-10-04", week: "2026-09-28" },
      next: { day: "2026-10-06", week: "2026-10-05" },
    });
    expect(dayNeighbours("2026-10-11").next).toEqual({ day: "2026-10-12", week: "2026-10-12" });
  });
  it("« Programmer un message à ce créneau » pré-remplit date, heure et canal", () => {
    expect(newPostHref({ local: "2026-10-06T19:00", channelId: "ch1" })).toBe(
      "/messages/new?at=2026-10-06T19%3A00&channel=ch1",
    );
    expect(newPostHref({})).toBe("/messages/new");
  });
});

describe("vue « jour » du téléphone", () => {
  const slots: DaySlot[] = [
    { day: "2026-10-09", hour: 19, rank: 1, label: "vendredi 19 h", detail: "4 clics par message" },
    { day: "2026-10-09", hour: 9, rank: 2, label: "vendredi 9 h", detail: "3 clics par message" },
    { day: "2026-10-09", hour: 12, rank: 3, label: "vendredi 12 h", detail: "2 clics par message" },
    { day: "2026-10-10", hour: 10, rank: 3, label: "samedi 10 h", detail: "2 clics par message" },
  ];
  const items = [
    { id: "p1", local: "2026-10-09T12:15" },
    { id: "p2", local: "2026-10-09T08:00" },
    { id: "autre-jour", local: "2026-10-10T08:00" },
  ];
  it("messages du jour et créneaux libres, dans l'ordre des heures", () => {
    const a = dayAgenda(items, slots, "2026-10-09", NOW);
    expect(a.map((e) => e.key)).toEqual(["p2", "slot-2026-10-09-9", "p1", "slot-2026-10-09-19"]);
  });
  it("un créneau déjà occupé n'est pas proposé ; un créneau passé est marqué", () => {
    const a = dayAgenda(items, slots, "2026-10-09", NOW);
    expect(a.some((e) => e.key === "slot-2026-10-09-12")).toBe(false);
    const nine = a.find((e) => e.key === "slot-2026-10-09-9");
    expect(nine?.kind === "slot" && nine.past).toBe(true);
    const evening = a.find((e) => e.key === "slot-2026-10-09-19");
    expect(evening?.kind === "slot" && evening.past).toBe(false);
  });
});

describe("case de l'heure en cours : l'heure proposée reste dans cette heure", () => {
  // NOW = vendredi 9 octobre 2026, 14:00 (Paris) ; 14:20 et 14:58 ci-dessous.
  const at1420 = fromParisLocal("2026-10-09T14:20")!;
  const at1458 = fromParisLocal("2026-10-09T14:58")!;
  it("case à venir : son heure pleine ; case en cours : maintenant arrondi aux 5 minutes suivantes", () => {
    expect(slotStartLocal("2026-10-09", 16, at1420)).toBe("2026-10-09T16:00");
    expect(slotStartLocal("2026-10-09", 14, at1420)).toBe("2026-10-09T14:25");
    expect(slotStartLocal("2026-10-09", 14, fromParisLocal("2026-10-09T14:23")!)).toBe(
      "2026-10-09T14:25",
    );
    expect(slotStartLocal("2026-10-09", 14, at1458)).toBe("2026-10-09T15:00");
  });
  it("formulaire : `at` à venir gardé, `at` de l'heure en cours ramené à maintenant, passé refusé", () => {
    expect(presetScheduleLocal("2026-10-09T16:00", at1420)).toBe("2026-10-09T16:00");
    expect(presetScheduleLocal("2026-10-09T14:00", at1420)).toBe("2026-10-09T14:25");
    expect(presetScheduleLocal("2026-10-09T13:00", at1420)).toBeNull();
    expect(presetScheduleLocal("2026-10-08T14:00", at1420)).toBeNull();
    expect(presetScheduleLocal("pas une date", at1420)).toBeNull();
    expect(presetScheduleLocal(undefined, at1420)).toBeNull();
    expect(presetScheduleLocal(["2026-10-09T16:00"], at1420)).toBeNull();
  });
});
