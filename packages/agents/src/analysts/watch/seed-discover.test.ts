import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsEnqueue } from "../../types";
import { EUROPE_COUNTRIES } from "../contract";
import { candidateOf, DISCOVERY_SETTING_KEY, discoverSources, discoveryLanguages } from "./discover";
import { createAnalystsWeb, memoryHostThrottle } from "./polite";
import { SEED_SOURCES, seedSources } from "./seed";
import { LOCAL_TERMS, WATCH_LANGUAGES } from "./terms";
import { ANALYSTS_FIXTURE_NOW, fakeClock, fakeFetch, fakeServerTools, scriptedLlm } from "./testing";

const enqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };

describe("sources de départ", () => {
  it("idempotent : créées une fois, jamais retouchées (même désactivées ou modifiées par l'équipe)", async () => {
    const prisma = createFakePrisma();
    const deps = { prisma, enqueue, now: () => ANALYSTS_FIXTURE_NOW };
    const first = await seedSources(deps);
    expect(first).toEqual({ created: SEED_SOURCES.length, existing: 0 });
    const rows = prisma._tables.trendSource!;
    rows[0]!.isActive = false;
    rows[0]!.name = "Renommée par l'équipe";
    expect(await seedSources(deps)).toEqual({ created: 0, existing: SEED_SOURCES.length });
    expect(rows).toHaveLength(SEED_SOURCES.length);
    expect(rows[0]).toMatchObject({ isActive: false, name: "Renommée par l'équipe" });
  });

  it("couverture du prompt : forums, Reddit, actualités, Telegram et X ; adresses uniques ; pays et langues valides", () => {
    const names = SEED_SOURCES.map((s) => s.name).join(" | ");
    for (const n of ["BlackHatWorld — gambling", "BlackHatWorld — dating", "AffLift", "STM Forum", "GPWA", "r/gambling", "r/sportsbetting", "r/onlinegambling", "r/affiliatemarketing", "r/datingapps", "r/Tinder", "r/paris_sportifs", "iGaming Business", "Casino.org", "EGR", "SBC News", "GamblingCompliance", "Social Media Today", "Search Engine Journal"])
      expect(names).toContain(n);
    expect(new Set(SEED_SOURCES.map((s) => s.url)).size).toBe(SEED_SOURCES.length);
    expect(SEED_SOURCES.filter((s) => s.sourceType === "TELEGRAM")).toHaveLength(9);
    expect(SEED_SOURCES.filter((s) => s.sourceType === "TWITTER")).toHaveLength(9);
    for (const s of SEED_SOURCES) {
      expect(s.countries.every((c) => c in EUROPE_COUNTRIES), s.name).toBe(true);
      expect(s.languages.every((l) => l in LOCAL_TERMS), s.name).toBe(true);
      // Aucun identifiant de compte dans un réglage de lecture.
      expect(JSON.stringify(s.scrapeConfig)).not.toMatch(/password|login|cookie|token/i);
    }
    // Recherche dans la langue locale : X Allemagne en allemand.
    expect(SEED_SOURCES.find((s) => s.sourceType === "TWITTER" && s.market === "SPORTS" && s.countries[0] === "DE")!.scrapeConfig.query).toBe("Sportwetten Werbung");
    // Toutes les langues des pays couverts ont leurs mots.
    expect(WATCH_LANGUAGES.every((l) => l in LOCAL_TERMS)).toBe(true);
  });
});

