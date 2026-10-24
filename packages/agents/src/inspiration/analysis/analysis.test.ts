import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsDeps, AgentsEnqueue } from "../../types";
import type { InspirationAnalysis, Measure } from "../contract";
import { shingleHashes } from "../copy-check";
import { analyzeReference, computeAnalysis, quotesOf } from "./analyze";
import { compareAnalyses, compareWithChannel, gapMatters, DEFAULT_GAP_THRESHOLDS } from "./compare";
import { betSeriesOf, contentMeasures, flaggedOf } from "./content";
import { formMeasures } from "./form";
import { fromReferencePost } from "./normalize";
import { textSignals } from "./patterns";
import { resultsMeasures } from "./results";
import { rhythmMeasures, slotOf } from "./rhythm";
import type { AnalysisPost } from "./types";

let seq = 0;
function post(at: string, over: Partial<AnalysisPost> = {}): AnalysisPost {
  return {
    id: String(++seq),
    postedAt: new Date(at),
    text: null,
    length: 100,
    lines: 1,
    emojiCount: 0,
    mediaKind: "text",
    views: null,
    hasLink: false,
    hasButton: false,
    hasPrice: false,
    hasOdds: false,
    hasVipCall: false,
    hashtags: 0,
    mentions: 0,
    questions: 0,
    capsRatio: 0,
    hasMatch: false,
    isBetResult: false,
    hasBonus: false,
    hasPromoCode: false,
    gainClaim: false,
    aiMention: false,
    free: false,
    paid: false,
    ...over,
  };
}

const val = (ms: readonly Measure[], key: string) => ms.find((m) => m.key === key);

const enqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };

describe("rythme (heures de Paris, tranches de 30 min)", () => {
  // Hiver (UTC+1) : lundi 2, mardi 3, jeudi 5 novembre 2026.
  const posts = [
    post("2026-11-02T08:10:00Z"), // 09:10 Paris
    post("2026-11-02T11:00:00Z"), // 12:00
    post("2026-11-02T18:40:00Z"), // 19:40
    post("2026-11-03T08:20:00Z"), // 09:20
    post("2026-11-03T18:35:00Z"), // 19:35
    post("2026-11-05T08:05:00Z"), // 09:05
  ];
  const { measures, peakSlots } = rhythmMeasures(posts);

  it("posts par jour et par semaine sur les jours couverts (4 jours, du lundi au jeudi)", () => {
    expect(val(measures, "daysCovered")?.value).toBe(4);
    expect(val(measures, "postsPerDay")).toMatchObject({ value: 1.5, sampleSize: 6 });
    expect(val(measures, "postsPerWeek")?.value).toBe(10.5);
  });

  it("régularité = écart-type ÷ moyenne des posts par jour (3, 2, 0, 1 → 1,118 ÷ 1,5 = 0,75)", () => {
    expect(val(measures, "regularity")).toMatchObject({ value: 0.75, sampleSize: 4 });
  });

  it("délai médian entre deux posts (170, 460, 615, 820, 2250 min → 615)", () => {
    expect(val(measures, "medianGapMinutes")).toMatchObject({ value: 615, sampleSize: 5 });
  });

  it("tranches, jours de la semaine et heures de pointe", () => {
    expect(val(measures, "slot.09:00")?.value).toBe(3);
    expect(val(measures, "slot.19:30")?.value).toBe(2);
    expect(val(measures, "slot.12:00")?.value).toBe(1);
    expect(peakSlots).toEqual(["09:00", "19:30", "12:00"]);
    expect(val(measures, "peakShare")?.value).toBe(100);
    expect(val(measures, "weekday.1")?.value).toBe(3);
    expect(val(measures, "weekday.2")?.value).toBe(2);
    expect(val(measures, "weekday.3")?.value).toBe(0);
    expect(val(measures, "weekday.4")?.value).toBe(1);
  });

  it("heure d'été et d'hiver : même heure de Paris, même tranche ; nuit du changement d'heure", () => {
    expect(slotOf(new Date("2026-10-20T07:10:00Z"))).toBe("09:00"); // été, UTC+2
    expect(slotOf(new Date("2026-11-03T08:10:00Z"))).toBe("09:00"); // hiver, UTC+1
    expect(slotOf(new Date("2026-10-25T00:30:00Z"))).toBe("02:30"); // avant le recul
    expect(slotOf(new Date("2026-10-25T01:30:00Z"))).toBe("02:30"); // après le recul
  });

  it("fenêtre imposée (canal du client) : jours sans post comptés, 0 post par jour est une mesure", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    const r = rhythmMeasures([post("2026-11-02T08:10:00Z"), post("2026-11-02T18:10:00Z")], { days, spanDays: 4 });
    expect(val(r.measures, "postsPerDay")?.value).toBe(0.5);
    expect(rhythmMeasures([], { days, spanDays: 4 }).measures.find((m) => m.key === "postsPerDay")?.value).toBe(0);
  });
});

