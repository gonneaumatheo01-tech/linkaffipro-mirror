/** Phase 32, chantier A — relecture allégée sur les fixtures (aucun réseau) : cadences, page + 1 aperçu, point, alertes. */
import { describe, expect, it } from "vitest";
import { memoryHostThrottle } from "../../analysts/watch/polite";
import { fakeClock } from "../../analysts/watch/testing";
import { createFakePrisma } from "../../testing/fake-prisma";
import { ENRICH_FIXTURE_NOW, fixtureWeb } from "../enrich/testing";
import { DAY_MS } from "../score/settings";
import { cadenceDaysFor, dueForRequalify, lightPostsPerDay, requalifyProspect } from "./requalify";
import { postsOf } from "./testing";

function kit(rows: Array<Record<string, unknown>>) {
  const c = fakeClock(ENRICH_FIXTURE_NOW);
  const prisma = createFakePrisma({ prospect: rows, setting: [], affiliateOffer: [] });
  const web = fixtureWeb();
  const deps = { prisma, enqueue: { async orchestrator() {}, async step() {} }, now: c.now, clock: c.clock, sleep: c.sleep, web, throttle: memoryHostThrottle(), robotsCache: new Map(), prospectionLlm: null };
  return { prisma, deps, web, t: (n: string) => (prisma._tables[n] ?? []) as Array<Record<string, unknown>> };
}

const base = {
  kind: "CHANNEL",
  title: "Pronos Maxime",
  region: "EU",
  vertical: "SPORTS",
  countries: ["FR"],
  contactConfidence: "HIGH",
  bestContact: "@maxime_pub",
  sourceType: "DIRECTORY",
  graphDepth: 3,
  cocitationCount: 0,
  enrichAttempts: 0,
  subscribers: 17000,
  medianViews: 2000,
  viewRate: 0.12,
  postsPerDay: 2,
  fakeFlags: [],
  riskFlags: [],
  monetization: {},
  competitiveState: "ROTATING",
  descriptionRaw: null,
  signedAt: null,
  watchMuted: false,
  discoveredAt: new Date("2026-08-01T00:00:00Z"),
};

describe("cadences", () => {
  it("par statut et niveau", () => {
    expect(cadenceDaysFor({ status: "QUALIFIED", tier: "A" })).toBe(7);
    expect(cadenceDaysFor({ status: "QUALIFIED", tier: "C" })).toBe(21);
    expect(cadenceDaysFor({ status: "NEGOTIATING", tier: "B" })).toBe(7);
    expect(cadenceDaysFor({ status: "SIGNED", tier: "A" })).toBe(3);
    expect(cadenceDaysFor({ status: "SKIPPED", tier: "B" })).toBe(60);
    expect(cadenceDaysFor({ status: "DISQUALIFIED", tier: "D", tierReason: "audience trop faible : 40 vues par post" })).toBe(45);
    expect(cadenceDaysFor({ status: "DISQUALIFIED", tier: "D", tierReason: "quasi mort : 3 posts en 30 jours" })).toBe(45);
    expect(cadenceDaysFor({ status: "DISQUALIFIED", tier: "D", tierReason: "hors Europe : BR" })).toBeNull();
    expect(cadenceDaysFor({ status: "BLACKLISTED", tier: "A" })).toBeNull();
    expect(cadenceDaysFor({ status: "QUALIFIED", tier: "A", region: "NON_EU" })).toBeNull();
  });
  it("relectures dues, les plus en retard d'abord", async () => {
    const k = kit([
      { ...base, id: "a", username: "a_chan", status: "QUALIFIED", tier: "A", lastEnrichedAt: new Date(ENRICH_FIXTURE_NOW.getTime() - 8 * DAY_MS) },
      { ...base, id: "b", username: "b_chan", status: "QUALIFIED", tier: "A", lastEnrichedAt: new Date(ENRICH_FIXTURE_NOW.getTime() - 20 * DAY_MS) },
      { ...base, id: "c", username: "c_chan", status: "QUALIFIED", tier: "C", lastEnrichedAt: new Date(ENRICH_FIXTURE_NOW.getTime() - 8 * DAY_MS) },
      { ...base, id: "d", username: "d_chan", status: "BLACKLISTED", tier: "A", lastEnrichedAt: new Date("2026-01-01") },
      { ...base, id: "e", username: null, status: "QUALIFIED", tier: "A", lastEnrichedAt: new Date("2026-01-01") },
    ]);
    expect(await dueForRequalify(k.deps as never, ENRICH_FIXTURE_NOW, 10)).toEqual(["b", "a"]);
    expect(await dueForRequalify(k.deps as never, ENRICH_FIXTURE_NOW, 1)).toEqual(["b"]);
  });
  it("rythme sur une page pleine de 20 posts", () => {
    const p = postsOf(Array.from({ length: 20 }, () => ({ text: "x" })));
    expect(lightPostsPerDay(p, new Date("2026-10-26T09:00:00Z"), true)).toBe(1);
  });
});

describe("relecture d'un canal", () => {
  it("page + UNE page d'aperçu, point d'historique, marque forte lâchée signalée, prochaine relecture", async () => {
    const k = kit([
      {
        ...base,
        id: "p1",
        username: "pronos_maxime",
        channelUrl: "https://t.me/pronos_maxime",
        status: "QUALIFIED",
        tier: "A",
        score: 75,
        lastEnrichedAt: new Date(ENRICH_FIXTURE_NOW.getTime() - 9 * DAY_MS),
        brands: [{ brand: "bet365", intensity: "HEAVY", links: 4, lastSeenAt: "2026-09-20" }],
      },
    ]);
    const r = await requalifyProspect(k.deps as never, "p1");
    expect(r.status).toBe("done");
    expect(k.web.calls.filter((u) => u.includes("t.me/s/"))).toHaveLength(1);
    expect(k.web.calls.some((u) => u.includes("before="))).toBe(false);
    expect(k.t("prospectSnapshot")).toHaveLength(2);
    const kinds = k.t("prospectAlert").map((a) => a.kind);
    expect(kinds).toContain("AFFILIATE_SWITCHED");
    expect(k.t("prospectEvent").filter((e) => e.type === "ALERT")).toHaveLength(kinds.length);
    const ev = k.t("prospectEvent").find((e) => e.type === "REQUALIFIED")!;
    expect(JSON.stringify(ev.payload)).not.toMatch(/pronos du jour|\bcote\b/i);
    const row = k.t("prospect")[0]!;
    expect((row.nextRequalifyAt as Date).getTime()).toBeGreaterThan(ENRICH_FIXTURE_NOW.getTime());
    expect(row.lastRequalifiedAt).toEqual(ENRICH_FIXTURE_NOW);
    // Deuxième passage le même jour : même empreinte, aucune nouvelle alerte.
    expect((await requalifyProspect(k.deps as never, "p1")).alerts).toBe(0);
  });
  it("canal introuvable : rien ne casse, relecture reportée", async () => {
    const k = kit([{ ...base, id: "x", username: "canal_introuvable", channelUrl: "https://t.me/canal_introuvable", status: "QUALIFIED", tier: "B", lastEnrichedAt: new Date("2026-10-01") }]);
    expect((await requalifyProspect(k.deps as never, "x")).status).toBe("unreadable");
    expect(k.t("prospectAlert")).toHaveLength(0);
  });
});
