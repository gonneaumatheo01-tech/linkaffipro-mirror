import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsEnqueue } from "../../types";
import { ANALYSTS_TEAM_KEY } from "../contract";
import { ANALYSTS_USER_AGENT, createAnalystsWeb, looksLikeBotWall, memoryHostThrottle, parseRobots, PoliteFetchError, robotsAllows } from "./polite";
import { serverWebSearch } from "./server-tools";
import { fakeClock, fakeFetch, fakeServerTools, readAnalystsFixture } from "./testing";

const enqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };
const FORUM = "https://forum.example";

function kit(routes: Parameters<typeof fakeFetch>[0], extra: { serverTools?: ReturnType<typeof fakeServerTools> } = {}) {
  const c = fakeClock();
  const f = fakeFetch(routes, c.clock);
  const prisma = createFakePrisma();
  const deps = { prisma, enqueue, now: c.now, fetchImpl: f.impl, sleep: c.sleep, clock: c.clock, throttle: memoryHostThrottle(), robotsCache: new Map(), ...extra };
  return { c, f, prisma, web: createAnalystsWeb(deps), deps };
}

describe("robots.txt", () => {
  it("analyse : groupe `*`, plus long motif gagnant, Allow à égalité, Crawl-delay, groupe nommé", () => {
    const p = parseRobots(readAnalystsFixture("robots-forum.txt"));
    expect(p.crawlDelayMs).toBe(20_000);
    expect(robotsAllows(p, "/forums/gambling.205/")).toBe(true);
    expect(robotsAllows(p, "/members/spin.1/")).toBe(false);
    expect(robotsAllows(p, "/search/?q=casino")).toBe(false);
    expect(robotsAllows(p, "/threads/x.1/")).toBe(true);
    const named = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: LinkAffiProBot\nAllow: /\nDisallow: /private\n");
    expect(robotsAllows(named, "/forums/")).toBe(true);
    expect(robotsAllows(named, "/private/x")).toBe(false);
    const wild = parseRobots("User-agent: *\nDisallow: /*.json$\nAllow: /api/public*\n");
    expect(robotsAllows(wild, "/r/x/new.json")).toBe(false);
    expect(robotsAllows(wild, "/r/x/new.json?limit=5")).toBe(true);
  });

  it("chemin interdit : aucune requête vers la page, erreur claire ; robots lu une seule fois (cache 24 h)", async () => {
    const k = kit({ [`${FORUM}/robots.txt`]: { body: readAnalystsFixture("robots-forum.txt"), contentType: "text/plain" }, [`${FORUM}/forums/a/`]: { body: "<p>ok</p>" } });
    await expect(k.web.fetchText(`${FORUM}/members/spinmaster.1/`)).rejects.toBeInstanceOf(PoliteFetchError);
    await expect(k.web.fetchText(`${FORUM}/search/?q=x`)).rejects.toThrow(/robots\.txt/);
    expect(k.f.calls.map((c) => c.url)).toEqual([`${FORUM}/robots.txt`]);
    await k.web.fetchText(`${FORUM}/forums/a/`);
    expect(k.f.calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(1);
    // Agent utilisateur honnête, aucun cookie.
    expect(k.f.calls.every((c) => c.headers["user-agent"] === ANALYSTS_USER_AGENT && !c.headers.cookie)).toBe(true);
  });

  it("robots.txt absent (404) : tout permis ; injoignable (500) : rien pour l'instant", async () => {
    const ok = kit({ [`${FORUM}/page`]: { body: "<p>bonjour</p>" } });
    expect((await ok.web.fetchText(`${FORUM}/page`)).status).toBe(200);
    const down = kit({ [`${FORUM}/robots.txt`]: { status: 500, body: "" }, [`${FORUM}/page`]: { body: "<p>bonjour</p>" } });
    await expect(down.web.fetchText(`${FORUM}/page`)).rejects.toThrow(/robots/);
  });

  it("aucune connexion à un compte : adresse avec identifiants refusée", async () => {
    const k = kit({});
    await expect(k.web.fetchText("https://user:pass@forum.example/")).rejects.toThrow(/aucune connexion/);
  });
});

describe("débit par hôte", () => {
  it("une requête toutes les 15 s pour un forum, Crawl-delay plus long respecté, hôtes indépendants", async () => {
    const routes = {
      [`${FORUM}/robots.txt`]: { body: "User-agent: *\nDisallow:\n", contentType: "text/plain" },
      [`${FORUM}/p1`]: { body: "<p>1</p>" },
      [`${FORUM}/p2`]: { body: "<p>2</p>" },
      [`${FORUM}/p3`]: { body: "<p>3</p>" },
      "https://slow.example/robots.txt": { body: readAnalystsFixture("robots-forum.txt") },
      "https://slow.example/forums/1": { body: "<p>1</p>" },
      "https://slow.example/forums/2": { body: "<p>2</p>" },
    };
    const k = kit(routes);
    const forum = k.web.withRate(15_000);
    for (const p of ["p1", "p2", "p3"]) await forum.fetchText(`${FORUM}/${p}`);
    const at = k.f.calls.filter((c) => c.url.startsWith(FORUM)).map((c) => c.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(15_000);
    // Crawl-delay: 20 du site lent > 10 s par défaut.
    await k.web.fetchText("https://slow.example/forums/1");
    await k.web.fetchText("https://slow.example/forums/2");
    const slow = k.f.calls.filter((c) => c.url.startsWith("https://slow.example/forums/")).map((c) => c.at);
    expect(slow[1]! - slow[0]!).toBeGreaterThanOrEqual(20_000);
  });

  it("t.me : 3 s par défaut ; autres sites : 10 s par défaut", async () => {
    const k = kit({
      "https://t.me/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://t.me/s/a": { body: "a" },
      "https://t.me/s/b": { body: "b" },
      "https://news.example/robots.txt": { body: "User-agent: *\nDisallow:\n" },
      "https://news.example/a": { body: "a" },
      "https://news.example/b": { body: "b" },
    });
    for (const u of ["https://t.me/s/a", "https://t.me/s/b", "https://news.example/a", "https://news.example/b"]) await k.web.fetchText(u);
    const at = (p: string) => k.f.calls.filter((c) => c.url.startsWith(p) && !c.url.endsWith("robots.txt")).map((c) => c.at);
    const t = at("https://t.me/s/");
    const n = at("https://news.example/");
    expect(t[1]! - t[0]!).toBeGreaterThanOrEqual(3_000);
    expect(t[1]! - t[0]!).toBeLessThan(10_000);
    expect(n[1]! - n[0]!).toBeGreaterThanOrEqual(10_000);
  });
});

describe("repli par l'outil web_fetch de l'API", () => {
  it("403 → page lue par web_fetch (Sonnet), dépense comptée dans l'équipe analystes", async () => {
    const tools = fakeServerTools({ fetch: (url) => (url === `${FORUM}/forums/x/` ? "Titre du fil\nTexte lu par l'outil" : { error_code: "url_not_accessible" }) });
    const k = kit({ [`${FORUM}/robots.txt`]: { body: "User-agent: *\nDisallow:\n" }, [`${FORUM}/forums/x/`]: { status: 403, body: "Forbidden" } }, { serverTools: tools });
    const res = await k.web.fetchText(`${FORUM}/forums/x/`);
    expect(res).toEqual({ status: 200, body: "Titre du fil\nTexte lu par l'outil", finalUrl: `${FORUM}/forums/x/` });
    const req = tools.requests[0]!;
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.tools).toEqual([{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, allowed_domains: ["forum.example"], citations: { enabled: true }, max_content_tokens: 20_000 }]);
    expect(JSON.stringify(req)).not.toMatch(/code_execution/);
    expect(String(req.messages[0]!.content)).toContain(`${FORUM}/forums/x/`);
    const usage = k.prisma._tables.agentUsage!;
    expect(usage[0]).toMatchObject({ teamKey: ANALYSTS_TEAM_KEY, provider: "web", calls: 1 });
    expect(usage[0]!.cents as number).toBeGreaterThan(0);
  });

  it("page anti-robot (défi) → repli ; sans outils serveur, la réponse brute reste (jamais de contournement)", async () => {
    const wall = "<html><head><title>Just a moment...</title></head><body><div id='challenge-platform'></div></body></html>";
    expect(looksLikeBotWall(200, wall)).toBe(true);
    expect(looksLikeBotWall(200, "<p>forum normal</p>")).toBe(false);
    const k = kit({ [`${FORUM}/robots.txt`]: { body: "" }, [`${FORUM}/t`]: { body: wall } });
    expect((await k.web.fetchText(`${FORUM}/t`)).body).toBe(wall);
    const tools = fakeServerTools({ fetch: () => "contenu" });
    const k2 = kit({ [`${FORUM}/robots.txt`]: { body: "" }, [`${FORUM}/t`]: { body: wall } }, { serverTools: tools });
    expect((await k2.web.fetchText(`${FORUM}/t`)).body).toBe("contenu");
  });

  it("erreur de l'outil (url_not_accessible) → message en français", async () => {
    const tools = fakeServerTools({ fetch: () => ({ error_code: "url_not_accessible" }) });
    const k = kit({ [`${FORUM}/robots.txt`]: { body: "" }, [`${FORUM}/t`]: { status: 429, body: "" } }, { serverTools: tools });
    await expect(k.web.fetchText(`${FORUM}/t`)).rejects.toThrow("Lecture de repli impossible : la page n'est pas accessible.");
  });
});

describe("recherche web (outil web_search)", () => {
  it("résultats normalisés et sourcés : seules les adresses réellement rendues, extrait et date ; pays et domaines transmis", async () => {
    const tools = fakeServerTools({
      search: () => [
        { url: "https://igaming.example/de/ggl#top", title: "GGL verschärft Regeln", page_age: "2026-10-21", snippet: "Neue Leitlinien für Influencer." },
        { url: "https://igaming.example/es/tiktok", title: "TikTok endurece", page_age: "hace 3 días" },
        { url: "javascript:alert(1)", title: "piège" },
      ],
    });
    const deps = { prisma: createFakePrisma(), enqueue, now: () => new Date("2026-10-24T12:00:00Z"), serverTools: tools };
    const hits = await serverWebSearch(deps, { query: "Online-Casino Werbung Nachrichten", allowedDomains: ["https://igaming.example/"], country: "de", maxUses: 9 });
    expect(hits).toEqual([
      { url: "https://igaming.example/de/ggl", title: "GGL verschärft Regeln", snippet: "Neue Leitlinien für Influencer.", date: "2026-10-21T00:00:00.000Z" },
      { url: "https://igaming.example/es/tiktok", title: "TikTok endurece", snippet: "", date: null },
    ]);
    expect(tools.requests[0]!.tools[0]).toEqual({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 5,
      allowed_domains: ["igaming.example"],
      user_location: { type: "approximate", country: "DE" },
    });
    expect(tools.requests[0]!.model).toBe("claude-sonnet-5-5");
  });

  it("reprise sur pause_turn, puis résultats", async () => {
    const tools = fakeServerTools({ pauseFirst: true, search: () => [{ url: "https://a.example/1", title: "A", snippet: "texte" }] });
    const deps = { prisma: createFakePrisma(), enqueue, serverTools: tools };
    const hits = await serverWebSearch(deps, { query: "casino" });
    expect(hits.map((h) => h.url)).toEqual(["https://a.example/1"]);
    expect(tools.requests).toHaveLength(2);
    expect(tools.requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("erreur de recherche (objet error_code) → message clair ; plafond atteint → aucun appel", async () => {
    const tools = fakeServerTools({ search: () => ({ error_code: "too_many_requests" }) });
    const prisma = createFakePrisma();
    await expect(serverWebSearch({ prisma, enqueue, serverTools: tools }, { query: "x" })).rejects.toThrow(/trop de recherches/);
    const capped = fakeServerTools({ search: () => [] });
    await expect(serverWebSearch({ prisma, enqueue, serverTools: capped, monthlyBudgetCents: 0 }, { query: "x" })).rejects.toThrow(/Plafond mensuel/);
    expect(capped.requests).toHaveLength(0);
  });
});