describe("forme", () => {
  const posts = [
    post("2026-11-02T08:00:00Z", { length: 10, lines: 1, emojiCount: 0, capsRatio: 0, mediaKind: "text" }),
    post("2026-11-02T09:00:00Z", { length: 20, lines: 2, emojiCount: 1, capsRatio: 0.5, mediaKind: "text", questions: 1, hasButton: true }),
    post("2026-11-02T10:00:00Z", { length: 30, lines: 2, emojiCount: 2, mediaKind: "photo", hashtags: 1, hasButton: true }),
    post("2026-11-02T11:00:00Z", { length: 40, lines: 3, emojiCount: 3, mediaKind: "photo", questions: 2, hashtags: 2, hasLink: true }),
    post("2026-11-02T12:00:00Z", { length: 100, lines: 5, emojiCount: 4, mediaKind: "video", hashtags: 2, mentions: 1, hasButton: true }),
  ];
  const m = formMeasures(posts);
  it("longueur : médiane 30, quartiles 20 et 40 ; lignes 2 ; emojis 2 par post", () => {
    expect(val(m, "lengthMedian")).toMatchObject({ value: 30, sampleSize: 5 });
    expect(val(m, "lengthQ1")?.value).toBe(20);
    expect(val(m, "lengthQ3")?.value).toBe(40);
    expect(val(m, "linesMedian")?.value).toBe(2);
    expect(val(m, "emojisPerPost")?.value).toBe(2);
  });
  it("majuscules 10 %, questions 40 %, mélange 40 / 40 / 20, liens 20 %, boutons 60 %, hashtags 1, mentions 0,2", () => {
    expect(val(m, "capsShare")?.value).toBe(10);
    expect(val(m, "questionShare")?.value).toBe(40);
    expect(val(m, "media.text")?.value).toBe(40);
    expect(val(m, "media.photo")?.value).toBe(40);
    expect(val(m, "media.video")?.value).toBe(20);
    expect(val(m, "media.poll")?.value).toBe(0);
    expect(val(m, "media.document")).toBeUndefined();
    expect(val(m, "linkShare")?.value).toBe(20);
    expect(val(m, "buttonShare")?.value).toBe(60);
    expect(val(m, "hashtagsPerPost")?.value).toBe(1);
    expect(val(m, "mentionsPerPost")?.value).toBe(0.2);
  });
});

