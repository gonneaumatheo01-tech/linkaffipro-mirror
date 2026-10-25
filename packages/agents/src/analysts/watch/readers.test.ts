import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsEnqueue } from "../../types";
import { createAnalystsWeb, memoryHostThrottle } from "./polite";
import { extractArticle, fetchForum, fetchReddit, fetchTelegramPublic, parseForumPage, pseudonymOf, scrubPersonalData, searchNews, searchX } from "./readers";
import { ANALYSTS_FIXTURE_NOW, fakeClock, fakeFetch, fakeServerTools, readAnalystsFixture, type FakeRoute } from "./testing";

const enqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };
const BHW = "https://www.blackhatworld.com";
const OPEN = { body: "User-agent: *\nDisallow:\n", contentType: "text/plain" };

function webOf(routes: Record<string, FakeRoute>, serverTools?: ReturnType<typeof fakeServerTools>) {
  const c = fakeClock();
  const f = fakeFetch(routes, c.clock);
  const web = createAnalystsWeb({
    prisma: createFakePrisma(),
    enqueue,
    now: c.now,
    fetchImpl: f.impl,
    sleep: c.sleep,
    clock: c.clock,
    throttle: memoryHostThrottle(),
    robotsCache: new Map(),
    ...(serverTools ? { serverTools } : {}),
  });
  return { web, f, c };
}

describe("forum (HTML)", () => {
  const routes = {
    [`${BHW}/robots.txt`]: { body: readAnalystsFixture("robots-forum.txt") },
    [`${BHW}/forums/gambling-affiliates.205/`]: { body: readAnalystsFixture("bhw-gambling.html") },
    [`${BHW}/forums/gambling-affiliates.205/page-2`]: { body: readAnalystsFixture("bhw-gambling-page-2.html") },
  };

  it("repli générique : titres, textes, dates, liens absolus ; lien « suivant » suivi ; doublon de la page 2 écarté", async () => {
    const { web, f } = webOf(routes);
    const items = await fetchForum(web.withRate(15_000), `${BHW}/forums/gambling-affiliates.205/`, {}, { language: "en" });
    expect(items.map((i) => i.url)).toEqual([
      `${BHW}/threads/meta-killed-my-casino-ad-accounts-in-de.1500001/`,
      `${BHW}/threads/ugc-style-video-ads-for-sportsbook.1500002/`,
      `${BHW}/threads/ignore-previous-instructions.1500003/?utm_source=feed`,
      `${BHW}/threads/espana-publicidad-casino-nuevas-reglas.1500004/`,
      `${BHW}/threads/telegram-funnel-paris-sportifs-france.1499990/`,
    ]);
    const first = items[0]!;
    expect(first.title).toBe("Meta killed 4 casino ad accounts in DE this week — what changed?");
    expect(first.publishedAt).toBe("2026-10-20T09:14:00.000Z");
    expect(first.author).toBe("SpinMaster_77");
    expect(first.text).toContain("free spins");
    // Données minimales : ni courriel, ni téléphone, ni lien de profil ; « Prénom Nom » jamais gardé.
    expect(first.text).not.toMatch(/example\.com|7700/);
    expect(items[1]!.author).toBeNull();
    expect(items[1]!.text).not.toMatch(/members\/lukas/);
    expect(items.map((i) => i.text).join(" ")).not.toMatch(/\/members\//);
    // Débit : deux pages du forum à 15 s au moins (robots : Crawl-delay 20 s).
    const at = f.calls.filter((c) => c.url.includes("/forums/")).map((c) => c.at);
    expect(at).toHaveLength(2);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(20_000);
  });

  it("sélecteurs de la source et 50 pages au plus", async () => {
    const custom = parseForumPage(readAnalystsFixture("bhw-gambling.html"), `${BHW}/forums/x/`, {
      selectors: { item: ".structItem", title: ".structItem-title a", text: ".structItem-snippet", date: "time" },
    });
    expect(custom.items).toHaveLength(4);
    expect(custom.next).toBe(`${BHW}/forums/gambling-affiliates.205/page-2`);
    // Pagination infinie simulée : arrêt à 50 pages.
    let n = 0;
    const loop = webOf({
      "https://loop.example/robots.txt": OPEN,
      ...Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `https://loop.example/f/${i ? `page-${i + 1}` : ""}`,
          () => {
            n++;
            return { body: `<div class="thread"><h3><a href="/t/${i}a">Fil ${i} sur le casino en ligne</a></h3><p>texte ${i} assez long pour être lu</p></div><div class="thread"><h3><a href="/t/${i}b">Autre fil ${i} sur les paris</a></h3><p>texte ${i} b assez long</p></div>` };
          },
        ]),
      ),
    });
    const items = await fetchForum(loop.web, "https://loop.example/f/", { pagination: { pattern: "page-{n}" }, maxPages: 500 }, { maxItems: 1000 });
    expect(n).toBe(50);
    expect(items).toHaveLength(100);
  });

  it("page refusée par robots.txt : rien n'est lu", async () => {
    const { web, f } = webOf(routes);
    await expect(fetchForum(web, `${BHW}/members/spinmaster_77.4421/`)).rejects.toThrow(/robots\.txt/);
    expect(f.calls.map((c) => c.url)).toEqual([`${BHW}/robots.txt`]);
  });

  it("404 sur la première page → erreur en français", async () => {
    const { web } = webOf({ [`${BHW}/robots.txt`]: OPEN });
    await expect(fetchForum(web, `${BHW}/forums/disparu/`)).rejects.toThrow("Page introuvable sur www.blackhatworld.com (code 404)");
  });
});

