import { describe, expect, it } from "vitest";
import { createFakePrisma, type FakePrisma } from "../../testing/fake-prisma";
import type { AgentsEnqueue, LlmRequest } from "../../types";
import { ANALYSTS_LIMITS } from "../contract";
import { createAnalystsWeb, memoryHostThrottle } from "./polite";
import { alertKindOf, ingestEntries, normalizeEntryUrl, platformRiskOfTags, purgeRawTexts, scrapeSource, urlHashOf, type WatchSource } from "./ingest";
import { ANALYSTS_FIXTURE_NOW, fakeClock, fakeFetch, readAnalystsFixture, scriptedLlm, type FakeRoute } from "./testing";

const enqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };
const BHW = "https://www.blackhatworld.com";
const FORUM_URL = `${BHW}/forums/gambling-affiliates.205/`;
const DAY = 24 * 3600_000;

/** Fausse IA : classement selon le texte (Haiku), résumé court (Sonnet). */
function fakeAi() {
  return scriptedLlm((req: LlmRequest) => {
    if (req.model === "claude-sonnet-5-5") return JSON.stringify({ summaryFr: `Résumé : ${req.user.match(/Titre : (.*)/)?.[1] ?? "contenu"}`.slice(0, 200), language: "en", summaryOriginal: "Summary." });
    const u = req.user;
    const c = u.includes("free spins")
      ? { category: "AD_BAN", sentiment: "NEGATIVE", relevanceScore: 9, countries: ["DE"], tags: ["meta_ban"], platform: "META", risk: "BAN" }
      : u.includes("UGC") || u.includes("Selfie")
        ? { category: "AD_CREATIVE", sentiment: "POSITIVE", relevanceScore: 8, countries: ["ES", "IT"], tags: ["ugc"], platform: "TIKTOK", risk: "LOW" }
        : u.includes("Ignore all previous")
          ? { category: "DISCUSSION", sentiment: "NEUTRAL", relevanceScore: 1, countries: [], tags: [], platform: null, risk: null }
          : u.includes("España")
            ? { category: "PLATFORM_CHANGE", sentiment: "NEGATIVE", relevanceScore: 8, countries: ["ES"], tags: ["tiktok_policy"], platform: "TIKTOK", risk: "HIGH" }
            : { category: "AD_STRATEGY", sentiment: "POSITIVE", relevanceScore: 7, countries: [], tags: ["telegram_funnel"], platform: null, risk: null };
    return JSON.stringify(c);
  });
}

function kit(opts: { routes?: Record<string, FakeRoute>; settings?: Array<{ key: string; value: unknown }>; source?: Record<string, unknown>; llm?: ReturnType<typeof scriptedLlm>; budget?: number } = {}) {
  const c = fakeClock();
  const routes = opts.routes ?? {
    [`${BHW}/robots.txt`]: { body: readAnalystsFixture("robots-forum.txt") },
    [FORUM_URL]: { body: readAnalystsFixture("bhw-gambling.html") },
    [`${FORUM_URL}page-2`]: { body: readAnalystsFixture("bhw-gambling-page-2.html") },
  };
  const f = fakeFetch(routes, c.clock);
  const prisma: FakePrisma = createFakePrisma({
    trendSource: [
      {
        id: "src1",
        name: "BlackHatWorld — gambling",
        url: FORUM_URL,
        sourceType: "FORUM",
        market: "CASINO",
        countries: ["DE", "ES", "FR"],
        languages: ["en"],
        scrapeConfig: {},
        isActive: true,
        origin: "seed",
        errorCount: 0,
        lastError: null,
        ...opts.source,
      },
    ],
    setting: opts.settings ?? [],
  });
  const llm = opts.llm ?? fakeAi();
  const base = { prisma, enqueue, now: c.now, analystsLlm: llm, ...(opts.budget !== undefined ? { monthlyBudgetCents: opts.budget } : {}) };
  const web = createAnalystsWeb({ ...base, fetchImpl: f.impl, sleep: c.sleep, clock: c.clock, throttle: memoryHostThrottle(), robotsCache: new Map() });
  const deps = { ...base, web };
  return { c, f, prisma, llm, deps, entries: () => prisma._tables.trendEntry ?? [], source: () => prisma._tables.trendSource![0]! };
}

