import { describe, expect, it } from "vitest";
import { normalCdf, studentTwoSidedP, twoMeanTest, twoProportionTest } from "./stats";
import { experimentVerdict, verdictSentence } from "./verdict";
import { assignExperiment, missionExperimentOf, parseVariants, shiftMix } from "./variants";
import { experimentProposals } from "./index";
import { DEFAULT_ALGO_SETTINGS } from "../../algo/settings";

describe("tests statistiques (cas connus)", () => {
  it("loi normale et loi de Student", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(studentTwoSidedP(2.306, 8)).toBeCloseTo(0.05, 3);
    expect(studentTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
  });
  it("deux proportions : 60/200 contre 40/200 → z = 2,31, p = 0,021", () => {
    const r = twoProportionTest(60, 200, 40, 200)!;
    expect(r.stat).toBeCloseTo(2.309, 2);
    expect(r.p).toBeCloseTo(0.0209, 3);
    expect(twoProportionTest(10, 100, 10, 100)!.p).toBeCloseTo(1, 6);
    expect(twoProportionTest(1, 0, 1, 10)).toBeNull();
  });
  it("deux moyennes (Welch) : 1..5 contre 6..10 → t = −5, p ≈ 0,00105", () => {
    const r = twoMeanTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])!;
    expect(r.stat).toBeCloseTo(-5, 6);
    expect(r.p).toBeCloseTo(0.00105, 4);
    expect(twoMeanTest([1], [2, 3])).toBeNull();
  });
});

describe("verdicts", () => {
  const o = { minSamples: 20, alpha: 0.05 };
  it("pas assez de données sous la taille minimale", () => {
    const v = experimentVerdict("offer_ctr", { samples: 5, successes: 60, trials: 200 }, { samples: 30, successes: 40, trials: 200 }, o);
    expect(v.status).toBe("insufficient");
    expect(verdictSentence(v, "offer_ctr")).toContain("pas encore assez");
  });
  it("A gagne, B gagne, pas de différence", () => {
    expect(experimentVerdict("offer_ctr", { samples: 25, successes: 60, trials: 200 }, { samples: 25, successes: 40, trials: 200 }, o).winner).toBe("A");
    expect(experimentVerdict("offer_ctr", { samples: 25, successes: 40, trials: 200 }, { samples: 25, successes: 60, trials: 200 }, o).winner).toBe("B");
    const none = experimentVerdict("offer_ctr", { samples: 25, successes: 50, trials: 200 }, { samples: 25, successes: 45, trials: 200 }, o);
    expect(none.winner).toBe("NONE");
    expect(verdictSentence(none, "offer_ctr")).toContain("pas de différence");
    const means = experimentVerdict(
      "views24h",
      { samples: 20, values: Array.from({ length: 20 }, (_, i) => 200 + (i % 5)) },
      { samples: 20, values: Array.from({ length: 20 }, (_, i) => 100 + (i % 5)) },
      o,
    );
    expect(means.test).toBe("means");
    expect(means.winner).toBe("A");
  });
});

describe("variantes", () => {
  const exp = (id: string, kind = "STYLE_LEGENDE") => ({ id, kind, variants: { A: { label: "a", style: "question" }, B: { label: "b", style: "affirmation" } } });
  it("tirage déterministe, un seul test par mission, les deux variantes servies", () => {
    const a = assignExperiment("m1", [exp("e1"), exp("e2", "HORAIRE")]);
    expect(a).toEqual(assignExperiment("m1", [exp("e2", "HORAIRE"), exp("e1")]));
    const variants = new Set(Array.from({ length: 40 }, (_, i) => assignExperiment(`m${i}`, [exp("e1")])!.variant));
    expect(variants).toEqual(new Set(["A", "B"]));
    expect(assignExperiment("m1", [exp("e3", "REGLAGE_PERSONA")])).toBeNull();
    expect(missionExperimentOf({ experiment: a })).toEqual(a);
    expect(parseVariants({ A: { label: "x" } })).toBeNull();
  });
  it("mélange déplacé de 20 points au plus", () => {
    expect(shiftMix({ video: 1, photo: 2, text: 1 }, "video", 20)).toEqual({ video: 45, photo: 36.7, text: 18.3 });
    expect(shiftMix({ video: 0, photo: 0, text: 1 }, "photo", 20)).toEqual({ video: 0, photo: 20, text: 80 });
  });
  it("propositions : style, horaire dans la fenêtre, mélange quand les formats manquent de données", () => {
    const plan = { channelId: "c", teamKey: "dating", mix: { video: 1, photo: 2, text: 1 }, windowStart: "09:00", windowEnd: "22:00" };
    const p = experimentProposals(plan, { formatsInsufficient: true, bestHour: 19, settings: DEFAULT_ALGO_SETTINGS });
    expect(p.map((x) => x.kind)).toEqual(["STYLE_LEGENDE", "HORAIRE", "MELANGE"]);
    expect(p[1]!.variants).toEqual({ A: { label: "19 h", hour: 19 }, B: { label: "21 h", hour: 21 } });
    expect(experimentProposals({ ...plan, windowStart: "19:00", windowEnd: "21:00" }, { formatsInsufficient: false, bestHour: null, settings: DEFAULT_ALGO_SETTINGS }).map((x) => x.kind)).toEqual(["STYLE_LEGENDE"]);
  });
});
