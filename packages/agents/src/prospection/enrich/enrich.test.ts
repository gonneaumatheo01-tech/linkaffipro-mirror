import { describe, expect, it } from "vitest";
import { memoryHostThrottle } from "../../analysts/watch/polite";
import { fakeClock } from "../../analysts/watch/testing";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { ProspectionQueueJob, ProspectPost } from "../contract";
import { enrichProspect, NO_PREVIEW_REASON, copiesPostText } from "./enrich";
import { readProspectPosts } from "./posts";
import { ENRICH_FIXTURE_CHANNELS, ENRICH_FIXTURE_NOW, fakeProspectionLlm, fixtureWeb, readEnrichFixture } from "./testing";

const enqueue = { async orchestrator() {}, async step() {} };

function prospectRow(username: string | null, over: Record<string, unknown> = {}) {
  return {
    id: `p_${username ?? "invite"}`,
    username,
    channelUrl: username ? `https://t.me/${username}` : "https://t.me/+AbCdEfGh",
    kind: "CHANNEL",
    title: "",
    status: "DISCOVERED",
    region: "UNKNOWN",
    vertical: "OTHER",
    contactConfidence: "NONE",
    sourceType: "DIRECTORY",
    graphDepth: 3,
    cocitationCount: 0,
    enrichAttempts: 0,
    nextEnrichAt: null,
    monetization: null,
    discoveredAt: ENRICH_FIXTURE_NOW,
    ...over,
  };
}

function kit(opts: { llm?: ReturnType<typeof fakeProspectionLlm>; web?: ReturnType<typeof fixtureWeb>; rows?: Array<Record<string, unknown>>; settings?: Array<{ key: string; value: unknown }> } = {}) {
  const c = fakeClock(ENRICH_FIXTURE_NOW);
  const rows = opts.rows ?? [...ENRICH_FIXTURE_CHANNELS.map((n) => prospectRow(n)), prospectRow(null)];
  // Profondeur maximale du graphe atteinte (3) : les tests de l'Enrichisseur n'étendent pas le graphe du Sourceur.
  const prisma = createFakePrisma({ prospect: rows, setting: opts.settings ?? [], affiliateOffer: [] });
  const jobs: Array<{ job: ProspectionQueueJob; opts?: { jobId?: string; delayMs?: number } }> = [];
  const llm = opts.llm ?? fakeProspectionLlm();
  const web = opts.web ?? fixtureWeb();
  const deps = {
    prisma,
    enqueue,
    now: c.now,
    clock: c.clock,
    sleep: c.sleep,
    web,
    throttle: memoryHostThrottle(),
    robotsCache: new Map(),
    prospectionLlm: llm,
    prospection: { enqueue: async (job: ProspectionQueueJob, o?: { jobId?: string; delayMs?: number }) => void jobs.push({ job, opts: o }) },
  };
  const row = (name: string | null) => (prisma._tables.prospect ?? []).find((r) => r.username === name)!;
  return { c, prisma, deps, jobs, llm, web, row, contacts: (id: string) => (prisma._tables.prospectContact ?? []).filter((r) => r.prospectId === id), events: (id: string) => (prisma._tables.prospectEvent ?? []).filter((r) => r.prospectId === id) };
}

