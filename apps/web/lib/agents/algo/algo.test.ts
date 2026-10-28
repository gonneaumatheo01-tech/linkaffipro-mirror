import { describe, expect, it } from "vitest";
import { metricValueText, progressText, sideResult, variantLabel, verdictText } from "./experiments";
import { groupBy, lengthBucket, middleValue, notEnoughSentence, rank, summarize, type InsightRow } from "./insights";
import {
  actionsFor,
  canActOnRecommendation,
  evidenceLines,
  fieldLabel,
  isBigRecommendation,
  mixText,
  valueText,
} from "./recommendations";
import { delayText, parseProfiles, parseReview } from "./reports";
import { ALGO_DEFAULTS, mergeAlgoSettings, parseAlgoSettings, parseAlgoSettingsForm } from "./settings";

const T = { minPosts: 20, minViews: 1000 };

function row(extra: Partial<InsightRow> = {}): InsightRow {
  return {
    channelId: "c1",
    personaId: null,
    format: "TEXT",
    theme: null,
    hourParis: 19,
    weekdayParis: 2,
    textLength: 120,
    views24h: 90,
    viewsFinal: 100,
    offerClicks: 2,
    registrations: 0,
    ...extra,
  };
}
const many = (n: number, extra: Partial<InsightRow>) => Array.from({ length: n }, () => row(extra));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("réglages de l'équipe Algorithme", () => {
  it("valeurs par défaut du plan : 20 posts, 1 000 vues, 30 conversations, 20 points, 6 posts", () => {
    expect(parseAlgoSettings(null)).toEqual(ALGO_DEFAULTS);
    expect(ALGO_DEFAULTS).toMatchObject({ minPosts: 20, minViews: 1000, minConversations: 30, maxMixPointsPerWeek: 20, maxPostsPerDay: 6 });
  });
  it("lecture tolérante : une valeur hors bornes reprend la valeur par défaut", () => {
    const s = parseAlgoSettings({ algo: { minPosts: 40, maxPostsPerDay: 99, allowedStart: "25:00", frequency: "biweekly" } });
    expect(s.minPosts).toBe(40);
    expect(s.maxPostsPerDay).toBe(6);
    expect(s.allowedStart).toBe("08:00");
    expect(s.frequency).toBe("biweekly");
  });
  it("garde les autres clés de settings", () => {
    const merged = mergeAlgoSettings({ videoProvider: "fal", algo: { extra: 1 } }, ALGO_DEFAULTS);
    expect(merged.videoProvider).toBe("fal");
    expect(merged.algo).toMatchObject({ extra: 1, minPosts: 20 });
  });
  it("formulaire : chiffres bornés, heures dans l'ordre, fréquence connue", () => {
    const ok = {
      minPosts: "20",
      minViews: "1000",
      minConversations: "30",
      maxMixPointsPerWeek: "20",
      maxPostsPerDay: "6",
      allowedStart: "09:00",
      allowedEnd: "22:30",
      frequency: "weekly",
    };
    expect(parseAlgoSettingsForm(fd(ok))).toEqual({ ok: true, data: { ...ALGO_DEFAULTS, allowedStart: "09:00", allowedEnd: "22:30" } });
    expect(parseAlgoSettingsForm(fd({ ...ok, maxPostsPerDay: "40" })).ok).toBe(false);
    expect(parseAlgoSettingsForm(fd({ ...ok, allowedStart: "23:00", allowedEnd: "08:00" })).ok).toBe(false);
    expect(parseAlgoSettingsForm(fd({ ...ok, frequency: "daily" })).ok).toBe(false);
  });
});

