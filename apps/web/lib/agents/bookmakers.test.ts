import { describe, expect, it } from "vitest";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  canManageBookmakers,
  causeLabel,
  credentialsLabel,
  gapOf,
  jobKindLabel,
  jobSummary,
  levelLabel,
  macFresh,
  providerLabel,
  rate24h,
  recipeSummary,
  safeSiteKey,
  targetLabel,
} from "./bookmakers";

const NOW = new Date("2026-10-25T14:00:00Z");
const ENGINE = /recette|scraping|\bDOM\b|\bAPI\b|\bJSON\b|worker/i;

describe("page Bookmakers : libellés et calculs", () => {
  it("droits et clés de formulaire", () => {
    expect(canManageBookmakers("ADMIN")).toBe(true);
    expect(canManageBookmakers("MANAGER")).toBe(false);
    expect(safeSiteKey("betportal")).toBe("betportal");
    for (const bad of ["", "Bet Portal", "x", "../x", null, 3]) expect(safeSiteKey(bad)).toBeNull();
  });

  it("libellés sans mot du moteur", () => {
    const all = [
      ...["api", "dom", "image", null].map(levelLabel),
      ...[
        "learn",
        "events",
        "markets",
        "verify",
        "capture",
        "test",
        "visible",
        "fetch-api",
        "page",
        "record",
        "zzz",
      ].map(jobKindLabel),
      ...["auto", "server", "mac"].map(targetLabel),
      ...["captcha", "two_factor", "geo_blocked", "mac_absent", "inconnu"].map(
        (c) => causeLabel(c) ?? "",
      ),
      credentialsLabel("site"),
      credentialsLabel("default"),
      credentialsLabel(null),
      providerLabel("inconnu"),
    ];
    for (const t of all) {
      expect(t, t).not.toMatch(ENGINE);
      expect(jargonIn(t), t).toEqual([]);
    }
    expect(levelLabel("api")).toBe("Lecture directe des données du site");
    expect(targetLabel("mac")).toBe("Le Mac");
    expect(providerLabel("betby")).toBe("Betby");
  });

  it("résumé d'une lecture : attente, réussite, obstacle lisible", () => {
    expect(jobSummary({ status: "PENDING", result: null })).toBe("En attente d'un lecteur");
    expect(jobSummary({ status: "DONE", result: { value: { ok: true }, durationMs: 4200 } })).toBe(
      "Réussi en 4 s",
    );
    expect(jobSummary({ status: "NEEDS_HUMAN", result: { value: { obstacle: "captcha" } } })).toBe(
      "Le site demande un contrôle anti-robot",
    );
    expect(jobSummary({ status: "DONE", result: { value: [1, 2, 3] } })).toBe("3 éléments lus");
    expect(jobSummary({ status: "FAILED", result: { obstacle: "abandoned" } })).toBe(
      "Lecture abandonnée",
    );
  });

  it("réussite sur 24 h : contrôles récents seulement", () => {
    const h = {
      checks: [
        { at: "2026-10-25T13:30:00Z", ok: true },
        { at: "2026-10-25T13:00:00Z", ok: false },
        { at: "2026-10-23T13:00:00Z", ok: false },
      ],
    };
    expect(rate24h(h, NOW)).toEqual({ total: 2, ratio: 0.5 });
    expect(rate24h(null, NOW)).toEqual({ total: 0, ratio: null });
  });

  it("méthode apprise : version, chemin, marchés reconnus (noms du site)", () => {
    const r = recipeSummary({
      version: 3,
      level: "api",
      createdBy: "repair",
      createdAt: NOW,
      mapping: {
        marketMap: { Corners: "corners", "Résultat du match": "resultat", Inconnu: null },
      },
    });
    expect(r).toMatchObject({
      title: "Version 3 : lecture directe des données du site",
      detail: "réapprise toute seule",
      marketsCount: 2,
      markets: ["Corners", "Résultat du match"],
    });
    expect(recipeSummary(null)).toBeNull();
  });

  it("écart avec les autres bookmakers : inhabituel au-delà de 15 %", () => {
    expect(gapOf({ odds: 2.3, consensusOdds: 2 })).toEqual({ pct: 15, unusual: false });
    expect(gapOf({ odds: 2.4, consensusOdds: 2 })).toEqual({ pct: 20, unusual: true });
    expect(gapOf({ odds: 2, consensusOdds: null })).toBeNull();
  });

  it("Mac : dernier passage il y a moins de 2 minutes", () => {
    expect(macFresh({ at: "2026-10-25T13:59:00Z" }, NOW).alive).toBe(true);
    expect(macFresh({ at: "2026-10-25T13:50:00Z" }, NOW).alive).toBe(false);
    expect(macFresh(null, NOW)).toEqual({ alive: false, at: null });
  });
});
