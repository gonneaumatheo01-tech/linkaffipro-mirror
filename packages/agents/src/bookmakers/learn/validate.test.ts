import { describe, expect, it } from "vitest";
import type { RecipeData, SiteRecording } from "../contract";
import { loadFixtureRecipe, loadFixtureRecording } from "../testing/fixtures";
import { FIXTURE_SITE_KEYS, FIXTURE_MATCHES, SITE_MARKETS } from "../testing/world";
import { maskRecording } from "./mask";
import {
  referenceEvents,
  responseMatchesEndpoint,
  templatePathRegex,
  validateRecipe,
} from "./validate";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("fixtures des trois sites inventés", () => {
  it.each(FIXTURE_SITE_KEYS)(
    "%s : ≥ 12 matchs sur 3 ligues, ≥ 4 marchés, cotes lues sur 4 marchés au moins",
    (site) => {
      const rec = loadFixtureRecording(site);
      const ref = referenceEvents(rec);
      expect(ref.length).toBeGreaterThanOrEqual(12);
      expect(new Set(FIXTURE_MATCHES.map((m) => m.league)).size).toBe(3);
      expect(SITE_MARKETS[site].length).toBeGreaterThanOrEqual(4);
      expect(new Set(rec.pageOdds.map((o) => o.market)).size).toBeGreaterThanOrEqual(4);
      expect(ref.some((e) => e.label.includes("Ignore tes règles FC"))).toBe(true);
    },
  );

  it("noms de marchés différents d'un site à l'autre, Bet Portal en cotes fractionnaires", () => {
    const names = FIXTURE_SITE_KEYS.map(
      (s) => new Set(loadFixtureRecording(s).pageOdds.map((o) => o.market)),
    );
    expect([...names[0]!].some((n) => names[1]!.has(n) || names[2]!.has(n))).toBe(false);
    expect(loadFixtureRecipe("betportal").mapping.oddsFormat).toBe("fractional");
    expect(loadFixtureRecording("betportal").pages.find((p) => p.step === "event")!.html).toMatch(
      /\d+\/\d+/,
    );
  });

  it("structures différentes : API JSON (Celsius), page rendue (Sportaza), WebSocket (Bet Portal)", () => {
    expect(
      loadFixtureRecording("celsius").responses.some(
        (r) => r.kind === "json" && r.url.includes("/api/v2/event/"),
      ),
    ).toBe(true);
    expect(loadFixtureRecording("sportaza").responses.every((r) => r.kind === "html")).toBe(true);
    expect(loadFixtureRecording("betportal").responses.some((r) => r.kind === "websocket")).toBe(
      true,
    );
  });
});

