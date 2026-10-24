import { describe, expect, it } from "vitest";
import {
  canManageInspiration,
  canUndo,
  engineResult,
  inspirationFieldLabel,
  inspirationHistory,
  inspirationValueText,
  measureValueText,
  nextReadText,
  parisHour,
  parseStoredAnalysis,
  rawMeasureRows,
  rawMeasures,
  recCounts,
  recCountsText,
  referenceName,
  referenceState,
  referenceSubtitle,
  referenceTelegramLink,
  safeId,
  shortQuote,
  styleProfileView,
  unavailableReasonText,
  viaLabel,
  type RawPost,
} from "./inspiration";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";

const post = (iso: string, o: Partial<RawPost> = {}): RawPost => ({
  postedAt: new Date(iso),
  length: 100,
  mediaKind: "text",
  views: null,
  hasLink: false,
  hasButton: false,
  hasVipCall: false,
  hasOdds: false,
  ...o,
});

describe("référence : nom, état, voie", () => {
  it("nom public d'abord, sinon titre, sinon « Canal sans nom »", () => {
    expect(referenceName({ username: "roulette_pro", title: "Roulette Pro" })).toBe("@roulette_pro");
    expect(referenceName({ username: "@x_y_z", title: null })).toBe("@x_y_z");
    expect(referenceName({ username: null, title: "Club privé" })).toBe("Club privé");
    expect(referenceName({ username: " ", title: "" })).toBe("Canal sans nom");
    expect(referenceSubtitle({ username: "roulette_pro", title: "Roulette Pro" })).toBe("Roulette Pro");
    expect(referenceSubtitle({ username: null, title: "Club" })).toBeNull();
  });

  it("lien Telegram seulement pour un nom valide", () => {
    expect(referenceTelegramLink("roulette_pro")).toBe("https://t.me/roulette_pro");
    expect(referenceTelegramLink("a b")).toBeNull();
    expect(referenceTelegramLink(null)).toBeNull();
  });

  it("états lisibles, raison d'un canal illisible en mots", () => {
    expect(referenceState("READY", null)).toEqual({ label: "Prête", tone: "success", detail: null });
    expect(referenceState("READING", null).label).toBe("En lecture");
    const u = referenceState("UNAVAILABLE", "private");
    expect(u.label).toBe("Illisible");
    expect(u.detail).toContain("canal privé");
    expect(unavailableReasonText("no_account")).toBe("aucun compte réel n'est membre de ce canal");
    expect(unavailableReasonText("L'aperçu public est fermé")).toBe("L'aperçu public est fermé");
    expect(unavailableReasonText(null)).toBe("raison inconnue");
    expect(viaLabel("WEB")).toBe("Aperçu public");
    expect(viaLabel("ACCOUNT")).toBe("Compte réel");
    expect(viaLabel("FORWARDED")).toBe("Posts transférés");
  });

  it("prochaine relecture", () => {
    const f = () => "lundi";
    expect(nextReadText("READING", null, f)).toBe("en cours");
    expect(nextReadText("READY", null, f)).toBe("pas prévue");
    expect(nextReadText("READY", new Date(), f)).toBe("lundi");
  });

  it("droits : administrateurs seulement pour Annuler et Retirer", () => {
    expect(canManageInspiration("ADMIN")).toBe(true);
    expect(canManageInspiration("MANAGER")).toBe(false);
  });

  it("aucun mot technique dans les libellés", () => {
    const texts = [
      ...["READY", "READING", "UNAVAILABLE"].map((s) => referenceState(s, "private").label),
      ...["private", "restricted", "not_found", "no_account", "rate_limited", "error"].map(unavailableReasonText),
      ...["WEB", "ACCOUNT", "FORWARDED"].map(viaLabel),
    ];
    expect(jargonIn(texts.join(" · "))).toEqual([]);
    expect(texts.join(" ")).not.toMatch(/MTProto|scraping|hash|shingle/i);
  });
});