describe("découverte de nouvelles sources", () => {
  function kit(existing: Array<Record<string, unknown>> = [], budget?: number) {
    const c = fakeClock();
    const tools = fakeServerTools({
      search: (q) => [
        { url: "https://forum-affilies.example/threads/tiktok-casino.12/", title: "Forum des affiliés — TikTok casino", snippet: `Discussions d'affiliés (${q})` },
        { url: "https://www.reddit.com/r/sportwetten/comments/a1/x/", title: "r/sportwetten", snippet: "Wett-Diskussionen" },
        { url: "https://t.me/s/apuestas_news_exemple/55", title: "Apuestas News", snippet: "Canal público" },
        { url: "https://bonus-casino.example/", title: "Meilleurs bonus casino", snippet: "Page de bonus" },
        { url: "https://www.youtube.com/watch?v=1", title: "Vidéo", snippet: "jamais proposé" },
        { url: "https://www.blackhatworld.com/threads/1/", title: "BHW", snippet: "déjà suivi" },
      ],
    });
    const llm = scriptedLlm((req) => {
      expect(req.model).toBe("claude-sonnet-5-5");
      expect(req.user).not.toContain("youtube.com");
      expect(req.user).not.toContain("blackhatworld.com");
      return JSON.stringify({
        sources: [
          { key: "forum-affilies.example", score: 8, name: "Forum des affiliés", type: "FORUM", reason: "Discussions actives d'affiliés sur TikTok." },
          { key: "reddit.com/r/sportwetten", score: 7, name: "r/sportwetten", type: "REDDIT", reason: "Paris sportifs en allemand." },
          { key: "t.me/apuestas_news_exemple", score: 9, name: "Apuestas News", type: "TELEGRAM", reason: "Actualité des paris en Espagne." },
          { key: "bonus-casino.example", score: 3, name: "Bonus", type: "OTHER", reason: "Page commerciale." },
          { key: "invente.example", score: 10, name: "Inventé", type: "FORUM", reason: "absent des résultats" },
        ],
      });
    });
    const prisma = createFakePrisma({ trendSource: existing });
    const base = { prisma, enqueue, now: c.now, serverTools: tools, analystsLlm: llm, ...(budget !== undefined ? { monthlyBudgetCents: budget } : {}) };
    const web = createAnalystsWeb({ ...base, fetchImpl: fakeFetch({}).impl, sleep: c.sleep, clock: c.clock, throttle: memoryHostThrottle(), robotsCache: new Map() });
    return { prisma, tools, llm, deps: { ...base, web } };
  }

  it("recherches dans plusieurs langues, score ≥ 7 → source INACTIVE « discovered » + proposition ; rien d'inventé", async () => {
    const k = kit([{ id: "bhw", name: "BHW", url: "https://www.blackhatworld.com/search/?q=gambling", sourceType: "FORUM", market: "CASINO", isActive: true }]);
    const res = await discoverSources(k.deps, ANALYSTS_FIXTURE_NOW);
    if (!res.ok) throw new Error("découverte attendue");
    const langs = discoveryLanguages(ANALYSTS_FIXTURE_NOW);
    expect(langs[0]).toBe("en");
    expect(langs).toHaveLength(6);
    // Dès le premier lot de recherches, les candidats sont tous trouvés (doublons écartés ensuite).
    expect(res.searched).toBe(18);
    expect(k.tools.requests.some((r) => String(r.messages[0]!.content).includes(LOCAL_TERMS[langs[1]!]!.forum))).toBe(true);
    expect(res.proposals.map((p) => [p.name, p.url, p.sourceType, p.score])).toEqual([
      ["Forum des affiliés", "https://forum-affilies.example/", "FORUM", 8],
      ["r/sportwetten", "https://www.reddit.com/r/sportwetten/", "REDDIT", 7],
      ["Apuestas News", "https://t.me/s/apuestas_news_exemple", "TELEGRAM", 9],
    ]);
    const created = k.prisma._tables.trendSource!.filter((s) => s.origin === "discovered");
    expect(created).toHaveLength(3);
    expect(created.every((s) => s.isActive === false)).toBe(true);
    expect(created[0]).toMatchObject({ market: "CASINO", languages: ["en"], scrapeConfig: { mode: "search", allowedDomains: ["forum-affilies.example"] } });
    expect(k.prisma._tables.setting!.find((s) => s.key === DISCOVERY_SETTING_KEY)!.value).toBe(ANALYSTS_FIXTURE_NOW.toISOString());
  });

  it("une fois par semaine : relancée avant 7 jours → rien ; `force` passe outre", async () => {
    const k = kit();
    await discoverSources(k.deps, ANALYSTS_FIXTURE_NOW);
    const calls = k.tools.requests.length;
    const soon = await discoverSources(k.deps, new Date(ANALYSTS_FIXTURE_NOW.getTime() + 3 * 86_400_000));
    expect(soon).toMatchObject({ ok: false, skipped: "not_due" });
    expect(k.tools.requests.length).toBe(calls);
    const forced = await discoverSources(k.deps, new Date(ANALYSTS_FIXTURE_NOW.getTime() + 3 * 86_400_000), { force: true });
    // Déjà proposées : pas de doublon.
    expect(forced).toMatchObject({ ok: true, proposals: [] });
  });

  it("plafond atteint : arrêt propre, aucune source créée", async () => {
    const k = kit([], 0);
    const res = await discoverSources(k.deps, ANALYSTS_FIXTURE_NOW);
    expect(res).toMatchObject({ ok: true, searched: 0, proposals: [], stoppedReason: expect.stringMatching(/Plafond/) });
    expect(k.prisma._tables.trendSource ?? []).toHaveLength(0);
    expect(k.tools.requests).toHaveLength(0);
    // Rien de cherché : la découverte sera retentée au prochain passage.
    expect((k.prisma._tables.setting ?? []).some((r) => r.key === DISCOVERY_SETTING_KEY)).toBe(false);
  });

  it("clé d'une candidate : canal, sous-forum ou site ; réseaux et moteurs ignorés", () => {
    expect(candidateOf("https://t.me/s/canal_exemple/4")).toMatchObject({ key: "t.me/canal_exemple", sourceType: "TELEGRAM" });
    expect(candidateOf("https://old.reddit.com/r/Gambling/comments/1/")).toMatchObject({ key: "reddit.com/r/gambling", url: "https://www.reddit.com/r/Gambling/" });
    expect(candidateOf("https://www.google.com/search?q=x")).toBeNull();
    expect(candidateOf("https://x.com/a/status/1")).toBeNull();
  });
});
