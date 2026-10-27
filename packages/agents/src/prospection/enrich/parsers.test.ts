import { describe, expect, it } from "vitest";
import { memoryHostThrottle } from "../../analysts/watch/polite";
import { fakeClock } from "../../analysts/watch/testing";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { ProspectPost } from "../contract";
import { computeMetrics, coefficientOfVariation } from "./metrics";
import { fetchChannelPage, parseAudienceCount, parseChannelPage } from "./page";
import { parseProspectPreview, readProspectPosts, tmeUsernameOf } from "./posts";
import { ENRICH_FIXTURE_NOW, fixtureWeb, readEnrichFixture } from "./testing";

const enqueue = { async orchestrator() {}, async step() {} };
function deps(web = fixtureWeb()) {
  const c = fakeClock(ENRICH_FIXTURE_NOW);
  return { c, web, deps: { prisma: createFakePrisma(), enqueue, now: c.now, clock: c.clock, sleep: c.sleep, web, throttle: memoryHostThrottle() } };
}

describe("page publique t.me/<nom>", () => {
  it("nombre d'abonnés exact, arrondi, membres", () => {
    expect(parseAudienceCount("9 242 552 subscribers")).toEqual({ count: 9242552, exact: true, kind: "CHANNEL" });
    expect(parseAudienceCount("12,345 subscribers")).toEqual({ count: 12345, exact: true, kind: "CHANNEL" });
    expect(parseAudienceCount("12.3K subscribers")).toEqual({ count: 12300, exact: false, kind: "CHANNEL" });
    expect(parseAudienceCount("9 839 members, 520 online")).toEqual({ count: 9839, exact: true, kind: "GROUP" });
    expect(parseAudienceCount("@someone")).toBeNull();
  });

  it("canal 17k avec description, contact et aperçu", () => {
    const p = parseChannelPage(readEnrichFixture("tme/pronos_maxime.html"));
    expect(p).toMatchObject({ ok: true, title: "Pronos Maxime ⚽🎾", subscribers: 17345, kind: "CHANNEL", hasPreview: true });
    if (p.ok) expect(p.description).toContain("Pub : @maxime_pub");
  });

  it("canal sans aperçu, groupe, abonnés arrondis, page introuvable", () => {
    expect(parseChannelPage(readEnrichFixture("tme/no_preview_bets.html"))).toMatchObject({ ok: true, hasPreview: false, subscribers: 6230 });
    expect(parseChannelPage(readEnrichFixture("tme/groupe_paris_fr.html"))).toMatchObject({ ok: true, kind: "GROUP", subscribers: 5120, hasPreview: false });
    expect(parseChannelPage(readEnrichFixture("tme/slots_kaiser.html"))).toMatchObject({ ok: true, subscribers: 12400 });
    expect(parseChannelPage(readEnrichFixture("tme/canal_introuvable.html"))).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("lecture par la lecture polie ; 404 → introuvable ; panne → erreur", async () => {
    const k = deps();
    expect(await fetchChannelPage(k.deps, "pronos_maxime")).toMatchObject({ ok: true });
    expect(await fetchChannelPage(k.deps, "absent_total")).toMatchObject({ ok: false, reason: "not_found" });
    const down = deps(fixtureWeb({ "https://t.me/pronos_maxime": { status: 502, body: "" } }));
    expect(await fetchChannelPage(down.deps, "pronos_maxime")).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("aperçu t.me/s", () => {
  it("transferts, réactions, commentaires, boutons, signature, liens, mentions", () => {
    const parsed = parseProspectPreview(readEnrichFixture("tme-s/pronos_maxime.html"), "pronos_maxime");
    expect(parsed.posts).toHaveLength(20);
    expect(parsed.subscribersShown).toBe(17300);
    expect(parsed.description).toContain("MAXPRONO");
    const fwd = parsed.posts.find((p) => p.forwardedFrom);
    expect(fwd?.forwardedFrom).toBe("lequipe_paris");
    const own = parsed.posts.find((p) => p.id === 340)!;
    expect(own.signature).toBe("Maxime");
    expect(own.reactions).toBeGreaterThan(40);
    expect(own.comments).toBeGreaterThanOrEqual(5);
    expect(own.buttons[0]).toEqual({ text: "🎁 Bonus 1xbet", url: "https://1xbet.com/fr/registration?tag=d_4567m" });
    expect(own.links).toContain("https://1xbet.com/fr?tag=d_4567m_maxprono");
    const mention = parsed.posts.find((p) => p.mentions.includes("tennis_pronos_fr"));
    expect(mention).toBeTruthy();
    // Le canal lui-même n'est jamais une mention ; hashtags ignorés.
    expect(parsed.posts.every((p) => !p.mentions.includes("pronos_maxime"))).toBe(true);
  });

  it("origine cachée d'un transfert", () => {
    const parsed = parseProspectPreview(readEnrichFixture("tme-s/repost_tips_all.html"), "repost_tips_all");
    expect(parsed.posts.every((p) => p.forwardedFrom !== null)).toBe(true);
    expect(parsed.posts.some((p) => p.forwardedFrom === "Tips Hidden")).toBe(true);
  });

  it("adresses t.me → nom public", () => {
    expect(tmeUsernameOf("https://t.me/s/Calcio_VIP_Club")).toBe("calcio_vip_club");
    expect(tmeUsernameOf("https://t.me/foo_bar/123")).toBe("foo_bar");
    expect(tmeUsernameOf("https://t.me/+AbCdEf")).toBeNull();
    expect(tmeUsernameOf("https://t.me/joinchat/xyz")).toBeNull();
    expect(tmeUsernameOf("https://t.me/addlist/abc")).toBeNull();
  });

  it("lecteur de la phase 27 réutilisé : 2 pages par ?before=, rythme de 3 s", async () => {
    const k = deps();
    const r = await readProspectPosts(k.deps, "pronos_maxime");
    if (!r.ok) throw new Error(r.message);
    expect(r.posts).toHaveLength(40);
    expect(r.pages).toBe(2);
    expect(k.web.calls).toEqual(["https://t.me/s/pronos_maxime", "https://t.me/s/pronos_maxime?before=321"]);
    expect(r.posts[0]!.id).toBe(340);
    expect(r.posts[0]!.signature).toBe("Maxime");
    expect(k.c.sleeps.every((ms) => ms >= 3000)).toBe(true);
  });

  it("aperçu fermé (redirection) → private", async () => {
    const k = deps();
    const r = await readProspectPosts(k.deps, "no_preview_bets");
    expect(r).toMatchObject({ ok: false, reason: "private" });
  });
});

const post = (over: Partial<ProspectPost> & { id: number; daysAgo: number }): ProspectPost => ({
  postedAt: new Date(ENRICH_FIXTURE_NOW.getTime() - over.daysAgo * 86_400_000),
  text: "texte",
  mediaKind: "text",
  views: 1000,
  forwardedFrom: null,
  comments: null,
  reactions: null,
  buttons: [],
  signature: null,
  links: [],
  mentions: [],
  ...over,
});

describe("mesures", () => {
  it("rythme, médiane, moyenne, taux de vue, variance, transferts, réactions, liens, heures de Paris", () => {
    const posts = [
      post({ id: 5, daysAgo: 1, views: 1000, reactions: 20, links: ["https://1xbet.com/?tag=1"] }),
      post({ id: 4, daysAgo: 3, views: 2000, reactions: 40 }),
      post({ id: 3, daysAgo: 10, views: 3000, forwardedFrom: "autre", comments: 6 }),
      post({ id: 2, daysAgo: 20, views: 4000, links: ["https://t.me/x"] }),
      post({ id: 1, daysAgo: 40, views: 99_999 }),
    ];
    const m = computeMetrics(posts, 10_000, ENRICH_FIXTURE_NOW);
    expect(m.posts30d).toBe(4);
    expect(m.postsPerDay).toBeCloseTo(4 / 30, 3);
    expect(m.medianViews).toBe(2500);
    expect(m.avgViews).toBe(2500);
    expect(m.viewRate).toBe(0.25);
    expect(m.forwardRatio).toBe(0.25);
    expect(m.reactionRate).toBeCloseTo(60 / 3000, 5);
    expect(m.commentRate).toBeCloseTo(6 / 3000, 5);
    expect(m.linkDensity).toBe(0.25);
    expect(m.postingHours).toHaveLength(24);
    expect(m.postingHours!.reduce((a, b) => a + b, 0)).toBe(4);
    // 09:00 UTC = 10:00 à Paris en heure d'hiver (depuis le 25 octobre), 11:00 avant.
    expect(m.postingHours![10]).toBe(1);
    expect(m.postingHours![11]).toBe(3);
    expect(m.lastPostAt?.toISOString()).toBe(posts[0]!.postedAt.toISOString());
    expect(m.firstSeenPostAt?.toISOString()).toBe(posts[4]!.postedAt.toISOString());
  });

  it("réactions invisibles → null ; aucun post → tout null", () => {
    const m = computeMetrics([post({ id: 1, daysAgo: 1 })], null, ENRICH_FIXTURE_NOW);
    expect(m.reactionRate).toBeNull();
    expect(m.viewRate).toBeNull();
    expect(computeMetrics([], 100, ENRICH_FIXTURE_NOW)).toMatchObject({ postCount: 0, medianViews: null, postsPerDay: null });
  });

  it("lecture coupée à 100 posts : rythme sur la durée couverte", () => {
    const posts = Array.from({ length: 100 }, (_, i) => post({ id: 100 - i, daysAgo: i * 0.1 }));
    expect(computeMetrics(posts, 1000, ENRICH_FIXTURE_NOW).postsPerDay).toBeGreaterThan(9);
  });

  it("coefficient de variation", () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([1])).toBeNull();
    expect(coefficientOfVariation([50, 150])).toBeCloseTo(0.5, 5);
  });
});
