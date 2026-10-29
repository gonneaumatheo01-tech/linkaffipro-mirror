import { describe, expect, it } from "vitest";
import {
  categoryChanges,
  categoryKeyFromName,
  fmtOdds,
  fmtSignedPct,
  mergeSportsSettings,
  oddsDrift,
  parseBetCategoryForm,
  parseRunHours,
  parseSportsSettings,
  parseSportsSettingsForm,
  parseSummaryBy,
  reasoningSentences,
  resultScore,
  runHoursText,
  summaryTotal,
  uniqueKey,
} from "./sports";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

const CATEGORY = {
  name: "Tirs cadrés",
  sport: "SOCCER",
  marketTypes: "shots_onGoal-all-game-ou-over\nshots_onGoal-home-game-ou-over",
  leagues: "EPL, FR_LIGUE_1",
  bookmakers: "sportaza",
  otherBookmakers: "",
  minOdds: "1,5",
  maxOdds: "3.5",
  picksPerDay: "2",
  channelIds: "c1",
  campaignId: "camp1",
  minMinutesBeforeKickoff: "30",
  maxOddsDriftPct: "5",
  active: "on",
};
const ALLOWED = { channelIds: ["c1", "c2"], campaignIds: ["camp1"], takenKeys: ["tirs-cadres"] };

describe("réglages de l'équipe Paris sportifs", () => {
  it("valeurs de départ et bornes", () => {
    expect(parseSportsSettings(null)).toEqual({
      runHours: [10, 15, 18],
      maxOddsDriftPct: 5,
      minMinutesBeforeKickoff: 30,
      maxApiCallsPerMonth: 2000,
    });
    expect(parseSportsSettings({ sports: { runHours: [18, 9, 9, 30], maxOddsDriftPct: 99 } })).toMatchObject({
      runHours: [9, 18],
      maxOddsDriftPct: 5,
    });
  });

  it("fusion sans perdre les autres clés", () => {
    const next = parseSportsSettings(null);
    expect(mergeSportsSettings({ casino: { x: 1 }, sports: { autre: true } }, next)).toEqual({
      casino: { x: 1 },
      sports: { autre: true, ...next },
    });
  });

  it("heures de passage saisies", () => {
    expect(parseRunHours("18, 10 15")).toEqual({ ok: true, data: [10, 15, 18] });
    expect(parseRunHours("10h, 15h")).toEqual({ ok: true, data: [10, 15] });
    expect(parseRunHours("").ok).toBe(false);
    expect(parseRunHours("25").ok).toBe(false);
    expect(runHoursText([10, 15, 18])).toBe("10 h, 15 h et 18 h");
  });

  it("formulaire complet", () => {
    const r = parseSportsSettingsForm(
      fd({
        sportsRunHours: "9, 21",
        sportsMaxOddsDriftPct: "7,5",
        sportsMinMinutesBeforeKickoff: "45",
        sportsMaxApiCallsPerMonth: "1500",
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: { runHours: [9, 21], maxOddsDriftPct: 7.5, minMinutesBeforeKickoff: 45, maxApiCallsPerMonth: 1500 },
    });
    const bad = parseSportsSettingsForm(
      fd({ sportsRunHours: "9", sportsMaxOddsDriftPct: "80", sportsMinMinutesBeforeKickoff: "1", sportsMaxApiCallsPerMonth: "1" }),
    );
    expect(bad).toEqual({ ok: false, error: "Écart de cote toléré : au plus 50." });
  });
});

describe("catégories de paris", () => {
  it("création : clé tirée du nom, rendue unique", () => {
    const r = parseBetCategoryForm(fd(CATEGORY), ALLOWED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      id: null,
      key: "tirs-cadres-2",
      marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-home-game-ou-over"],
      leagues: ["EPL", "FR_LIGUE_1"],
      bookmakers: ["sportaza"],
      minOdds: 1.5,
      maxOdds: 3.5,
      channelIds: ["c1"],
      campaignId: "camp1",
      active: true,
    });
    expect(categoryKeyFromName("Buts (plus / moins)")).toBe("buts-plus-moins");
    expect(uniqueKey("a", [])).toBe("a");
  });

  it("modification : la clé de la page est gardée", () => {
    const r = parseBetCategoryForm(fd({ ...CATEGORY, id: "cat1", key: "tirs-cadres" }), ALLOWED);
    expect(r.ok && r.data.key).toBe("tirs-cadres");
  });

  it("refus clairs", () => {
    const err = (o: Record<string, string | string[]>) => {
      const r = parseBetCategoryForm(fd({ ...CATEGORY, ...o }), ALLOWED);
      return r.ok ? null : r.error;
    };
    expect(err({ name: "" })).toContain("nom");
    expect(err({ marketTypes: "" })).toContain("Marchés");
    expect(err({ marketTypes: "tirs cadrés" })).toContain("n'est pas un identifiant");
    expect(err({ leagues: "" })).toContain("Ligues");
    expect(err({ bookmakers: [], otherBookmakers: "" })).toContain("Bookmakers");
    expect(err({ minOdds: "4", maxOdds: "3" })).toContain("plus petite");
    expect(err({ minOdds: "1" })).toContain("Cote minimale");
    expect(err({ picksPerDay: "0" })).toContain("Paris par jour");
    expect(err({ channelIds: "inconnu" })).toContain("canaux");
    expect(err({ campaignId: "autre" })).toContain("campagne");
  });

  it("autres bookmakers ajoutés en minuscules, sans doublon", () => {
    const r = parseBetCategoryForm(fd({ ...CATEGORY, otherBookmakers: "5Gringos, sportaza" }), ALLOWED);
    expect(r.ok && r.data.bookmakers).toEqual(["sportaza", "5gringos"]);
  });

  it("changements pour le journal", () => {
    const r = parseBetCategoryForm(fd(CATEGORY), ALLOWED);
    if (!r.ok) throw new Error(r.error);
    expect(categoryChanges(null, r.data)).toEqual(["création"]);
    expect(categoryChanges({ ...r.data, minOdds: 1.6, active: false }, r.data)).toEqual(["minOdds", "active"]);
  });
});