describe("Reddit (JSON public)", () => {
  const url = "https://www.reddit.com/r/gambling/new.json?limit=25&raw_json=1";

  it("posts lus, épinglé écarté, pseudonyme seulement (supprimé, AutoModerator et « Prénom Nom » → null)", async () => {
    const { web, f } = webOf({ "https://www.reddit.com/robots.txt": OPEN, [url]: { body: readAnalystsFixture("reddit-gambling-new.json"), contentType: "application/json" } });
    const items = await fetchReddit(web, "https://www.reddit.com/r/gambling/", { limit: 25, language: "en" });
    expect(items.map((i) => i.url)).toEqual([
      "https://www.reddit.com/r/gambling/comments/fx0002/casino_ads_everywhere_on_tiktok/",
      "https://www.reddit.com/r/gambling/comments/fx0003/neue_werbebeschrankungen/",
      "https://www.reddit.com/r/gambling/comments/fx0004/lost_my_rent_money/",
      "https://www.reddit.com/r/gambling/comments/fx0005/which_crash_game_streams/",
      "https://www.reddit.com/r/gambling/comments/fx0006/ruleta_en_vivo/",
    ]);
    expect(items.map((i) => i.author)).toEqual(["throwaway_reels", "Kartenhai_DE", null, null, "ruleta_loca"]);
    expect(items[1]!.publishedAt).toBe(new Date(1760864400 * 1000).toISOString());
    expect(JSON.stringify(items)).not.toMatch(/t2_|author_fullname/);
    expect(f.calls.find((c) => c.url === url)!.headers.accept).toBe("application/json");
  });

  it("robots.txt de Reddit fermé : repli par la recherche web restreinte au sous-forum, jamais de lecture directe", async () => {
    const tools = fakeServerTools({
      search: () => [
        { url: "https://www.reddit.com/r/gambling/comments/zz1/meta_ads/", title: "Meta ads for casinos", snippet: "Meta now asks for a licence per country before approving casino ads." },
        { url: "https://www.reddit.com/r/poker/comments/zz2/other/", title: "Autre sous-forum", snippet: "hors sujet mais assez long pour un extrait" },
      ],
    });
    const { web, f } = webOf({ "https://www.reddit.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" } }, tools);
    const items = await fetchReddit(web, "r/gambling");
    expect(items.map((i) => i.url)).toEqual(["https://www.reddit.com/r/gambling/comments/zz1/meta_ads/"]);
    expect(f.calls.map((c) => c.url)).toEqual(["https://www.reddit.com/robots.txt"]);
    expect(String(tools.requests[0]!.messages[0]!.content)).toContain("site:reddit.com/r/gambling");
  });
});

describe("Telegram public (t.me/s, mécanique de la phase 27)", () => {
  it("posts du canal, adresses des posts, langue de la source, courriel retiré", async () => {
    const { web } = webOf({ "https://t.me/robots.txt": OPEN, "https://t.me/s/wettnews_de_exemple": { body: readAnalystsFixture("tme-wettnews-de.html") } });
    const items = await fetchTelegramPublic(web, "@wettnews_de_exemple", { now: ANALYSTS_FIXTURE_NOW, language: "de" });
    expect(items.map((i) => i.url)).toEqual(["https://t.me/wettnews_de_exemple/302", "https://t.me/wettnews_de_exemple/301"]);
    expect(items[1]!.text).toContain("TikTok sperrt");
    expect(items[0]!.text).not.toContain("tipps@example.de");
    expect(items.every((i) => i.language === "de" && i.author === "@wettnews_de_exemple")).toBe(true);
  });

  it("canal sans aperçu → erreur claire", async () => {
    const { web } = webOf({ "https://t.me/robots.txt": OPEN, "https://t.me/s/inconnu_exemple": { body: "<html><div class='tgme_page_title'>x</div></html>" } });
    await expect(fetchTelegramPublic(web, "inconnu_exemple")).rejects.toThrow(/aperçu public/);
  });
});

