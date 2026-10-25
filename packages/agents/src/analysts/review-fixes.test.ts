/**
 * Phase 29 — relecture adverse : défauts corrigés (un test par défaut, chacun échouait avant la correction).
 */
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import type { AgentsDeps } from "../types";
import { applyRecommendation } from "../algo/contracts";
import { autoApplyPending } from "../agents/synthese/index";
import { MARKET_NEVER_APPLIED } from "../agents/synthese/apply";
import { algoProposed } from "../boss/facts";
import type { BossDeps } from "../boss/contract";
import { LEGAL_DISCLAIMER, type AnalystsWeb } from "./contract";
import { boundedAnswer } from "./kevin-texts";
import { finalizeAnswer } from "./strategist";
import { LEGAL_REWRITE_SENTENCE, normalizeUrl } from "./citations";
import { createAnalystsWeb, memoryHostThrottle } from "./watch/polite";
import { fetchForum } from "./watch/readers";
import { readSource, type WatchSource } from "./watch/ingest";
import { summarizeEntry } from "./watch/classify";
import { fakeClock, fakeFetch, scriptedLlm } from "./watch/testing";

const NOW = new Date("2026-10-26T08:00:00Z");
const enqueue = { async orchestrator() {}, async step() {} };

const marketRec = {
  id: "m1",
  teamKey: "analystes",
  source: "market_analysis",
  target: "MARKET",
  targetId: "CASINO:FR",
  field: "ad_strategy",
  before: null,
  after: { title: "Vidéo façon témoignage" },
  evidence: {},
  size: "BIG",
  status: "PROPOSED",
  appliedAt: null,
  createdAt: NOW,
};

describe("propositions de l'analyse du marché hors de la mécanique de l'équipe Algorithme", () => {
  it("ni listées par Kevin parmi les réglages Algorithme, ni appliquées par le Grand Chef, ni par la voie générique", async () => {
    const prisma = createFakePrisma({ recommendation: [{ ...marketRec }] });
    const deps: AgentsDeps = { prisma, now: () => NOW, enqueue };
    expect(await algoProposed(deps as unknown as BossDeps)).toEqual([]);
    expect(await autoApplyPending(deps, 2)).toEqual({ applied: [], refused: [] });
    expect(await applyRecommendation(deps, "m1", { userId: "u1", via: "SITE" })).toEqual({ ok: false, message: MARKET_NEVER_APPLIED });
    expect(prisma._tables.recommendation![0]!.status).toBe("PROPOSED");
  });
});

describe("phrase fixe jamais coupée", () => {
  it("réponse trop longue : la phrase fixe reste en dernière ligne", () => {
    const body = [...Array.from({ length: 19 }, (_, i) => `- ligne ${i + 1} (https://ex.example/${i})`), LEGAL_DISCLAIMER].join("\n");
    const out = boundedAnswer(body, { maxLines: 15 });
    const lines = out.split("\n");
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(lines[lines.length - 1]).toBe(LEGAL_DISCLAIMER);
    expect(out.split(LEGAL_DISCLAIMER).length).toBe(2);
  });
});

describe("aucune affirmation sans source", () => {
  it("une affirmation hors liste et sans adresse est retirée ; un « je n'ai rien » reste", () => {
    const url = "https://www.reddit.com/r/casinoonline/abc";
    const sources = new Map([[normalizeUrl(url), { url, verified: true, date: null, title: null }]]);
    const raw = [
      `- Les vidéos de joueurs marchent (${url})`,
      "Les bonus de 200 % doublent les inscriptions en France.",
      "Je n'ai rien de sourcé sur l'Allemagne.",
      "En France, c'est illégal de faire de la pub casino sans licence.",
    ].join("\n");
    const fin = finalizeAnswer(raw, { sources, mentionsRules: false });
    expect(fin.lines.join("\n")).not.toContain("200 %");
    expect(fin.lines).toContain("Je n'ai rien de sourcé sur l'Allemagne.");
    expect(fin.lines).toContain(LEGAL_REWRITE_SENTENCE);
  });
});

