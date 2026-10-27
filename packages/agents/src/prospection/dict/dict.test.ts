import { describe, expect, it } from "vitest";
import { DEFAULT_COUNTRIES_SCOPE } from "../contract";
import {
  QUERY_LANGUAGES,
  affiliatePatterns,
  allContactLabels,
  brandsDict,
  brandsForCountry,
  countryLanguages,
  findBrand,
  findBrandByDomain,
  geoSignals,
  isBrandUsername,
  queriesFor,
  validateDicts,
} from "./index";

describe("dictionnaires de la Prospection", () => {
  it("structure valide : aucun doublon, codes pays ISO, chaque langue a ses deux verticales", () => {
    expect(validateDicts()).toEqual([]);
  });

  it("26 langues : les 24 de l'UE + norvégien + islandais, chacune avec SPORTS et CASINO", () => {
    expect(QUERY_LANGUAGES).toHaveLength(26);
    for (const l of QUERY_LANGUAGES) {
      expect(queriesFor(l, "SPORTS").length).toBeGreaterThanOrEqual(3);
      expect(queriesFor(l, "CASINO").length).toBeGreaterThanOrEqual(3);
    }
    expect(queriesFor("pl", "SPORTS")).toContain("typy bukmacherskie");
    expect(queriesFor("xx", "SPORTS")).toEqual([]);
  });

  it("toutes les marques du prompt sont là, avec le drapeau hors Europe des offshore", () => {
    const wanted = [
      "Winamax", "Betclic", "Unibet", "PMU", "ParionsSport", "ZEbet", "Bwin", "Netbet", "Vbet", "bet365", "William Hill", "Ladbrokes",
      "Coral", "Paddy Power", "Betfair", "Sky Bet", "Betfred", "888", "Tipico", "Betano", "Interwetten", "bet-at-home", "Admiral",
      "win2day", "Codere", "Sportium", "Betway", "Luckia", "Sisal", "Snai", "Eurobet", "Lottomatica", "Goldbet", "Planetwin365",
      "Betflag", "Placard", "ESC Online", "Solverde", "Toto", "Holland Casino", "Jack's", "Betfirst", "Bingoal", "Napoleon", "STS",
      "Fortuna", "Superbet", "LV BET", "Svenska Spel", "Betsson", "LeoVegas", "ATG", "Norsk Tipping", "Danske Spil", "Veikkaus",
      "OPAP", "Stoiximan", "Novibet", "MaxBet", "Tipsport", "Sazka", "Niké", "TippmixPro", "SuperSport", "Germania", "PSK", "efbet",
      "Winbet", "Palms Bet", "1xbet", "Melbet", "22bet", "Stake", "Roobet", "BC.Game", "Betwinner", "Linebet", "1win", "Mostbet",
      "Pin-Up", "Parimatch", "20bet", "Caliente", "Codere MX", "Betano BR",
    ];
    for (const w of wanted) expect(findBrand(w), w).not.toBeNull();
    for (const k of ["1win", "Mostbet", "Pin-Up", "Linebet", "Melbet", "Betwinner", "Parimatch", "Caliente", "Codere MX", "Betano BR"])
      expect(findBrand(k)!.offshoreNonEu, k).toBe(true);
    expect(findBrand("Betano")!.offshoreNonEu).toBe(false);
    expect(findBrand("Betano BR")!.country).toBe("BR");
    expect(findBrand("Caliente")!.country).toBe("MX");
    expect(findBrand("Winamax")!.status).toBe("local");
    expect(findBrand("1xBet")!.status).toBe("offshore");
  });

  it("recherche tolérante (casse, espaces, ponctuation) mais accents gardés", () => {
    expect(findBrand("PADDY-POWER")?.key).toBe("paddypower");
    expect(findBrand("bet at home")?.key).toBe("betathome");
    expect(findBrand("Niké")?.key).toBe("nike-sk");
    expect(findBrand("Nike")).toBeNull();
    expect(findBrand("inconnu")).toBeNull();
    expect(findBrandByDomain("www.betclic.fr")?.key).toBe("betclic");
    expect(findBrandByDomain("sports.bwin.de")?.key).toBe("bwin");
    expect(findBrandByDomain("exemple.fr")).toBeNull();
  });

  it("usernames officiels de marques reconnus, pas ceux des affiliés", () => {
    expect(isBrandUsername("winamax")).toBe(true);
    expect(isBrandUsername("@1xbet_official")).toBe(true);
    expect(isBrandUsername("betclicofficiel")).toBe(true);
    expect(isBrandUsername("pronos_1xbet_fr")).toBe(false);
    expect(isBrandUsername("tonton_paris")).toBe(false);
    // Marque ambiguë : « stake » est un mot, jamais exclu sur le nom seul.
    expect(isBrandUsername("stake")).toBe(false);
  });

  it("marques par pays", () => {
    const pl = brandsForCountry("PL").map((b) => b.key);
    expect(pl).toEqual(expect.arrayContaining(["sts", "fortuna", "superbet", "betclic", "lvbet"]));
  });

  it("signaux géographiques : tout le périmètre + les grands marchés hors Europe", () => {
    const g = geoSignals();
    for (const cc of [...DEFAULT_COUNTRIES_SCOPE, "BR", "MX", "AR", "CO", "IN", "NG", "TR", "RU", "UA", "KZ"]) expect(g.countries[cc], cc).toBeDefined();
    expect(g.locales["pt-PT"]!.markers).toContain("desportivas");
    expect(g.locales["pt-BR"]!.markers).toContain("esportivas");
    for (const l of ["es-ES", "es-MX", "en-GB", "en-US", "de-DE", "de-AT", "de-CH", "fr-FR", "fr-BE", "fr-CH", "fr-CA"]) expect(g.locales[l], l).toBeDefined();
    expect(countryLanguages("BE")).toEqual(["fr", "nl", "de"]);
    expect(countryLanguages("pl")).toEqual(["pl"]);
    expect(countryLanguages("ZZ")).toEqual([]);
  });

  it("contacts et motifs d'affiliation", () => {
    const labels = allContactLabels();
    for (const l of ["pub", "werbung", "pubblicità", "publicidad", "reklama", "samenwerking", "annons", "διαφήμιση", "publicitate", "reklám", "spolupráce"])
      expect(labels, l).toContain(l);
    const a = affiliatePatterns();
    expect(a.queryParams).toEqual(expect.arrayContaining(["ref", "aff", "affid", "btag", "a", "partner", "promo", "tag", "sub_id"]));
    expect(a.paramPrefixes).toContain("utm_");
    expect(a.shorteners).toEqual(expect.arrayContaining(["bit.ly", "cutt.ly", "t.ly", "tinyurl.com", "is.gd", "rebrand.ly", "short.io"]));
    expect(a.promoCodeLabels.pl).toContain("kod promocyjny");
    expect(brandsDict().length).toBeGreaterThan(80);
  });
});