describe("ce qui marche : regroupement et classement", () => {
  it("valeur du milieu", () => {
    expect(middleValue([])).toBeNull();
    expect(middleValue([3, 1, 2])).toBe(2);
    expect(middleValue([1, 2, 3, 4])).toBe(2.5);
  });
  it("tranches de longueur", () => {
    expect(lengthBucket(10)).toBe("xs");
    expect(lengthBucket(150)).toBe("s");
    expect(lengthBucket(300)).toBe("m");
    expect(lengthBucket(900)).toBe("l");
  });
  it("seuils : 20 posts OU 1 000 vues", () => {
    const g = groupBy([...many(19, { format: "VIDEO", viewsFinal: 10 }), row({ format: "PHOTO", viewsFinal: 1000 })], "format", T);
    expect(g.find((x) => x.key === "VIDEO")?.enoughData).toBe(false); // 19 posts, 190 vues
    expect(g.find((x) => x.key === "PHOTO")?.enoughData).toBe(true);
  });
  it("au-dessus et en dessous de la valeur du milieu ; cas sous les seuils à part", () => {
    const rows = [
      ...many(20, { format: "VIDEO", offerClicks: 5, viewsFinal: 100 }),
      ...many(20, { format: "PHOTO", offerClicks: 3, viewsFinal: 100 }),
      ...many(20, { format: "TEXT", offerClicks: 1, viewsFinal: 100 }),
      ...many(3, { format: "ALBUM", offerClicks: 9, viewsFinal: 10 }),
    ];
    const r = rank(groupBy(rows, "format", T));
    expect(r.ranked.map((g) => g.key)).toEqual(["VIDEO", "PHOTO", "TEXT"]);
    expect(r.works.map((g) => g.key)).toEqual(["VIDEO"]);
    expect(r.doesNotWork.map((g) => g.key)).toEqual(["TEXT"]);
    expect(r.notEnough.map((g) => g.key)).toEqual(["ALBUM"]);
    expect(r.ranked[0]?.offerCtr).toBeCloseTo(0.05);
  });
  it("un seul cas comparable : rien au-dessus ni en dessous", () => {
    const r = rank(groupBy(many(25, { format: "VIDEO" }), "format", T));
    expect(r.ranked).toHaveLength(1);
    expect(r.works).toEqual([]);
    expect(r.doesNotWork).toEqual([]);
  });
  it("résumé : heures (0-23) et jours (lundi en premier)", () => {
    const s = summarize([...many(20, { hourParis: 19, weekdayParis: 1 }), ...many(20, { hourParis: 8, weekdayParis: 7, offerClicks: 0 })], T);
    expect(s.posts).toBe(40);
    expect(s.hours.values).toHaveLength(24);
    expect(s.hours.values[19]).toBeCloseTo(0.02);
    expect(s.hours.posts[8]).toBe(20);
    expect(s.weekdays.posts[0]).toBe(20);
    expect(s.weekdays.posts[6]).toBe(20);
    expect(s.hour.works.map((g) => g.key)).toEqual(["19"]);
  });
  it("phrase « pas encore assez de données »", () => {
    expect(notEnoughSentence({ posts: 12, views: 340 }, T)).toBe(
      "Pas encore assez de données : 12 posts et 340 vues, il faut 20 posts ou 1 000 vues.",
    );
  });
});

describe("propositions de réglages", () => {
  it("gros réglages : persona, quota ou marqués BIG", () => {
    expect(isBigRecommendation({ size: "SMALL", target: "PERSONA", field: "messagesBeforeLink" })).toBe(true);
    expect(isBigRecommendation({ size: "SMALL", target: "CHANNEL_PLAN", field: "postsPerDay" })).toBe(true);
    expect(isBigRecommendation({ size: "BIG", target: "CHANNEL_PLAN", field: "mix" })).toBe(true);
    expect(isBigRecommendation({ size: "SMALL", target: "CHANNEL_PLAN", field: "mix" })).toBe(false);
  });
  it("droits : responsable pour les petits réglages, administrateur pour tout", () => {
    const small = { size: "SMALL", target: "CHANNEL_PLAN", field: "windowStart" };
    const big = { size: "SMALL", target: "PERSONA", field: "x" };
    expect(canActOnRecommendation("MANAGER", small)).toBe(true);
    expect(canActOnRecommendation("MANAGER", big)).toBe(false);
    expect(canActOnRecommendation("ADMIN", big)).toBe(true);
  });
  it("gestes selon l'état", () => {
    expect(actionsFor("PROPOSED")).toEqual(["apply", "reject"]);
    expect(actionsFor("APPLIED")).toEqual(["undo"]);
    expect(actionsFor("UNDONE")).toEqual([]);
    expect(actionsFor("REJECTED")).toEqual([]);
  });
  it("valeurs en mots", () => {
    expect(mixText({ video: 1, photo: 2, text: 1 })).toBe("vidéo 25 %, photo 50 %, texte 25 %");
    expect(valueText("mix", { video: 0.2, photo: 0.5, text: 0.3 })).toBe("vidéo 20 %, photo 50 %, texte 30 %");
    expect(valueText("windowStart", "19:00")).toBe("19:00");
    expect(valueText("suggestedFollowUpHours", [19, 21])).toBe("19 h, 21 h");
    expect(valueText("suggestedWindows", [{ day: 2, start: "19:00", end: "21:00" }])).toBe("mar. 19:00-21:00");
    expect(valueText("x", null)).toBe("—");
    expect(fieldLabel("mix")).toBe("Mélange vidéo / photo / texte");
  });
  it("preuves : texte du moteur, chiffres connus, test d'origine ; rien de technique", () => {
    const lines = evidenceLines({ summary: "Les vidéos font 2 fois plus cliquer.", posts: 42, offerCtr: 0.031, pValue: 0.01, experimentId: "e1" });
    expect(lines[0]).toBe("Les vidéos font 2 fois plus cliquer.");
    expect(lines.join(" ")).toContain("42 posts");
    expect(lines.join(" ")).toContain("3,1 %");
    expect(lines.join(" ")).toContain("test A/B");
    expect(lines.join(" ")).not.toMatch(/p-?value|0,01/i);
    expect(evidenceLines(null)).toEqual([]);
  });
});

