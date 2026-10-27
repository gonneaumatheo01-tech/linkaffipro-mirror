import { describe, expect, it } from "vitest";
import { activeSourcePauses } from "../polite";
import { discoverKit, readProspectionFixture } from "../testing";
import { parseCount } from "./common";
import {
  DirectoryLayoutError,
  findDirectoryCandidates,
  parseTelegaList,
  parseTelegramChannelsMeList,
  parseTelemetrList,
  parseTgstatList,
  parseTlgrmList,
} from "./directories";

const fx = (n: string) => readProspectionFixture(`directories/${n}`);

describe("parseurs des annuaires", () => {
  it("nombres affichés", () => {
    expect(parseCount("2 091 922")).toBe(2091922);
    expect(parseCount("12.3k")).toBe(12300);
    expect(parseCount("953K")).toBe(953000);
    expect(parseCount("1,2 M")).toBe(1200000);
    expect(parseCount("3,456 members")).toBe(3456);
    expect(parseCount("12 345 members")).toBe(12345);
    expect(parseCount("—")).toBeNull();
  });

  it("tgstat : username, titre, abonnés, catégorie ; canal privé et bot écartés", () => {
    const l = parseTgstatList(fx("tgstat-gambling.html"), "https://tgstat.com/gambling");
    expect(l).toEqual([
      { username: "pronos_du_coin", title: "Pronos du Coin ⚽", subscribers: 17342, category: "gambling", ficheUrl: "https://tgstat.com/channel/@Pronos_du_Coin", marketplace: null },
      { username: "slots_royale_it", title: "Slots Royale & Bonus", subscribers: 2091922, category: "gambling", ficheUrl: "https://in.tgstat.com/channel/@slots_royale_it", marketplace: null },
    ]);
  });

  it("structure changée → DIRECTORY_LAYOUT_CHANGED, aucune donnée", () => {
    expect(() => parseTgstatList(fx("tgstat-changed.html"), "https://tgstat.com/gambling")).toThrow(DirectoryLayoutError);
    expect(() => parseTelemetrList(fx("tgstat-changed.html"), "x")).toThrow(/DIRECTORY_LAYOUT_CHANGED/);
    expect(() => parseTlgrmList(fx("tgstat-changed.html"), "x")).toThrow(/DIRECTORY_LAYOUT_CHANGED/);
    expect(() => parseTelegramChannelsMeList(fx("tgstat-changed.html"), "x")).toThrow(/DIRECTORY_LAYOUT_CHANGED/);
    expect(() => parseTelegaList(fx("tgstat-changed.html"), "x")).toThrow(/DIRECTORY_LAYOUT_CHANGED/);
  });

  it("telemetr, tlgrm, telegramchannels.me", () => {
    expect(parseTelemetrList(fx("telemetr-france-sport.html"), "https://telemetr.io/en/catalog/france/sport")).toEqual([
      { username: "tipsterlyon", title: "Tipster Lyon", subscribers: 12300, category: "Sport", ficheUrl: "https://telemetr.io/en/channels/1777000001-tipsterlyon", marketplace: null },
      { username: "parisfoot75", title: "Paris Foot 75", subscribers: 4870, category: "Sport", ficheUrl: "https://telemetr.io/en/channels/1777000002-parisfoot75", marketplace: null },
    ]);
    expect(parseTlgrmList(fx("tlgrm-sport.html"), "https://tlgrm.eu/channels/sport").map((l) => [l.username, l.subscribers, l.category])).toEqual([
      ["wettkoenig_de", 25400, "sport"],
      ["schedina_oggi", 1200000, "sport"],
    ]);
    expect(parseTelegramChannelsMeList(fx("telegramchannels-gambling.html"), "https://telegramchannels.me/channels?category=gambling").map((l) => [l.username, l.title, l.subscribers, l.ficheUrl])).toEqual([
      ["kasyno_polska", "Kasyno Polska", 8900, "https://telegramchannels.me/channels/kasyno_polska"],
      ["ruleta_madrid", "Ruleta Madrid", 3456, "https://telegramchannels.me/channels/ruleta_madrid"],
    ]);
  });

  it("telega.io (place de marché) : prix d'un post et fiche", () => {
    const l = parseTelegaList(fx("telega-catalog.html"), "https://telega.io/catalog?category=gambling");
    expect(l).toEqual([
      { username: "bonus_casino_fr", title: "Bonus Casino FR 🎰", subscribers: 23110, category: "Gambling", ficheUrl: "https://telega.io/channels/bonus_casino_fr/card", marketplace: { url: "https://telega.io/channels/bonus_casino_fr/card", price: "40.00 €" } },
      { username: "apuestas_pro_es", title: "Apuestas Pro", subscribers: 9120, category: "Sport", ficheUrl: "https://telega.io/channels/Apuestas_Pro_ES/card", marketplace: { url: "https://telega.io/channels/Apuestas_Pro_ES/card", price: "55 $" } },
    ]);
  });
});

describe("findDirectoryCandidates", () => {
  it("lit chaque annuaire, garde la provenance ; un annuaire changé passe en pause sans bloquer les autres", async () => {
    const no = { status: 404, body: "" };
    const k = discoverKit({
      routes: {
        "https://tgstat.com/robots.txt": no,
        "https://tgstat.com/gambling": { body: fx("tgstat-changed.html") },
        "https://telega.io/robots.txt": no,
        "https://telega.io/catalog?category=gambling&language=fr": { body: fx("telega-catalog.html") },
      },
    });
    const r = await findDirectoryCandidates(k.deps, { source: "directories", languages: ["fr"], vertical: "CASINO" }, ["tgstat", "telega"]);
    expect(r.candidates.map((c) => [c.url, c.sourceType, c.marketplace?.price ?? null])).toEqual([
      ["https://t.me/bonus_casino_fr", "DIRECTORY", "40.00 €"],
      ["https://t.me/apuestas_pro_es", "DIRECTORY", "55 $"],
    ]);
    expect(r.candidates[0]!.announcedSubscribers).toBe(23110);
    expect(r.errors.some((e) => e.includes("DIRECTORY_LAYOUT_CHANGED"))).toBe(true);
    expect(Object.keys(await activeSourcePauses(k.deps))).toEqual(["directory:tgstat.com"]);
    expect(r.paused).toBe(false);
    // Deuxième passage : tgstat n'est plus lu du tout.
    const before = k.web.fetches.filter((f) => f.url.includes("tgstat")).length;
    const r2 = await findDirectoryCandidates(k.deps, { source: "directories", languages: ["fr"], vertical: "CASINO" }, ["tgstat"]);
    expect(k.web.fetches.filter((f) => f.url.includes("tgstat")).length).toBe(before);
    expect(r2.paused).toBe(true);
  });
});