describe("ajouts validés par le client", () => {
  it("loadDictAdditions fusionne marques, motifs et étiquettes, sans doublon, puis se retire", async () => {
    const { createFakePrisma } = await import("../../testing/fake-prisma");
    const { applyDictAdditions, loadDictAdditions, DICT_ADDITIONS_KEY } = await import("./index");
    const prisma = createFakePrisma({
      setting: [{ key: DICT_ADDITIONS_KEY, value: { brands: [{ name: "Betinia", country: "se", type: "casino", status: "local" }, { name: "Winamax" }], shorteners: ["Lnkd.in"], queryParams: ["ref"], promoCodeLabels: { fr: ["code cadeau"] }, contactLabels: { fr: ["pour bosser"] } } }],
    });
    await loadDictAdditions({ prisma });
    expect(findBrand("Betinia")).toMatchObject({ country: "SE", countries: ["SE"], type: "casino", status: "local" });
    expect(brandsDict().filter((b) => b.name === "Winamax")).toHaveLength(1);
    expect(affiliatePatterns().shorteners).toContain("lnkd.in");
    expect(affiliatePatterns().queryParams.filter((p) => p === "ref")).toHaveLength(1);
    expect(affiliatePatterns().promoCodeLabels.fr).toContain("code cadeau");
    expect(allContactLabels()).toContain("pour bosser");
    applyDictAdditions(null);
    expect(findBrand("Betinia")).toBeNull();
    expect(validateDicts()).toEqual([]);
  });
});