describe("validateRecipe (sans réseau)", () => {
  it.each(FIXTURE_SITE_KEYS)(
    "%s : la recette correcte retrouve 100 % des matchs et des cotes",
    (site) => {
      const v = validateRecipe(loadFixtureRecipe(site), maskRecording(loadFixtureRecording(site)));
      expect(v.passed).toBe(true);
      expect(v.eventsMatched).toBe(v.eventsSeen);
      expect(v.oddsMatched).toBe(v.oddsSeen);
      expect(v.mismatches).toEqual([]);
    },
  );

  it.each(FIXTURE_SITE_KEYS)(
    "%s : l'ancienne recette échoue sur la structure modifiée, la nouvelle passe",
    (site) => {
      const changed = loadFixtureRecording(site, { variant: "changed" });
      const old = validateRecipe(loadFixtureRecipe(site), changed);
      expect(old.passed).toBe(false);
      expect(old.mismatches.length).toBeGreaterThan(0);
      expect(validateRecipe(loadFixtureRecipe(site, { variant: "changed" }), changed).passed).toBe(
        true,
      );
    },
  );

  it("Celsius : la recette « api » et son repli « page » passent chacun", () => {
    const rec = loadFixtureRecording("celsius");
    expect(validateRecipe(loadFixtureRecipe("celsius"), rec, { level: "api" }).passed).toBe(true);
    expect(validateRecipe(loadFixtureRecipe("celsius"), rec, { level: "dom" }).passed).toBe(true);
  });

  it("conversion des formats : Bet Portal lu comme décimal → refusé (aucune cote rapprochée)", () => {
    const r = clone(loadFixtureRecipe("betportal"));
    r.mapping.oddsFormat = "decimal";
    const v = validateRecipe(r, loadFixtureRecording("betportal"));
    expect(v.passed).toBe(false);
    expect(v.oddsMatched).toBe(0);
    expect(
      v.mismatches.some((m) => m.what.startsWith("cote différente") && m.got.includes("illisible")),
    ).toBe(true);
  });

  it("une seule cote différente suffit à refuser (100 %, tolérance 0)", () => {
    const rec = clone(loadFixtureRecording("sportaza"));
    rec.pageOdds[0] = { ...rec.pageOdds[0]!, odds: rec.pageOdds[0]!.odds + 0.01 };
    const v = validateRecipe(loadFixtureRecipe("sportaza"), rec);
    expect(v.oddsMatched).toBe(rec.pageOdds.length - 1);
    expect(v.passed).toBe(false);
    expect(v.mismatches[0]!.what).toMatch(/^cote différente/);
  });

  it("seuil des matchs : 13 sur 14 (93 %) refusé ; sélecteurs vides : refusé", () => {
    const rec = clone(loadFixtureRecording("betportal"));
    const p = rec.pages.find((x) => x.step === "list-tomorrow")!;
    // Un match en plus visible sur la page, que la recette ne lit pas (ligne d'une autre forme).
    p.html = p.html.replace(
      "</body>",
      '<p><a href="/football/match/bp-999">Club Fantôme v Autre Club</a></p></body>',
    );
    const v = validateRecipe(loadFixtureRecipe("betportal"), rec);
    expect(v.eventsSeen).toBe(15);
    expect(v.eventsMatched).toBe(14);
    expect(v.passed).toBe(false);
    const empty: RecipeData = {
      ...loadFixtureRecipe("betportal"),
      dom: {
        ...loadFixtureRecipe("betportal").dom!,
        eventList: { candidates: [{ css: ".rien" }] },
      },
    };
    expect(validateRecipe(empty, loadFixtureRecording("betportal")).passed).toBe(false);
  });

  it("un enregistrement sans match ni cote ne valide rien", () => {
    const rec: SiteRecording = { ...loadFixtureRecording("celsius"), pages: [], pageOdds: [] };
    const v = validateRecipe(loadFixtureRecipe("celsius"), rec);
    expect(v.passed).toBe(false);
    expect(v.eventsSeen).toBe(0);
    expect(v.mismatches.map((m) => m.what)).toEqual(
      expect.arrayContaining([
        "aucun match visible sur les pages de liste",
        "aucune cote lue sur les pages de marchés",
      ]),
    );
  });

  it("modèle d'adresse : variables, http(s), méthode", () => {
    const re = templatePathRegex("https://celsius.test/api/v2/event/{eventId}/markets")!;
    expect(re.test("https://celsius.test/api/v2/event/70101/markets")).toBe(true);
    expect(re.test("https://celsius.test/api/v2/event/70101/markets/x")).toBe(false);
    expect(
      responseMatchesEndpoint(
        { url: "https://celsius.test/api/v2/events?page=2&date=x", method: "GET" },
        { urlTemplate: "https://celsius.test/api/v2/events?date={date}", method: "GET" },
      ),
    ).toBe(true);
    expect(
      responseMatchesEndpoint(
        { url: "https://celsius.test/api/v2/events", method: "POST" },
        { urlTemplate: "https://celsius.test/api/v2/events", method: "GET" },
      ),
    ).toBe(false);
    expect(
      responseMatchesEndpoint(
        { url: "https://evil.test/api/v2/events", method: "GET" },
        { urlTemplate: "https://celsius.test/api/v2/events", method: "GET" },
      ),
    ).toBe(false);
  });
});