describe("passage d'une source de forum", () => {
  it("lecture, classement, seuil, résumé, entrées rangées, alertes, état de la source", async () => {
    const k = kit();
    const res = await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res).toMatchObject({ read: 5, created: 4, belowThreshold: 1, duplicates: 0, failed: 0, stoppedReason: null });
    // Injection : classée DISCUSSION score 1 (sous le seuil), jamais rangée, jamais résumée.
    expect(k.entries().some((e) => String(e.url).includes("ignore-previous"))).toBe(false);
    expect(k.llm.calls.filter((r) => r.model === "claude-sonnet-5-5")).toHaveLength(4);
    const ban = k.entries().find((e) => String(e.url).includes("meta-killed"))!;
    expect(ban).toMatchObject({
      sourceId: "src1",
      market: "CASINO",
      category: "AD_BAN",
      sentiment: "NEGATIVE",
      relevanceScore: 9,
      countries: ["DE"],
      author: "SpinMaster_77",
      verified: false,
      language: "en",
      urlHash: urlHashOf(String(ban.url)),
    });
    expect(ban.tags).toEqual(["meta_ban", "platform:META", "risk:BAN"]);
    expect(platformRiskOfTags(ban.tags)).toEqual({ platform: "META", risk: "BAN" });
    expect((ban.rawTextPurgeAt as Date).getTime()).toBe(ANALYSTS_FIXTURE_NOW.getTime() + ANALYSTS_LIMITS.rawTextTtlMs);
    expect(String(ban.summary).length).toBeLessThanOrEqual(500);
    // Pays : ceux du classement, sinon ceux de la source.
    expect(k.entries().find((e) => String(e.url).includes("telegram-funnel"))!.countries).toEqual(["DE", "ES", "FR"]);
    // Alertes rendues pour Kevin : bannissement (BAN) et changement de règle (HIGH) ; la tendance à 9 est la même entrée.
    expect(res.alerts.map((a) => [a.kind, a.category, a.risk])).toEqual([
      ["compliance", "AD_BAN", "BAN"],
      ["compliance", "PLATFORM_CHANGE", "HIGH"],
    ]);
    expect(res.alerts[0]).toMatchObject({ sourceName: "BlackHatWorld — gambling", url: `${BHW}/threads/meta-killed-my-casino-ad-accounts-in-de.1500001/` });
    expect(k.source()).toMatchObject({ lastScrapedAt: ANALYSTS_FIXTURE_NOW, errorCount: 0, lastError: null });
    expect((k.source().nextScrapeAt as Date).getTime()).toBe(ANALYSTS_FIXTURE_NOW.getTime() + DAY);
  });

  it("aucun profil gardé : pseudonyme seulement, ni courriel, ni téléphone, ni lien de profil, ni « Prénom Nom »", async () => {
    const k = kit();
    await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    const all = JSON.stringify(k.entries());
    expect(all).not.toMatch(/\/members\/|spin\.master77@|7700 900123|Lukas Becker/);
    expect(k.entries().map((e) => e.author ?? "(aucun)").sort()).toEqual(["(aucun)", "CasaRoja", "ParisPro_FR", "SpinMaster_77"].sort());
    const cols = new Set(k.entries().flatMap((e) => Object.keys(e)));
    expect([...cols].some((c) => /profile|authorUrl|email|avatar/i.test(c))).toBe(false);
  });

  it("déduplication : second passage → rien de nouveau, aucun appel d'IA ; adresse normalisée", async () => {
    const k = kit();
    await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    const calls = k.llm.calls.length;
    k.c.advance(DAY);
    const again = await scrapeSource(k.deps, "src1", new Date(ANALYSTS_FIXTURE_NOW.getTime() + DAY));
    expect(again).toMatchObject({ ok: true, created: 0, duplicates: 4, belowThreshold: 1 });
    // L'entrée sous le seuil est relue (rien n'est gardé d'elle), les autres ne coûtent plus rien.
    expect(k.llm.calls.length - calls).toBe(1);
    expect(normalizeEntryUrl("https://WWW.Forum.example/t/1/?utm_source=x&b=2&a=1#frag")).toBe("https://forum.example/t/1?a=1&b=2");
    expect(normalizeEntryUrl("https://twitter.com/a/status/1")).toBe(normalizeEntryUrl("https://x.com/a/status/1"));
    expect(normalizeEntryUrl("https://t.me/s/canal/5")).toBe("https://t.me/canal/5");
  });

  it("seuil et nombre maximal réglables (Setting)", async () => {
    const k = kit({
      settings: [
        { key: "analysts.relevance_threshold", value: 9 },
        { key: "analysts.max_entries_per_scrape", value: 3 },
      ],
    });
    const res = await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    // La lecture s'arrête aussi à 3 contenus.
    expect(res).toMatchObject({ ok: true, read: 3, created: 1, belowThreshold: 2 });
    expect(k.entries().map((e) => e.relevanceScore)).toEqual([9]);
    // Rangement direct d'un lot plus grand : au-delà de 3 nouveaux contenus, rien n'est traité.
    const k2 = kit({ settings: [{ key: "analysts.max_entries_per_scrape", value: 3 }] });
    const items = Array.from({ length: 5 }, (_, i) => ({ url: `https://f.example/t/${i}`, title: `Fil ${i}`, text: "UGC selfie video ads", author: null, publishedAt: null, language: "en" }));
    const direct = await ingestEntries(k2.deps, k2.source() as unknown as WatchSource, items);
    expect(direct).toMatchObject({ read: 5, created: 3, overLimit: 2 });
  });

  it("plafond mensuel atteint : arrêt propre du lot, rien n'est appelé", async () => {
    const k = kit({ budget: 0 });
    const res = await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    expect(res).toMatchObject({ ok: true, created: 0, stoppedReason: "budget" });
    expect(k.llm.calls).toHaveLength(0);
  });
});

