import { describe, expect, it } from "vitest";
import { mergeViews, nextViewsPoll, viewsInitSince } from "./schedule";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const sent = new Date("2026-10-01T10:00:00Z");
const at = (ms: number) => new Date(sent.getTime() + ms);

describe("nextViewsPoll", () => {
  it("toutes les 15 min (moins 1 min de tolérance) pendant 48 h", () => {
    expect(nextViewsPoll(sent, at(0))?.getTime()).toBe(at(14 * MIN).getTime());
    expect(nextViewsPoll(sent, at(47 * HOUR))?.getTime()).toBe(at(47 * HOUR + 14 * MIN).getTime());
  });
  it("une fois par jour (moins 15 min) entre 48 h et 30 jours", () => {
    expect(nextViewsPoll(sent, at(48 * HOUR))?.getTime()).toBe(at(48 * HOUR + DAY - 15 * MIN).getTime());
    expect(nextViewsPoll(sent, at(10 * DAY))?.getTime()).toBe(at(11 * DAY - 15 * MIN).getTime());
  });
  it("dernier relevé plafonné à 30 jours, puis null", () => {
    expect(nextViewsPoll(sent, at(29 * DAY + 20 * HOUR))?.getTime()).toBe(at(30 * DAY).getTime());
    expect(nextViewsPoll(sent, at(30 * DAY))).toBeNull();
    expect(nextViewsPoll(sent, at(45 * DAY))).toBeNull();
  });
  it("un envoi daté dans le futur est traité comme tout juste envoyé", () => {
    expect(nextViewsPoll(sent, at(-5 * MIN))?.getTime()).toBe(at(-5 * MIN + 14 * MIN).getTime());
  });
});

describe("viewsInitSince / mergeViews", () => {
  it("fenêtre d'initialisation de 30 jours", () => {
    expect(viewsInitSince(at(0)).getTime()).toBe(at(-30 * DAY).getTime());
  });
  it("album : maximum des relevés valides, -1 ignoré, null si rien", () => {
    expect(mergeViews([{ views: 10, forwards: 1 }, { views: 12, forwards: 0 }, { views: -1, forwards: -1 }])).toEqual({ views: 12, forwards: 1 });
    expect(mergeViews([{ views: -1, forwards: -1 }])).toBeNull();
    expect(mergeViews([])).toBeNull();
  });
});