describe("paris : raisonnement en phrases", () => {
  const pick = { odds: 2.1, consensusOdds: 1.9, bookmaker: "sportaza", interestScore: 0.084 };

  it("met les chiffres en phrases, sans rien inventer", () => {
    const s = reasoningSentences(
      { consensusProb: 0.52, valueEdge: 0.092, bookmakerCount: 7, averages: { home: 5.2, away: 4, matches: 5, stat: "tirs cadrés" } },
      pick,
    );
    expect(s).toEqual([
      "Cote Sportaza 2,10, contre 1,90 pour la cote de référence (milieu de 7 bookmakers).",
      "Chance estimée d'après les autres bookmakers, marge retirée : 52 % (la cote 2,10 en suppose 47,6 %).",
      "Écart de valeur : +9,2 %.",
      "Moyennes récentes (tirs cadrés) : domicile 5,2, extérieur 4, sur 5 matchs.",
      "Score d'intérêt : 0,084.",
    ]);
    expect(reasoningSentences({}, { ...pick, consensusOdds: null, interestScore: null })).toEqual([]);
    expect(reasoningSentences({ summary: "Texte du moteur." }, { ...pick, consensusOdds: null, interestScore: null })).toEqual([
      "Texte du moteur.",
    ]);
  });

  it("probabilité donnée en pourcentage ramenée en ratio", () => {
    expect(reasoningSentences({ consensusProb: 52 }, { ...pick, consensusOdds: null, interestScore: null })[0]).toContain("52 %");
  });

  it("cotes, écarts, score", () => {
    expect(fmtOdds(2)).toBe("2,00");
    expect(fmtOdds(null)).toBe("—");
    expect(fmtSignedPct(-0.015)).toBe("−1,5 %");
    expect(oddsDrift(2, 1.9)).toBeCloseTo(-0.05);
    expect(oddsDrift(2, null)).toBeNull();
    expect(resultScore({ score: { home: 2, away: 1 } })).toBe("2-1");
    expect(resultScore(null)).toBeNull();
  });
});

describe("bilan", () => {
  it("total pondéré", () => {
    const t = summaryTotal([
      { published: 4, won: 3, lost: 1, void: 0, hitRate: 0.75, avgOdds: 2, roi: 0.5 },
      { published: 2, won: 0, lost: 2, void: 0, hitRate: 0, avgOdds: 3, roi: -1 },
    ]);
    expect(t).toMatchObject({ published: 6, won: 3, lost: 3, hitRate: 0.5 });
    expect(t.avgOdds).toBeCloseTo(7 / 3);
    // Mises 6, retours 4 × 1,5 + 2 × 0 = 6 → rendement 0.
    expect(t.roi).toBeCloseTo(0);
    expect(parseSummaryBy("league")).toBe("league");
    expect(parseSummaryBy("x")).toBe("category");
  });
});