describe("mesures brutes des posts lus", () => {
  it("compte, posts par jour, heures de Paris, longueur et vues du milieu, mélange", () => {
    // 4 posts sur 2 jours ; 19 h et 20 h à Paris (UTC+2 en octobre).
    const posts = [
      post("2026-10-20T17:00:00Z", { length: 80, mediaKind: "photo", views: 1000, hasVipCall: true }),
      post("2026-10-21T17:10:00Z", { length: 120, mediaKind: "photo", views: 3000, hasLink: true }),
      post("2026-10-21T18:00:00Z", { length: 200, mediaKind: "video", views: 2000, hasOdds: true }),
      post("2026-10-22T17:00:00Z", { length: 40, mediaKind: "text", hasButton: true }),
    ];
    const m = rawMeasures(posts);
    expect(m.count).toBe(4);
    expect(m.postsPerDay).toBe(2);
    expect(m.topHours).toEqual([
      { hour: 19, posts: 3 },
      { hour: 20, posts: 1 },
    ]);
    expect(m.medianLength).toBe(100);
    expect(m.medianViews).toBe(2000);
    expect(m.viewsSample).toBe(3);
    expect(m.mediaMix.map((x) => x.kind)).toEqual(["photo", "text", "video"]);
    expect(m.mediaMix[0]!.share).toBe(0.5);
    expect(m.vipShare).toBe(0.25);
    const rows = Object.fromEntries(rawMeasureRows(m).map((r) => [r.label, r.value]));
    expect(rows["Posts lus"]).toBe("4");
    expect(rows["Heures les plus fréquentes (Paris)"]).toBe("19 h (3 posts), 20 h (1 post)");
    expect(rows["Mélange des médias"]).toBe("photo 50 %, texte seul 25 %, vidéo 25 %");
    expect(rows["Vues du milieu"]).toContain("(3 posts)");
    expect(rows["Posts qui poussent le VIP"]).toBe("25 %");
  });

  it("aucun post : rien d'inventé", () => {
    const m = rawMeasures([]);
    expect(m.count).toBe(0);
    expect(m.postsPerDay).toBeNull();
    expect(m.medianLength).toBeNull();
    expect(m.linkShare).toBeNull();
    expect(rawMeasureRows(m).find((r) => r.label === "Vues du milieu")!.value).toBe("non visibles");
  });

  it("heure de Paris, été comme hiver", () => {
    expect(parisHour(new Date("2026-07-01T06:30:00Z"))).toBe(8);
    expect(parisHour(new Date("2026-12-01T23:30:00Z"))).toBe(0);
  });
});

describe("analyse et profil gardés en base", () => {
  it("lecture tolérante de l'analyse et des comparaisons", () => {
    const stats = {
      sampleSize: 48,
      rhythm: [{ key: "postsPerDay", label: "Posts par jour", value: 4.2, unit: "posts", sampleSize: 48 }, { bad: true }],
      form: [],
      content: [{ key: "vip", label: "Appels au VIP", value: "1 post sur 3", sampleSize: 48 }],
      results: [],
      peakSlots: ["19:00", "21:30"],
      quotes: ["un deux trois quatre cinq six sept huit neuf dix onze douze"],
      flagged: ["promesse de gain"],
      comparisons: [
        {
          channelId: "c1",
          channelTitle: "Roulette",
          ourSampleSize: 30,
          gaps: [{ key: "postsPerDay", label: "Posts par jour", theirs: 4.2, ours: 1.5, matters: true }, { nope: 1 }],
        },
      ],
    };
    const p = parseStoredAnalysis(stats)!;
    expect(p.analysis.rhythm).toHaveLength(1);
    expect(p.analysis.content[0]!.value).toBe("1 post sur 3");
    expect(p.analysis.quotes[0]).toBe("un deux trois quatre cinq six sept huit neuf dix…");
    expect(p.comparisons[0]!.gaps).toHaveLength(1);
    expect(p.comparisons[0]!.gaps[0]!.matters).toBe(true);
    // Forme enveloppée `{ analysis, comparisons }` acceptée aussi.
    expect(parseStoredAnalysis({ analysis: stats, comparisons: [] })!.analysis.sampleSize).toBe(48);
    expect(parseStoredAnalysis({})).toBeNull();
    expect(parseStoredAnalysis(null)).toBeNull();
  });

  it("citation coupée à 10 mots", () => {
    expect(shortQuote("a b c")).toBe("a b c");
    expect(shortQuote("1 2 3 4 5 6 7 8 9 10 11").split(" ")).toHaveLength(10);
  });

  it("valeur d'une mesure", () => {
    expect(measureValueText(4.25, "posts")).toBe("4,3 posts");
    expect(measureValueText(null)).toBe("—");
    expect(measureValueText("19 h")).toBe("19 h");
  });

  it("profil de style", () => {
    const p = styleProfileView({
      id: "s1",
      version: 2,
      createdAt: new Date(),
      rules: ["Phrase courte", 3, ""],
      description: "  Ton direct  ",
      examples: ["Exemple neuf"],
      flagged: null,
    });
    expect(p.rules).toEqual(["Phrase courte"]);
    expect(p.description).toBe("Ton direct");
    expect(p.flagged).toEqual([]);
  });
});