describe("fond par univers", () => {
  const sports = [
    post("2026-11-02T09:00:00Z", { hasOdds: true, hasVipCall: true }),
    post("2026-11-02T12:00:00Z", { isBetResult: true }), // 180 min après
    post("2026-11-03T09:00:00Z", { hasOdds: true, hasVipCall: true }), // sans résultat
    post("2026-11-06T08:00:00Z", { hasOdds: true }),
    post("2026-11-06T08:30:00Z", { hasOdds: true, hasVipCall: true }),
    post("2026-11-06T10:30:00Z", { isBetResult: true, gainClaim: true }), // 150 min après le pari de 8 h
  ];
  it("séries pari → résultat : 2 séries (180 et 150 min), délai médian 165, un pari sur deux suivi", () => {
    expect(betSeriesOf(sports).map((s) => s.delayMinutes)).toEqual([180, 150]);
    const m = contentMeasures(sports, "sports");
    expect(val(m, "betSeries")).toMatchObject({ value: 2, sampleSize: 4 });
    expect(val(m, "betSeriesShare")?.value).toBe(50);
    expect(val(m, "betSeriesDelayMinutes")).toMatchObject({ value: 165, sampleSize: 2 });
    expect(val(m, "oddsShare")?.value).toBe(67);
    expect(val(m, "betResultShare")?.value).toBe(33);
    expect(val(m, "vipCallShare")?.value).toBe(50);
    expect(val(m, "gainClaimShare")?.value).toBe(17);
    expect(val(m, "bonusShare")).toBeUndefined();
  });
  it("au-delà de 48 h, pas de série", () => {
    expect(betSeriesOf([post("2026-11-02T09:00:00Z", { hasOdds: true }), post("2026-11-04T09:01:00Z", { isBetResult: true })])).toEqual([]);
  });
  it("casino : bonus et codes promo ; annonces de gains, liens, médias et mots interdits signalés", () => {
    const casino = [
      post("2026-11-02T09:00:00Z", { hasBonus: true, hasPromoCode: true, mediaKind: "photo", text: "Bonus de folie avec le code LUCKY", hasLink: true }),
      post("2026-11-02T12:00:00Z", { hasBonus: true, gainClaim: true, text: "J'ai pris +500 € sur la roulette" }),
      post("2026-11-02T15:00:00Z", { text: "Jackpot facile ce soir" }),
      post("2026-11-02T18:00:00Z", { text: "On se retrouve au live" }),
    ];
    const m = contentMeasures(casino, "casino");
    expect(val(m, "bonusShare")?.value).toBe(50);
    expect(val(m, "promoCodeShare")?.value).toBe(25);
    expect(val(m, "oddsShare")).toBeUndefined();
    const flagged = flaggedOf(casino, "casino", ["jackpot facile"]);
    expect(flagged).toHaveLength(4);
    expect(flagged[0]).toContain("Annonces de gains dans 1 posts sur 4");
    expect(flagged.join(" ")).toContain("Liens dans 1 posts");
    expect(flagged.join(" ")).toContain("« jackpot facile » (1 posts)");
    expect(flagged.join(" ")).toContain("Photos ou vidéos dans 1 posts");
  });
  it("motifs lus sur le texte (VIP, cote, match, résultat, gains, gratuit / payant, IA)", () => {
    expect(textSignals("Écris-moi en DM, places limitées").hasVipCall).toBe(true);
    expect(textSignals("PSG vs OM, cote 1,85").hasOdds).toBe(true);
    expect(textSignals("PSG vs OM, cote 1,85").hasMatch).toBe(true);
    expect(textSignals("✅ Cote passée !").isBetResult).toBe(true);
    expect(textSignals("Passe une bonne soirée").isBetResult).toBe(false);
    expect(textSignals("On a encaissé 1 200 € hier").gainClaim).toBe(true);
    expect(textSignals("+300 € ce soir pour les membres").gainClaim).toBe(true);
    expect(textSignals("Ce soir on joue tranquille").gainClaim).toBe(false);
    expect(textSignals("Accès gratuit puis abonnement").free).toBe(true);
    expect(textSignals("Accès gratuit puis abonnement").paid).toBe(true);
    expect(textSignals("Écrit par une IA").aiMention).toBe(true);
    expect(textSignals("Tu viens ? On commence ? #roulette @casinofan").questions).toBe(2);
  });
});