describe("tests A/B", () => {
  const e = {
    status: "CLOSED",
    winner: "B",
    metric: "offer_ctr",
    minSamples: 20,
    variants: { A: { label: "Légende en question" }, B: "Légende en affirmation" },
    result: { A: { n: 30, rate: 0.02 }, B: { n: 28, rate: 0.035 }, pValue: 0.03 },
  };
  it("versions, effectifs et valeurs, sous plusieurs formes", () => {
    expect(variantLabel(e.variants, "A")).toBe("Légende en question");
    expect(variantLabel(e.variants, "B")).toBe("Légende en affirmation");
    expect(variantLabel(null, "A")).toBe("Version A");
    expect(sideResult(e.result, "B")).toEqual({ n: 28, value: 0.035 });
    expect(sideResult({ nA: 4, meanA: 120 }, "A")).toEqual({ n: 4, value: 120 });
    expect(metricValueText("offer_ctr", 0.035)).toBe("3,5 %");
    expect(metricValueText("views24h", 120)).toBe("120");
  });
  it("verdicts", () => {
    expect(verdictText(e)).toBe("La version B gagne");
    expect(verdictText({ status: "CLOSED", winner: "NONE" })).toBe("Pas de différence nette entre les deux versions");
    expect(verdictText({ status: "RUNNING", winner: null })).toBeNull();
    expect(progressText({ result: { A: { n: 12 }, B: { n: 9 } }, minSamples: 20 })).toBe(
      "12 et 9 cas mesurés, 20 au moins par version",
    );
  });
});

describe("rapports et conversations", () => {
  it("profils lus de façon tolérante", () => {
    const p = parseProfiles({
      conversations: [
        { key: "b1:p1:-", botId: "b1", botLabel: "@lea_bot", kind: "BOT", personaName: "Léa", conversations: 42, replyRate: 0.6, replyHours: [21, 22, 30], enoughData: true },
        { nope: true },
      ],
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ conversations: 42, replyHours: [21, 22], linksSent: 0, costPerRegistrationEur: null });
    expect(parseProfiles(null)).toEqual([]);
  });
  it("relecture : motifs courts seulement (80 caractères au plus)", () => {
    const long = "x".repeat(200);
    const r = parseReview({ profiles: [{ key: "b1:p1:-", works: ["Une question sur sa soirée", long], fails: [], drops: [] }, { key: "vide" }] });
    expect(r).toHaveLength(1);
    expect(r[0]?.works[1]?.length).toBeLessThanOrEqual(80);
    expect(parseReview({ "b1:p1:-": { hooks: ["Tutoiement"] } })[0]).toMatchObject({ key: "b1:p1:-", works: ["Tutoiement"] });
  });
  it("délai de réponse", () => {
    expect(delayText(45)).toBe("45 s");
    expect(delayText(150)).toBe("2 min 30 s");
    expect(delayText(3 * 3600 + 300)).toBe("3 h 05");
    expect(delayText(null)).toBe("—");
  });
});

describe("phase 27 : propositions d'inspiration hors de la voie générique", () => {
  it("une proposition `source = inspiration` (fonction retirée) est refusée par la voie générique", async () => {
    const { genericRecommendationRefusal, INSPIRATION_ONLY_MESSAGE } = await import("./recommendations");
    expect(genericRecommendationRefusal({ source: "inspiration" })).toBe(INSPIRATION_ONLY_MESSAGE);
    expect(genericRecommendationRefusal({ source: "algo" })).toBeNull();
    expect(genericRecommendationRefusal({})).toBeNull();
  });

  it("phase 29 : une proposition de l'analyse du marché n'est jamais appliquée par la voie générique", async () => {
    const { genericRecommendationRefusal, MARKET_ONLY_MESSAGE } = await import("./recommendations");
    expect(genericRecommendationRefusal({ source: "market_analysis" })).toBe(MARKET_ONLY_MESSAGE);
  });
});