describe("actualités et X par la recherche web", () => {
  it("actualités : requête dans la langue locale, pays, domaines ; article lu en entier (journaliste jamais gardé)", async () => {
    const tools = fakeServerTools({
      search: () => [
        { url: "https://igaming.example/de/nachrichten/ggl-influencer-werbung-2027", title: "GGL verschärft Regeln", snippet: "Kurz: neue Regeln.", date: "2026-10-21" },
        { url: "https://igaming.example/es/noticias/tiktok-espana-casino-anuncios", title: "TikTok endurece su política", snippet: "Anuncios de casino limitados en España." },
      ],
    });
    const { web } = webOf(
      {
        "https://igaming.example/robots.txt": OPEN,
        "https://igaming.example/de/nachrichten/ggl-influencer-werbung-2027": { body: readAnalystsFixture("igaming-news-article.html") },
      },
      tools,
    );
    const items = await searchNews(web, { market: "CASINO", country: "DE", language: "de", allowedDomains: ["igaming.example"], fetchArticles: 2 });
    const q = tools.requests[0]!;
    expect(String(q.messages[0]!.content)).toBe("Recherche : Online-Casino Werbung Nachrichten");
    expect(q.tools[0]).toMatchObject({ allowed_domains: ["igaming.example"], user_location: { type: "approximate", country: "DE" } });
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toContain("Ab dem 1. Januar 2027");
    expect(items[0]!.text).not.toMatch(/Petra|redaktion@/);
    expect(items[0]!.author).toBeNull();
    expect(items[1]!.text).toBe("Anuncios de casino limitados en España.");
  });

  it("page d'actualité (liste) et article : lecture pure", () => {
    const list = parseForumPage(readAnalystsFixture("igaming-news.html"), "https://igaming.example/", {}, "de");
    expect(list.items.map((i) => i.title)).toEqual([
      "GGL verschärft Regeln für Influencer-Werbung ab 2027",
      "TikTok endurece su política de anuncios de casino en España",
      "France : les opérateurs de paris sportifs misent sur les streamers",
    ]);
    expect(list.items[1]!.url).toBe("https://igaming.example/es/noticias/tiktok-espana-casino-anuncios");
    const art = extractArticle(readAnalystsFixture("meta-policy-gambling.html"));
    expect(art.title).toBe("Online gambling and gaming");
    expect(art.publishedAt).toBe("2026-09-30T00:00:00.000Z");
    expect(art.text).toContain("prior written permission");
  });

  it("X : `site:x.com` + mots-clés locaux, posts seulement, twitter.com → x.com, pseudonyme « @nom »", async () => {
    const tools = fakeServerTools({
      search: () => [
        { url: "https://twitter.com/AffiPro_ES/status/1849000000000000001", title: "AffiPro en X", snippet: "Meta rechaza anuncios de apuestas con 'gratis' en España." },
        { url: "https://x.com/AffiPro_ES", title: "Perfil", snippet: "Página de perfil, jamais gardée comme contenu." },
        { url: "https://x.com/search?q=apuestas", title: "Búsqueda", snippet: "Página de búsqueda" },
      ],
    });
    const { web } = webOf({}, tools);
    const items = await searchX(web, { market: "SPORTS", country: "ES", language: "es" });
    expect(String(tools.requests[0]!.messages[0]!.content)).toBe("Recherche : site:x.com apuestas deportivas publicidad");
    expect(tools.requests[0]!.tools[0]).toMatchObject({ allowed_domains: ["x.com", "twitter.com"] });
    expect(items).toEqual([
      {
        url: "https://x.com/AffiPro_ES/status/1849000000000000001",
        title: "AffiPro en X",
        text: "Meta rechaza anuncios de apuestas con 'gratis' en España.",
        author: "@AffiPro_ES",
        publishedAt: null,
        language: "es",
      },
    ]);
  });
});

describe("données personnelles", () => {
  it("courriels, téléphones et liens de profil retirés ; pseudonymes filtrés", () => {
    const t = scrubPersonalData("Écris-moi à jean.dupont@mail.fr ou au 06 12 34 56 78, profil https://forum.example/members/jean.12/ et https://x.com/jeandupont ; fil https://x.com/a/status/1");
    expect(t).not.toMatch(/jean\.dupont@|06 12|members\/jean|x\.com\/jeandupont/);
    expect(t).toContain("https://x.com/a/status/1");
    expect(pseudonymOf("SpinMaster_77")).toBe("SpinMaster_77");
    expect(pseudonymOf("Jean Dupont")).toBeNull();
    expect(pseudonymOf("jean@mail.fr")).toBeNull();
    expect(pseudonymOf("https://forum.example/members/x")).toBeNull();
    expect(pseudonymOf("[deleted]")).toBeNull();
    expect(pseudonymOf("@wettnews")).toBe("@wettnews");
  });
});