describe("résultats et corrélations (avec effectifs)", () => {
  // 12 posts : vues = 100 × i, longueur = 10 × i ; 6 le matin (9 h Paris), 6 le soir (20 h Paris).
  const twelve = Array.from({ length: 12 }, (_, k) => {
    const i = k + 1;
    const at = i <= 6 ? `2026-11-0${i}T08:00:00Z` : `2026-11-0${i - 6}T19:00:00Z`;
    return post(at, { views: 100 * i, length: 10 * i, mediaKind: i % 2 ? "photo" : "text" });
  });
  it("vues médianes, meilleurs et plus faibles posts", () => {
    const m = resultsMeasures(twelve);
    expect(val(m, "viewsMedian")).toMatchObject({ value: 650, sampleSize: 12 });
    expect(val(m, "best.1")?.value).toBe(1200);
    expect(val(m, "best.1")?.label).toContain("20:00");
    expect(val(m, "worst.1")?.value).toBe(100);
    expect(val(m, "worst.3")?.value).toBe(300);
  });
  it("longueur ↔ vues = 1 sur 12 posts ; médianes par moment de la journée et par média avec leur effectif", () => {
    const m = resultsMeasures(twelve);
    expect(val(m, "corr.lengthViews")).toMatchObject({ value: 1, sampleSize: 12 });
    expect(Number(val(m, "corr.hourViews")?.value)).toBeGreaterThan(0.8);
    expect(val(m, "viewsByPeriod.matin")).toMatchObject({ value: 350, sampleSize: 6 });
    expect(val(m, "viewsByPeriod.soir")).toMatchObject({ value: 950, sampleSize: 6 });
    // Photos : i impairs (100, 300, …, 1100) → médiane 600 ; texte : i pairs → 700.
    expect(val(m, "viewsByMedia.photo")).toMatchObject({ value: 600, sampleSize: 6 });
    expect(val(m, "viewsByMedia.text")).toMatchObject({ value: 700, sampleSize: 6 });
  });
  it("sous 10 posts avec vues : aucune corrélation (valeur vide, effectif donné)", () => {
    const m = resultsMeasures(twelve.slice(0, 9));
    expect(val(m, "corr.lengthViews")).toMatchObject({ value: null, sampleSize: 9 });
    expect(val(m, "corr.hourViews")?.value).toBeNull();
    expect(val(m, "viewsByPeriod.matin")?.value).toBeNull();
  });
  it("vues invisibles : seulement la médiane vide", () => {
    expect(resultsMeasures([post("2026-11-02T08:00:00Z")])).toEqual([
      { key: "viewsMedian", label: "Vues médianes par post", value: null, unit: "vues", sampleSize: 0 },
    ]);
  });
  it("citations de 10 mots au plus, sans lien, jamais une annonce de gains", () => {
    const q = quotesOf([
      post("2026-11-02T08:00:00Z", { views: 10, text: "Un deux trois quatre cinq six sept huit neuf dix onze douze https://x.io" }),
      post("2026-11-02T09:00:00Z", { views: 99, gainClaim: true, text: "J'ai pris +500 €" }),
      post("2026-11-02T10:00:00Z", { views: 50, text: "Ce soir live roulette @moncanal" }),
    ]);
    expect(q).toEqual(["Ce soir live roulette", "Un deux trois quatre cinq six sept huit neuf dix …"]);
  });
});

function refRow(i: number, over: Record<string, unknown> = {}) {
  const at = new Date(Date.UTC(2026, 10, 1 + Math.floor(i / 3), 8 + (i % 3) * 5));
  const text = `Ce soir roulette live numéro ${i}, viens tenter ta chance avec nous ${i % 2 ? "😍" : ""}`;
  return {
    referenceChannelId: "ref1",
    externalId: 100 + i,
    postedAt: at,
    via: "WEB",
    text,
    textPurgedAt: null,
    textHash: null,
    shingles: shingleHashes(text),
    length: text.length,
    lines: 1,
    emojiCount: i % 2,
    mediaKind: i % 3 === 0 ? "photo" : "text",
    views: 1000 + i * 10,
    hasLink: false,
    hasButton: i % 2 === 0,
    hasPrice: false,
    hasOdds: false,
    hasVipCall: i % 4 === 0,
    keywords: [],
    features: {},
    ...over,
  };
}

