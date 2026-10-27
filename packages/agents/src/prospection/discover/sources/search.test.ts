import { describe, expect, it } from "vitest";
import { discoverKit, readProspectionFixture } from "../testing";
import { candidatesFromTrendEntry, findAnalystsCandidates } from "./analysts";
import { findSocialCandidates } from "./social";
import { WEB_FORMS, buildQueries, findWebSearchCandidates } from "./web-search";

const results = (n: string) => (JSON.parse(readProspectionFixture(n)) as { results: Array<{ url: string; title: string; snippet: string }> }).results;
const no = { status: 404, body: "" };

describe("recherche web (source B)", () => {
  it("requêtes : gabarits versionnés × formes, 2 par langue, 4 langues au plus, pays ajouté sur demande", () => {
    const at = new Date("2026-10-27T02:00:00Z");
    const q = buildQueries({ source: "web_search", languages: ["fr", "it", "pl", "de", "es"], vertical: "SPORTS" }, WEB_FORMS, at);
    expect(q).toHaveLength(4 * 2 * 4);
    expect(new Set(q.map((x) => x.language))).toEqual(new Set(["fr", "it", "pl", "de"]));
    expect(q.filter((x) => x.query.endsWith("site:t.me"))).toHaveLength(8);
    const pl = buildQueries({ source: "web_search", languages: ["pl"], vertical: "CASINO", countries: ["PL"] }, ["{q} telegram"], at);
    expect(pl.every((x) => x.query.includes("Polska telegram"))).toBe(true);
    // Le lendemain, d'autres gabarits.
    const next = buildQueries({ source: "web_search", languages: ["fr"], vertical: "SPORTS" }, ["{q}"], new Date(at.getTime() + 86_400_000));
    expect(next.map((x) => x.query)).not.toEqual(buildQueries({ source: "web_search", languages: ["fr"], vertical: "SPORTS" }, ["{q}"], at).map((x) => x.query));
  });

  it("résultats : liens t.me de l'extrait, 1 page lue par résultat (robots.txt respecté), linktree fouillé", async () => {
    let served = false;
    const k = discoverKit({
      routes: {
        "https://www.exemple-pronos.fr/robots.txt": no,
        "https://www.exemple-pronos.fr/meilleurs-canaux-telegram": { body: readProspectionFixture("linked/blog-best-channels.html") },
        "https://linktr.ee/robots.txt": no,
        "https://linktr.ee/tipsterlucas": { body: readProspectionFixture("linked/linktree-tipster.html") },
        "https://interdit.exemple.com/robots.txt": { body: readProspectionFixture("directories/robots-deny-all.txt") },
      },
      search: (q) => (q.endsWith(" telegram") && !served ? ((served = true), results("search/web-fr-sports.json")) : []),
    });
    const r = await findWebSearchCandidates(k.deps, { source: "web_search", languages: ["fr"], vertical: "SPORTS" });
    expect(k.web.searches.length).toBe(8);
    expect([...new Set(r.candidates.map((c) => c.url))]).toEqual([
      "https://t.me/pronos_du_coin",
      "https://t.me/le_tipster_parisien",
      "https://t.me/+ZyXwVu987654",
      "https://t.me/petit_prono_fr",
      "https://t.me/tipster_lucas_vip",
      "https://t.me/tipster_lucas",
    ]);
    expect(r.candidates.every((c) => c.sourceType === "WEB_SEARCH" && c.language === "fr" && c.vertical === "SPORTS")).toBe(true);
    // La page t.me n'est jamais lue par la recherche, la page interdite par robots.txt non plus.
    expect(k.web.fetches.map((f) => f.url)).not.toContain("https://t.me/s/Petit_Prono_FR");
    expect(k.web.fetches.map((f) => f.url)).not.toContain("https://interdit.exemple.com/prive/liste");
    expect(r.errors.some((e) => e.includes("robots.txt"))).toBe(true);
    // Injection dans la page : « @tout_le_monde » n'est pas un lien t.me, rien n'en sort.
    expect(r.candidates.some((c) => c.url.includes("tout_le_monde"))).toBe(false);
  });
});

describe("réseaux sociaux (source C)", () => {
  it("site:tiktok.com … telegram, bio lue, page bloquée passée", async () => {
    const k = discoverKit({
      routes: {
        "https://www.tiktok.com/robots.txt": no,
        "https://www.tiktok.com/@casinomax.live": { body: readProspectionFixture("social/tiktok-profile.html") },
        "https://www.instagram.com/robots.txt": no,
        "https://www.instagram.com/p/bloque": { status: 429, body: "" },
      },
      search: (q) => (q.startsWith("site:tiktok.com") ? results("social/tiktok-fr-casino.json") : []),
    });
    const r = await findSocialCandidates(k.deps, { source: "social", languages: ["fr"], vertical: "CASINO" });
    expect(k.web.searches).toHaveLength(4);
    expect(k.web.searches.every((s) => s.endsWith(" telegram"))).toBe(true);
    expect([...new Set(r.candidates.map((c) => c.url))]).toEqual(["https://t.me/casinomax_live"]);
    expect(r.candidates[0]!.sourceType).toBe("SOCIAL");
    expect(r.errors.some((e) => e.includes("instagram"))).toBe(true);
  });
});

describe("pont avec les Analystes (source E)", () => {
  it("liens t.me des entrées de veille de la verticale, depuis le dernier passage", async () => {
    const entry = (id: string, p: Record<string, unknown>) => ({ id, sourceId: "s", market: "CASINO", language: "en", summary: "", summaryOriginal: null, rawText: null, title: null, url: `https://reddit.com/${id}`, createdAt: new Date("2026-10-26T10:00:00Z"), ...p });
    const k = discoverKit({
      seed: {
        trendEntry: [
          entry("a", { rawText: "My telegram channel 20k subs looking for offers: t.me/slots_kaiser" }),
          entry("b", { summary: "Canal présenté : https://t.me/s/Bonus_Casino_FR", language: "fr" }),
          entry("c", { market: "SPORTS", rawText: "t.me/foot_only" }),
          entry("d", { createdAt: new Date("2026-09-01T00:00:00Z"), rawText: "t.me/trop_vieux" }),
        ],
      },
    });
    const r = await findAnalystsCandidates(k.deps, { source: "analysts", languages: [], vertical: "CASINO" });
    expect(r.candidates.map((c) => [c.url, c.sourceType, c.sourceDetail, c.language])).toEqual([
      ["https://t.me/slots_kaiser", "ANALYSTS", "https://reddit.com/a", "en"],
      ["https://t.me/bonus_casino_fr", "ANALYSTS", "https://reddit.com/b", "fr"],
    ]);
    expect(k.web.fetches).toEqual([]);
    expect(candidatesFromTrendEntry({ url: "https://x.fr", title: null, summary: "t.me/winamax", summaryOriginal: null, rawText: null, language: "fr" }, "SPORTS")).toEqual([]);
  });
});
