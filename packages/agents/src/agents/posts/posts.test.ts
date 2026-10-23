import { describe, expect, it } from "vitest";
import { countEmojis, hasButtons, lengthBucket, parisHourDay, postFormat, viewsAt, visibleLength } from "./features";
import { NOT_ENOUGH_DATA, rankDimension, rankAll, type InsightRow } from "./rank";

const T0 = new Date("2026-10-20T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("vues interpolées", () => {
  const samples = [
    { at: at(30), views: 50 },
    { at: at(90), views: 150 },
    { at: at(135), views: 200 },
  ];
  it("interpole entre deux relevés (l'envoi compte pour 0)", () => {
    expect(viewsAt(T0, samples, 1)).toBe(100);
    expect(viewsAt(T0, samples, 2)).toBe(183);
    expect(viewsAt(T0, [{ at: at(120), views: 400 }], 1)).toBe(200);
  });
  it("relevé exact, aucun relevé, ou plus rien après l'instant visé", () => {
    expect(viewsAt(T0, [{ at: at(60), views: 77 }], 1)).toBe(77);
    expect(viewsAt(T0, [], 1)).toBeNull();
    expect(viewsAt(T0, samples, 24)).toBeNull();
    // Dernier relevé 10 min avant l'heure visée : gardé (relevés toutes les 15 min).
    expect(viewsAt(T0, [{ at: at(24 * 60 - 10), views: 900 }], 24)).toBe(900);
  });
});

describe("caractéristiques d'un post", () => {
  const assets = new Map([
    ["v", { id: "v", mimeType: "video/mp4" }],
    ["p", { id: "p", mimeType: "image/jpeg" }],
    ["s", { id: "s", mimeType: "application/octet-stream", kind: "SOURCE" }],
  ]);
  it("format d'après les médias", () => {
    expect(postFormat([], assets)).toBe("TEXT");
    expect(postFormat(["v"], assets)).toBe("VIDEO");
    expect(postFormat(["p"], assets)).toBe("PHOTO");
    expect(postFormat(["s"], assets)).toBe("VIDEO");
    expect(postFormat(["p", "v"], assets)).toBe("ALBUM");
  });
  it("emojis, longueur visible, boutons", () => {
    expect(countEmojis("Salut 🔥 <b>toi</b> 👨‍👩‍👧 &amp; co")).toBe(2);
    expect(countEmojis('<tg-emoji emoji-id="5368324170671202286">😀</tg-emoji> ok')).toBe(1);
    expect(countEmojis("aucun")).toBe(0);
    expect(visibleLength("<b>abc</b> d")).toBe(5);
    expect(lengthBucket(50)).toContain("court");
    expect(lengthBucket(600)).toContain("très long");
    expect(hasButtons([[{ text: "x" }]])).toBe(true);
    expect(hasButtons([[]])).toBe(false);
  });
  it("heure et jour de Paris, changement d'heure compris (25 octobre 2026)", () => {
    expect(parisHourDay(new Date("2026-10-24T17:00:00Z"))).toEqual({ hour: 19, weekday: 6 });
    expect(parisHourDay(new Date("2026-10-26T17:00:00Z"))).toEqual({ hour: 18, weekday: 1 });
    expect(parisHourDay(new Date("2026-10-25T22:30:00Z"))).toEqual({ hour: 23, weekday: 7 });
  });
});

function row(i: number, o: Partial<InsightRow>): InsightRow {
  return {
    postId: `p${i}`,
    channelId: "c1",
    vertical: "DATING",
    format: "TEXT",
    theme: null,
    personaId: null,
    hourParis: 19,
    weekdayParis: 2,
    textLength: 100,
    views2h: 50,
    views24h: 100,
    viewsFinal: 100,
    offerClicks: 1,
    clicks: 1,
    registrations: 0,
    ftds: 0,
    sentAt: T0,
    ...o,
  };
}

describe("classements avec seuils", () => {
  const t = { minPosts: 20, minViews: 1000 };
  it("pas de conclusion sans deux cas comparables", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i, { format: "VIDEO", viewsFinal: 100 }));
    const r = rankDimension(rows, "format", t);
    expect(r.note).toBe(NOT_ENOUGH_DATA);
    expect(r.cases[0]!.enoughData).toBe(false);
    expect(r.works).toEqual([]);
  });
  it("au-dessus / au-dessous de la médiane avec 20 posts ou 1000 vues", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row(i, { format: "VIDEO", offerClicks: 5 })),
      ...Array.from({ length: 20 }, (_, i) => row(100 + i, { format: "PHOTO", offerClicks: 2 })),
      // Peu de posts mais 1200 vues : assez de données.
      ...Array.from({ length: 4 }, (_, i) => row(200 + i, { format: "TEXT", viewsFinal: 300, offerClicks: 0 })),
      // Trop peu : ignoré.
      row(300, { format: "ALBUM", viewsFinal: 10, offerClicks: 5 }),
    ];
    const r = rankDimension(rows, "format", t);
    expect(r.metric).toBe("ctr");
    expect(r.works).toEqual(["VIDEO"]);
    expect(r.weak).toEqual(["TEXT"]);
    expect(r.cases.find((c) => c.key === "PHOTO")!.verdict).toBe("median");
    expect(r.cases.find((c) => c.key === "ALBUM")!.verdict).toBe("insufficient");
    expect(r.cases[0]!.key).toBe("VIDEO");
  });
  it("sans aucun clic offre : classement aux vues à 24 h ; par canal et par univers", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row(i, { hourParis: 19, offerClicks: 0, views24h: 300 })),
      ...Array.from({ length: 20 }, (_, i) => row(50 + i, { hourParis: 9, offerClicks: 0, views24h: 100, channelId: "c2" })),
    ];
    const r = rankDimension(rows, "hour", t);
    expect(r.metric).toBe("views24h");
    expect(r.works).toEqual(["19"]);
    const all = rankAll(rows, t);
    expect(all.channels.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(all.verticals[0]!.posts).toBe(40);
  });
});