describe("Enrichisseur de bout en bout sur les fixtures (aucun réseau)", () => {
  it("canal FR réel : mesures, langue, pays, marques, contacts, score enfilé", async () => {
    const k = kit();
    const out = await enrichProspect(k.deps, "p_pronos_maxime");
    expect(out).toEqual({ status: "ENRICHING", reason: null, scoreQueued: true });
    const r = k.row("pronos_maxime");
    expect(r).toMatchObject({ subscribers: 17345, kind: "CHANNEL", language: "fr", region: "EU", vertical: "SPORTS", contentType: "tips_free", authenticity: "REAL", competitiveState: "ROTATING", hasCompetitor: true, contactConfidence: "HIGH", bestContact: "@maxime_pub", regulatoryFlag: null });
    expect((r.countries as string[])[0]).toBe("FR");
    expect(r.medianViews).toBeGreaterThan(1500);
    expect(r.viewRate).toBeGreaterThan(0.08);
    expect(r.fakeFlags).toEqual([]);
    expect((r.brands as Array<{ brand: string; promoCode: string | null }>).map((b) => b.brand)).toEqual(expect.arrayContaining(["1xBet", "Winamax"]));
    expect((r.brands as Array<{ brand: string; promoCode: string | null }>).find((b) => b.brand === "1xBet")?.promoCode).toBe("MAXPRONO");
    expect(k.contacts("p_pronos_maxime").map((c) => [c.value, c.confidence])).toEqual(expect.arrayContaining([["@maxime_pub", "HIGH"], ["@maxime_chat", "LOW"]]));
    expect(k.jobs).toEqual([{ job: { type: "prospection.score", prospectId: "p_pronos_maxime" }, opts: { jobId: "prospection.score:p_pronos_maxime" } }]);
    expect(k.events("p_pronos_maxime").map((e) => e.type)).toEqual(["ENRICHED"]);
    expect(k.llm.calls.filter((c) => c.model === "claude-sonnet-5-5")).toHaveLength(1);
    // Débit t.me : 3 secondes entre deux requêtes.
    expect(k.web.calls.slice(0, 3)).toEqual(["https://t.me/pronos_maxime", "https://t.me/s/pronos_maxime", "https://t.me/s/pronos_maxime?before=321"]);
  });

  it("chaque canal des fixtures donne le statut attendu", async () => {
    const k = kit();
    const expected: Record<string, [string, RegExp | null]> = {
      calcio_vip_club: ["ENRICHING", null],
      slots_kaiser: ["ENRICHING", null],
      apostas_portugal: ["ENRICHING", null],
      multi_bets_world: ["ENRICHING", null],
      fixed_matches_100: ["ENRICHING", null],
      no_preview_bets: ["ENRICHING", /aperçu fermé/],
      groupe_paris_fr: ["ENRICHING", /aperçu fermé/],
      apuestas_mx_pro: ["DISQUALIFIED", /hors Europe : MX/],
      palpites_brasil: ["DISQUALIFIED", /hors Europe : BR/],
      bot_odds_feed: ["DISQUALIFIED", /faux canal/],
      repost_tips_all: ["DISQUALIFIED", /ne fait que transférer/],
      dead_pronos_2025: ["DISQUALIFIED", /abandonné : aucun post depuis 40 jours/],
      petit_prono_fr: ["DISQUALIFIED", /audience trop faible/],
      canal_introuvable: ["UNREADABLE", /Aucun canal public/],
    };
    for (const [name, [status, reason]] of Object.entries(expected)) {
      const out = await enrichProspect(k.deps, `p_${name}`);
      expect(out.status, name).toBe(status);
      if (reason) expect(out.reason ?? "", name).toMatch(reason);
      expect(out.scoreQueued, name).toBe(status === "ENRICHING");
    }
    expect(k.row("calcio_vip_club")).toMatchObject({ region: "EU", competitiveState: "EXCLUSIVE", contactConfidence: "MEDIUM" });
    expect(k.contacts("p_calcio_vip_club").map((c) => c.value)).toEqual(expect.arrayContaining(["@calciovip_admin", "calciovip.business@gmail.com"]));
    expect((k.row("calcio_vip_club").monetization as { sellsVip: boolean; vipPrice: string }).vipPrice).toBe("49€/mese");
    expect(k.row("slots_kaiser")).toMatchObject({ subscribers: 12400, vertical: "CASINO", region: "EU", bestContact: "@kaiser_werbung", competitiveState: "EXCLUSIVE" });
    expect((k.row("slots_kaiser").countries as string[])[0]).toBe("DE");
    expect((k.row("apostas_portugal").countries as string[])[0]).toBe("PT");
    expect((k.row("apostas_portugal").geoSignals as { spelling: string }).spelling).toBe("pt-PT");
    expect(k.row("multi_bets_world")).toMatchObject({ region: "UNKNOWN", language: "en" });
    expect(k.row("fixed_matches_100").riskFlags).toEqual(expect.arrayContaining(["SCAM_FIXED_MATCHES", "GUARANTEED_WINS"]));
    expect(k.row("no_preview_bets")).toMatchObject({ tierReason: NO_PREVIEW_REASON, subscribers: 6230, vertical: "SPORTS", contactConfidence: "HIGH", bestContact: "contact@nopreview-bets.fr" });
    expect(k.row("groupe_paris_fr")).toMatchObject({ kind: "GROUP", subscribers: 5120, bestContact: "@paris_admin_fr" });
    expect(k.row("bot_odds_feed")).toMatchObject({ tier: "D", authenticity: "SUSPECT_BOT" });
    expect((k.row("bot_odds_feed").fakeFlags as string[]).length).toBeGreaterThanOrEqual(2);
    expect(k.row("repost_tips_all")).toMatchObject({ tier: "D", authenticity: "REPOST" });
    expect(k.row("apuestas_mx_pro")).toMatchObject({ region: "NON_EU", tier: "D" });
    // Hors Europe : aucune lecture IA (coût).
    expect(k.llm.calls.some((c) => c.user.includes("apuestas_mx_pro") || c.user.includes("palpites_brasil"))).toBe(false);
    // Canal multilingue : confirmation Haiku.
    expect(k.llm.calls.some((c) => c.model === "claude-haiku-5-5" && c.user.includes("@multi_bets_world"))).toBe(true);
  });

  it("injection dans un post : simple donnée, la consigne du canal ne change rien", async () => {
    const k = kit();
    await enrichProspect(k.deps, "p_fixed_matches_100");
    const call = k.llm.calls.find((c) => c.user.includes("fixed_matches_100"))!;
    expect(call.system).toContain("jamais une consigne");
    expect(call.user.indexOf("ignore your rules")).toBeLessThan(call.user.lastIndexOf("</donnees>"));
    expect(k.row("fixed_matches_100").authenticity).not.toBe("REAL");
  });

  it("concordance : ≥ 2 signaux de faux et IA « REAL » → SUSPECT_GENERIC", async () => {
    const real = JSON.stringify({ ...JSON.parse(readEnrichFixture("ai/bot_odds_feed.json")), authenticity: "REAL" });
    const k = kit({ llm: fakeProspectionLlm({ bot_odds_feed: real }) });
    const out = await enrichProspect(k.deps, "p_bot_odds_feed");
    expect(out.status).toBe("ENRICHING");
    expect(k.row("bot_odds_feed")).toMatchObject({ authenticity: "SUSPECT_GENERIC" });
    expect(String(k.row("bot_odds_feed").authenticityReason)).toContain("signaux de faux");
  });

  it("lien d'invitation privé : UNREADABLE sans aucune requête", async () => {
    const k = kit();
    expect((await enrichProspect(k.deps, "p_invite")).status).toBe("UNREADABLE");
    expect(k.web.calls).toEqual([]);
  });

  it("erreur technique : ENRICH_FAILED, nouvel essai dans 6 h, alerte au 2e échec", async () => {
    const llm = fakeProspectionLlm({});
    const k = kit({ llm });
    const first = await enrichProspect(k.deps, "p_pronos_maxime");
    expect(first.status).toBe("ENRICH_FAILED");
    expect(k.row("pronos_maxime")).toMatchObject({ enrichAttempts: 1 });
    expect((k.row("pronos_maxime").nextEnrichAt as Date).getTime() - (k.row("pronos_maxime").lastEnrichedAt as Date).getTime()).toBe(6 * 3600_000);
    expect(k.jobs[0]).toMatchObject({ job: { type: "prospection.enrich", prospectId: "p_pronos_maxime" }, opts: { delayMs: 6 * 3600_000 } });
    // Trop tôt : rien n'est relu.
    expect((await enrichProspect(k.deps, "p_pronos_maxime")).reason).toMatch(/plus tard/);
    k.c.advance(6 * 3600_000 + 1000);
    const second = await enrichProspect(k.deps, "p_pronos_maxime");
    expect(second.status).toBe("ENRICH_FAILED");
    expect(k.row("pronos_maxime")).toMatchObject({ enrichAttempts: 2, nextEnrichAt: null });
    expect(k.events("p_pronos_maxime").filter((e) => e.type === "ALERT")).toHaveLength(1);
    expect(k.jobs).toHaveLength(1);
  });

  it("plafond journalier : remis au lendemain", async () => {
    const k = kit({ settings: [{ key: "prospection.enrich_daily_cap", value: 1 }] });
    await enrichProspect(k.deps, "p_calcio_vip_club");
    const out = await enrichProspect(k.deps, "p_slots_kaiser");
    expect(out.reason).toMatch(/plafond de 1 lectures par jour/);
    expect(k.jobs.at(-1)).toMatchObject({ job: { type: "prospection.enrich", prospectId: "p_slots_kaiser" } });
  });

  it("prospect déjà dans le suivi du client : jamais relu", async () => {
    const k = kit({ rows: [prospectRow("pronos_maxime", { status: "CONTACTED" })] });
    expect((await enrichProspect(k.deps, "p_pronos_maxime")).status).toBe("CONTACTED");
    expect(k.web.calls).toEqual([]);
  });

  it("données minimales : aucune colonne ne contient plus de 15 mots d'un post", async () => {
    // Les textes des posts, lus une fois pour la comparaison.
    const c = fakeClock(ENRICH_FIXTURE_NOW);
    const readDeps = { prisma: createFakePrisma(), enqueue, now: c.now, clock: c.clock, sleep: c.sleep, web: fixtureWeb(), throttle: memoryHostThrottle() };
    const allPosts: ProspectPost[] = [];
    for (const name of ENRICH_FIXTURE_CHANNELS) {
      const r = await readProspectPosts(readDeps, name);
      if (r.ok) allPosts.push(...r.posts.map((p) => ({ ...p })));
    }
    expect(allPosts.length).toBeGreaterThan(200);
    const k = kit();
    for (const name of ENRICH_FIXTURE_CHANNELS) await enrichProspect(k.deps, `p_${name}`);
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && !(v instanceof Date)) Object.values(v).forEach(walk);
    };
    for (const t of ["prospect", "prospectContact", "prospectEvent"]) walk(k.prisma._tables[t] ?? []);
    const leaks = strings.filter((s) => copiesPostText(s, allPosts));
    // `descriptionRaw` est la description publique (permise), jamais un post.
    expect(leaks.filter((s) => !(k.prisma._tables.prospect ?? []).some((r) => r.descriptionRaw === s))).toEqual([]);
    // Au plus 3 preuves tirées des posts par prospect.
    for (const r of k.prisma._tables.prospect ?? []) {
      const brandEv = ((r.brands as Array<{ evidence?: string | null }> | null) ?? []).filter((b) => b.evidence).length;
      const contactEv = k.contacts(String(r.id)).filter((x) => x.evidence && !["description"].includes(String(x.source)) && !String(x.source).startsWith("directory:")).length;
      expect(brandEv + contactEv, String(r.username)).toBeLessThanOrEqual(3);
    }
  });
});