describe("erreurs d'une source", () => {
  it("5 échecs de suite → source désactivée, événement pour Kevin ; délai croissant entre les essais", async () => {
    const k = kit({ routes: { [`${BHW}/robots.txt`]: { body: "" }, [FORUM_URL]: { status: 500, body: "panne" } } });
    const delays: number[] = [];
    let last;
    for (let i = 1; i <= 5; i++) {
      const at = new Date(ANALYSTS_FIXTURE_NOW.getTime() + i * DAY);
      last = await scrapeSource(k.deps, "src1", at);
      if (last.ok || last.skipped) throw new Error("échec attendu");
      expect(last.errorCount).toBe(i);
      if (last.nextScrapeAt) delays.push(last.nextScrapeAt.getTime() - at.getTime());
    }
    expect(delays).toEqual([1, 2, 4, 8].map((h) => h * 3600_000));
    expect(last).toMatchObject({ disabled: true, nextScrapeAt: null, event: { type: "source_disabled", sourceId: "src1", name: "BlackHatWorld — gambling", errorCount: 5 } });
    expect(k.source()).toMatchObject({ isActive: false, errorCount: 5, lastError: "www.blackhatworld.com est en panne pour l'instant (code 500)." });
    // Source désactivée : plus rien n'est lu.
    expect(await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW)).toEqual({ ok: false, sourceId: "src1", skipped: "inactive" });
  });

  it("une réussite remet le compteur à zéro ; IA en panne sur tout le lot = échec de la source", async () => {
    const broken = scriptedLlm(() => {
      throw new Error("surcharge");
    });
    const k = kit({ llm: broken, source: { errorCount: 2 } });
    const res = await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    expect(res).toMatchObject({ ok: false, errorCount: 3, disabled: false });
    expect(k.source().lastError).toMatch(/^L'IA n'a pas répondu/);
    const ok = kit({ source: { errorCount: 4 } });
    await scrapeSource(ok.deps, "src1", ANALYSTS_FIXTURE_NOW);
    expect(ok.source().errorCount).toBe(0);
  });

  it("équipe coupée (`analysts.enabled` = false) ou source inconnue : rien n'est lu", async () => {
    const k = kit({ settings: [{ key: "analysts.enabled", value: false }] });
    expect(await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW)).toEqual({ ok: false, sourceId: "src1", skipped: "disabled_team" });
    expect(k.f.calls).toHaveLength(0);
    expect(await scrapeSource(kit().deps, "nope", ANALYSTS_FIXTURE_NOW)).toEqual({ ok: false, sourceId: "nope", skipped: "not_found" });
  });
});