function seed(count: number, opts: { purged?: boolean } = {}) {
  return createFakePrisma({
    referenceChannel: [{ id: "ref1", username: "exemple", title: "Exemple", via: "WEB", universe: "casino", targetChannelIds: ["c1"], status: "READY", removedAt: null }],
    referencePost: Array.from({ length: count }, (_, i) => refRow(i, opts.purged ? { text: null, textPurgedAt: new Date("2026-12-01T00:00:00Z") } : {})),
    channel: [
      { id: "c1", title: "Roulette FR", vertical: "CASINO" },
      { id: "d1", title: "Rencontres", vertical: "DATING" },
    ],
  });
}

describe("analyzeReference", () => {
  it("refuse sous 20 posts", async () => {
    const prisma = seed(19);
    expect(await analyzeReference({ prisma, enqueue }, "ref1")).toEqual({ tooFew: true, count: 19 });
  });
  it("20 posts : analyse complète ; textes effacés après 30 jours, mesures gardées", async () => {
    const live = await analyzeReference({ prisma: seed(20), enqueue }, "ref1");
    const purged = await analyzeReference({ prisma: seed(20, { purged: true }), enqueue }, "ref1");
    if ("tooFew" in live || "tooFew" in purged) throw new Error("analyse attendue");
    expect(live.sampleSize).toBe(20);
    expect(live.universe).toBe("casino");
    expect(val(live.form, "media.photo")?.value).toBe(35); // i multiple de 3 : 7 sur 20
    expect(val(live.form, "buttonShare")?.value).toBe(50);
    expect(val(live.content, "vipCallShare")?.value).toBe(25);
    expect(live.quotes).toHaveLength(3);
    expect(live.quotes.every((q) => q.split(" ").filter((w) => w !== "…").length <= 10)).toBe(true);
    // Après la purge : mêmes chiffres, plus de citation.
    expect(purged.form).toEqual(live.form);
    expect(purged.rhythm).toEqual(live.rhythm);
    expect(purged.quotes).toEqual([]);
  });
  it("mesures de `features` (chantier A) prioritaires sur le texte", () => {
    const p = fromReferencePost({ ...refRow(1), features: { hashtags: ["#a", "#b"], gainClaim: true, capsRatio: 25, betResult: "won" } } as never);
    expect(p).toMatchObject({ hashtags: 2, gainClaim: true, capsRatio: 0.25, isBetResult: true });
  });
});