describe("propositions et historique", () => {
  it("libellés propres à l'inspiration ; un profil se dit par sa version", () => {
    expect(inspirationFieldLabel("styleProfileId")).toBe("Profil de style pour la Rédaction");
    expect(inspirationFieldLabel("mix")).toBe("Mélange vidéo / photo / texte");
    const versions = new Map([["s1", 3]]);
    expect(inspirationValueText("styleProfileId", "s1", versions)).toBe("profil de style v3");
    expect(inspirationValueText("styleProfileId", null, versions)).toBe("aucun");
    expect(inspirationValueText("styleProfileId", "s9", versions)).toBe("un autre profil de style");
    expect(inspirationValueText("postsPerDay", 4)).toBe("4");
  });

  it("annulable 30 jours après l'application", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(canUndo({ status: "APPLIED", appliedAt: new Date("2026-10-01T12:00:00Z") }, now)).toBe(true);
    expect(canUndo({ status: "APPLIED", appliedAt: new Date("2026-09-01T12:00:00Z") }, now)).toBe(false);
    expect(canUndo({ status: "PROPOSED", appliedAt: null }, now)).toBe(false);
  });

  it("comptes des propositions", () => {
    const c = recCounts([
      { status: "PROPOSED", n: 2 },
      { status: "APPLIED", n: 1 },
      { status: "UNDONE", n: 1 },
    ]);
    expect(c).toEqual({ proposed: 2, applied: 1, total: 4 });
    expect(recCountsText(c)).toBe("2 à décider, 1 appliquée, 1 terminée");
    expect(recCountsText(recCounts([]))).toBe("aucune");
  });

  it("historique du plus récent au plus ancien, avec le bilan des tests", () => {
    const h = inspirationHistory({
      createdAt: new Date("2026-10-01T10:00:00Z"),
      lastReadAt: new Date("2026-10-01T10:05:00Z"),
      postCount: 48,
      recs: [
        {
          field: "mix",
          targetLabel: "Roulette",
          appliedAt: new Date("2026-10-02T10:00:00Z"),
          appliedBy: "HUMAN",
          undoneAt: new Date("2026-10-05T10:00:00Z"),
          rejectedAt: null,
        },
      ],
      experiments: [
        {
          createdAt: new Date("2026-10-02T10:00:00Z"),
          startedAt: new Date("2026-10-02T11:00:00Z"),
          closedAt: new Date("2026-10-16T11:00:00Z"),
          status: "CLOSED",
          winner: "B",
          hypothesis: "Mélange de la référence",
          targetLabel: "Roulette",
        },
      ],
    });
    expect(h.map((e) => e.kind)).toEqual(["verdict", "undone", "test", "applied", "read", "added"]);
    expect(h[0]!.text).toBe("Bilan du test sur Roulette : La version B gagne");
    expect(h[1]!.text).toBe("Annulé : Mélange vidéo / photo / texte (Roulette)");
  });
});

describe("divers", () => {
  it("résultat du moteur, quelle que soit sa forme", () => {
    expect(engineResult({ ok: false, message: "Trop tard" }, "x")).toEqual({ ok: false, message: "Trop tard" });
    expect(engineResult({ ok: true }, "Fait.")).toEqual({ ok: true, message: "Fait." });
    expect(engineResult(undefined, "Fait.")).toEqual({ ok: true, message: "Fait." });
  });

  it("identifiants sûrs", () => {
    expect(safeId("clx123_a-b")).toBe("clx123_a-b");
    expect(safeId("../x")).toBeNull();
    expect(safeId(null)).toBeNull();
  });
});

describe("noms des réglages écrits par Kevin", () => {
  it("fenêtre horaire lisible", async () => {
    const { inspirationFieldLabel, inspirationValueText } = await import("./inspiration");
    expect(inspirationFieldLabel("window")).toBe("Fenêtre horaire des posts");
    expect(inspirationValueText("window", { windowStart: "18:00", windowEnd: "22:30" })).toBe("18:00-22:30");
    expect(inspirationFieldLabel("postsPerDay")).not.toMatch(/Réglage «/);
    expect(inspirationFieldLabel("mix")).not.toMatch(/Réglage «/);
  });
});