describe("débit tenu entre deux lectures simultanées du même site", () => {
  it("deux lectures en même temps (file à 2 tâches) : au moins 10 s entre elles", async () => {
    const c = fakeClock(NOW);
    const f = fakeFetch(
      { "https://www.reddit.com/robots.txt": { status: 404, body: "" }, "https://www.reddit.com/a": { body: "<p>a</p>" }, "https://www.reddit.com/b": { body: "<p>b</p>" } },
      c.clock,
    );
    const web = createAnalystsWeb({ prisma: createFakePrisma(), enqueue, now: c.now, fetchImpl: f.impl, sleep: c.sleep, clock: c.clock, throttle: memoryHostThrottle(), robotsCache: new Map() });
    await web.fetchText("https://www.reddit.com/a");
    await Promise.all([web.fetchText("https://www.reddit.com/a"), web.fetchText("https://www.reddit.com/b")]);
    const at = f.calls.filter((x) => !x.url.endsWith("robots.txt")).map((x) => x.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(10_000);
  });

  it("un forum dont le réglage demande moins de 15 s reste à 15 s", async () => {
    const seen: Array<number | null | undefined> = [];
    const base: AnalystsWeb = {
      async fetchText() {
        return { status: 200, body: "<html><body></body></html>", finalUrl: "https://forum.example/" };
      },
      async search() {
        return [];
      },
    };
    const web = { ...base, withRate: (ms: number | null | undefined) => (seen.push(ms), base), allowedByRobots: async () => true };
    const source: WatchSource = { id: "s", name: "F", url: "https://forum.example/", sourceType: "FORUM", market: "CASINO", countries: [], languages: [], scrapeConfig: { rateLimitMs: 1000 }, isActive: true, errorCount: 0 };
    await readSource({ prisma: createFakePrisma(), enqueue, web }, source, 10);
    expect(seen).toEqual([15_000]);
  });
});

describe("pagination d'un forum", () => {
  it("un lien « suivant » vers un autre site (contenu de la page) n'est jamais suivi", async () => {
    const urls: string[] = [];
    const page = (n: number, next: string) =>
      `<html><body><article><h3><a href="/t/${n}">Sujet ${n} sur les pubs casino</a></h3><p>Texte assez long du sujet ${n} sur TikTok.</p></article><article><h3><a href="/t/${n}b">Autre sujet ${n}</a></h3><p>Encore un texte assez long ${n}.</p></article><a rel="next" href="${next}">Suivant</a></body></html>`;
    const web: AnalystsWeb = {
      async fetchText(url) {
        urls.push(url);
        return { status: 200, body: url.includes("forum.example") ? page(1, "http://169.254.169.254/latest/") : page(2, "/x"), finalUrl: url };
      },
      async search() {
        return [];
      },
    };
    const items = await fetchForum(web, "https://forum.example/f/", {}, { maxPages: 5 });
    expect(items.length).toBe(2);
    expect(urls).toEqual(["https://forum.example/f/"]);
  });
});

describe("résumé d'un contenu sans avis juridique", () => {
  it("une phrase « c'est illégal » du résumé n'est pas gardée", async () => {
    const llm = scriptedLlm(() => JSON.stringify({ summaryFr: "Un affilié dit que TikTok refuse les pubs bonus. En France, c'est illégal sans licence.", language: "fr", summaryOriginal: null }));
    const s = await summarizeEntry({ prisma: createFakePrisma(), enqueue, analystsLlm: llm }, { url: "https://forum.example/t/1", title: null, text: "texte", author: null, publishedAt: null, language: "fr" });
    expect(s.summary).toContain("TikTok refuse les pubs bonus");
    expect(s.summary).not.toMatch(/illégal/);
  });
});

describe("tendances qui parlent de règles", () => {
  it("« quelles tendances ? » avec un bannissement : la phrase fixe est dite", async () => {
    const { trendsReply } = await import("./kevin-read");
    const prisma = createFakePrisma({
      trendEntry: [
        { id: "e1", sourceId: "s", market: "CASINO", countries: ["FR"], title: null, summary: "TikTok coupe les comptes qui montrent un bonus.", url: "https://forum.example/t/1", publishedAt: NOW, category: "AD_BAN", relevanceScore: 8, verified: false, createdAt: NOW, tags: [] },
      ],
    });
    const text = await trendsReply({ prisma, enqueue, now: () => NOW }, { market: "CASINO" }, null);
    expect(text).toContain(LEGAL_DISCLAIMER);
  });
});

describe("rapport de la semaine : la France d'abord", () => {
  it("un groupe France peu fourni passe devant des groupes plus fournis d'autres pays", async () => {
    const { groupEntries } = await import("./strategist");
    const mk = (country: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${country}${i}`, market: "CASINO", countries: [country], relevanceScore: 5, url: `https://x.test/${country}/${i}`, summary: "s", category: "MARKET_TREND", sentiment: "NEUTRAL", verified: false, publishedAt: null, createdAt: new Date() }));
    const groups = groupEntries([...mk("DE", 5), ...mk("ES", 5), ...mk("IT", 5), ...mk("PL", 5), ...mk("NL", 5), ...mk("FR", 1)] as never);
    expect(groups[0]!.country).toBe("FR");
  });
});