describe("comparaison eux / nous", () => {
  const theirs = (over: Partial<Record<string, number>>): InspirationAnalysis => {
    const a = computeAnalysis([post("2026-11-02T08:00:00Z")], { referenceChannelId: "ref1", universe: "casino" });
    a.rhythm = a.rhythm.map((m) => (m.key in over ? { ...m, value: over[m.key]! } : m));
    a.form = a.form.map((m) => (m.key in over ? { ...m, value: over[m.key]! } : m));
    return a;
  };
  it("seuils : relatif 30 % (et 0,5 au moins), 15 points pour une part, 0,3 pour une corrélation", () => {
    const t = DEFAULT_GAP_THRESHOLDS;
    expect(gapMatters({ key: "postsPerDay" }, 5, 2, t)).toBe(true);
    expect(gapMatters({ key: "postsPerDay" }, 5, 4, t)).toBe(false);
    expect(gapMatters({ key: "postsPerDay" }, 0.4, 0.1, t)).toBe(false); // relatif fort, absolu trop petit
    expect(gapMatters({ key: "media.photo", unit: "%" }, 40, 20, t)).toBe(true);
    expect(gapMatters({ key: "media.photo", unit: "%" }, 40, 30, t)).toBe(false);
    expect(gapMatters({ key: "corr.lengthViews" }, 0.6, 0.1, t)).toBe(true);
    expect(gapMatters({ key: "postsPerDay" }, 5, 4, { ...t, perKey: { postsPerDay: 1 } })).toBe(true);
  });
  it("tableau sans les histogrammes ; heures de pointe sans tranche commune = écart qui compte", () => {
    const a = theirs({ postsPerDay: 6, lengthMedian: 120 });
    const b = theirs({ postsPerDay: 2, lengthMedian: 110 });
    b.peakSlots = ["21:00"];
    const gaps = compareAnalyses(a, b);
    expect(gaps.find((g) => g.key === "postsPerDay")).toMatchObject({ theirs: 6, ours: 2, matters: true });
    expect(gaps.find((g) => g.key === "lengthMedian")).toMatchObject({ theirs: 120, ours: 110, matters: false });
    expect(gaps.find((g) => g.key === "peakSlots")).toMatchObject({ theirs: "09:00", ours: "21:00", matters: true });
    expect(gaps.some((g) => /^(slot|weekday)\./.test(g.key))).toBe(false);
  });
  it("canal du client : posts envoyés des 28 derniers jours, vues de PostInsight, seuils du réglage", async () => {
    const prisma = seed(24);
    const now = new Date("2026-11-20T12:00:00Z");
    const sent = (id: string, at: string, text: string) => ({ id, channelId: "c1", status: "SENT", sentAt: new Date(at), text, mediaAssetIds: [], buttons: [] });
    prisma._model("post").rows.push(
      sent("p1", "2026-11-10T19:00:00Z", "Roulette ce soir 🔥"),
      sent("p2", "2026-11-12T19:00:00Z", "Live à 21 h ?"),
      sent("p3", "2026-10-01T19:00:00Z", "Trop vieux, hors fenêtre"),
      { ...sent("p4", "2026-11-15T19:00:00Z", "brouillon"), status: "DRAFT" },
    );
    prisma._model("postInsight").rows.push({ postId: "p1", format: "PHOTO", viewsFinal: 300, views24h: 250 });
    const deps: AgentsDeps = { prisma, enqueue, now: () => now };
    const analysis = await analyzeReference(deps, "ref1");
    if ("tooFew" in analysis) throw new Error("analyse attendue");
    const cmp = await compareWithChannel(deps, analysis, "c1");
    expect(cmp).toMatchObject({ channelId: "c1", channelTitle: "Roulette FR", ourSampleSize: 2 });
    // 24 posts sur 8 jours chez eux (3 par jour), 2 posts sur 28 jours chez nous (0,1 par jour).
    expect(cmp.gaps.find((g) => g.key === "postsPerDay")).toMatchObject({ theirs: 3, ours: 0.1, matters: true });
    expect(cmp.gaps.find((g) => g.key === "media.photo")).toMatchObject({ ours: 50 });
    expect(cmp.gaps.find((g) => g.key === "questionShare")).toMatchObject({ theirs: 0, ours: 50, matters: true });
    prisma._model("setting").rows.push({ key: "inspiration.thresholds", value: { sharePoints: 60 } });
    const relaxed = await compareWithChannel(deps, analysis, "c1");
    expect(relaxed.gaps.find((g) => g.key === "questionShare")?.matters).toBe(false);
  });
  it("univers différent : erreur claire", async () => {
    const prisma = seed(20);
    const deps: AgentsDeps = { prisma, enqueue };
    const analysis = await analyzeReference(deps, "ref1");
    if ("tooFew" in analysis) throw new Error("analyse attendue");
    await expect(compareWithChannel(deps, analysis, "d1")).rejects.toThrow(/Univers différent : le canal exemple est Casino, « Rencontres » est Rencontres/);
  });
});