describe("autres types de source par scrapeSource", () => {
  it("Reddit : listing JSON (25 posts), langue de la source", async () => {
    const url = "https://www.reddit.com/r/gambling/new.json?limit=25&raw_json=1";
    const k = kit({
      routes: { "https://www.reddit.com/robots.txt": { body: "" }, [url]: { body: readAnalystsFixture("reddit-gambling-new.json") } },
      source: { url: "https://www.reddit.com/r/gambling/", sourceType: "REDDIT", scrapeConfig: { limit: 25, intervalHours: 12 } },
    });
    const res = await scrapeSource(k.deps, "src1", ANALYSTS_FIXTURE_NOW);
    expect(res).toMatchObject({ ok: true, read: 5 });
    expect(k.f.calls.map((c) => c.url)).toContain(url);
    expect((k.source().nextScrapeAt as Date).getTime()).toBe(ANALYSTS_FIXTURE_NOW.getTime() + 12 * 3600_000);
  });
});

describe("purge et règles pures", () => {
  it("texte brut effacé après 7 jours, résumé et adresse gardés", async () => {
    const now = ANALYSTS_FIXTURE_NOW;
    const prisma = createFakePrisma({
      trendEntry: [
        { id: "e1", summary: "vieux", url: "https://a/1", rawText: "texte brut", rawTextPurgeAt: new Date(now.getTime() - 1000) },
        { id: "e2", summary: "récent", url: "https://a/2", rawText: "texte récent", rawTextPurgeAt: new Date(now.getTime() + DAY) },
        { id: "e3", summary: "déjà purgé", url: "https://a/3", rawText: null, rawTextPurgeAt: new Date(now.getTime() - DAY) },
      ],
    });
    expect(await purgeRawTexts({ prisma, enqueue, now: () => now }, now)).toEqual({ purged: 1 });
    const rows = prisma._tables.trendEntry!;
    expect(rows.map((r) => r.rawText)).toEqual([null, "texte récent", null]);
    expect(rows[0]).toMatchObject({ summary: "vieux", url: "https://a/1" });
    expect(await purgeRawTexts({ prisma, enqueue, now: () => now }, now)).toEqual({ purged: 0 });
  });

  it("alertes : bannissement / changement de règle au risque réglé, ou score ≥ 9", () => {
    expect(alertKindOf({ category: "AD_BAN", risk: "HIGH", relevanceScore: 5 })).toBe("compliance");
    expect(alertKindOf({ category: "AD_BAN", risk: "MEDIUM", relevanceScore: 5 })).toBeNull();
    expect(alertKindOf({ category: "AD_BAN", risk: "HIGH", relevanceScore: 5 }, "BAN")).toBeNull();
    expect(alertKindOf({ category: "REGULATION", risk: "BAN", relevanceScore: 6 })).toBeNull();
    expect(alertKindOf({ category: "MARKET_TREND", risk: null, relevanceScore: 9 })).toBe("viral");
  });
});
