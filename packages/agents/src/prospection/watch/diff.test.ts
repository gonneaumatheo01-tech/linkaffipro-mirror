/** Phase 32, chantier A — chaque changement et son seuil (fixtures `watch/snapshots.json`), compactage de l'historique. */
import { describe, expect, it } from "vitest";
import { diffSnapshots, familyOf, ONCE_PER_KEY_KINDS } from "./diff";
import { compactionPlan, type SnapshotRow } from "./snapshots";
import { pointOf, readWatchFixture } from "./testing";

type Case = { name: string; status: string; postsRead: number; corpus: string; history: Array<Record<string, unknown>>; current: Record<string, unknown>; expect: { kinds: string[]; fakeFlags: string[] } };
const fx = readWatchFixture<{ now: string; base: Record<string, unknown>; cases: Case[] }>("snapshots.json");
const NOW = new Date(fx.now);

describe("changements détectés (diff.ts)", () => {
  for (const c of fx.cases)
    it(c.name, () => {
      const history = c.history.map((h) => pointOf(fx.base, h));
      const current = pointOf(fx.base, { takenAt: fx.now, ...c.current });
      const r = diffSnapshots({ history, current, now: NOW, status: c.status, postsRead: c.postsRead, corpus: c.corpus });
      expect(r.alerts.map((a) => a.kind).sort()).toEqual([...c.expect.kinds].sort());
      expect(r.fakeFlags).toEqual(c.expect.fakeFlags);
      for (const a of r.alerts) {
        expect(a.strength).toBeGreaterThanOrEqual(0);
        expect(a.strength).toBeLessThanOrEqual(100);
        expect(a.dedupeKey.startsWith(a.kind)).toBe(true);
      }
    });

  it("hausse suspecte : aucune alerte positive, signal de faux seulement", () => {
    const c = fx.cases.find((x) => x.name.includes("ne suivent pas"))!;
    const r = diffSnapshots({ history: c.history.map((h) => pointOf(fx.base, h)), current: pointOf(fx.base, { takenAt: fx.now, ...c.current }), now: NOW, status: "QUALIFIED", postsRead: 20 });
    expect(r.alerts.some((a) => a.kind === "GROWTH_SPIKE")).toBe(false);
    expect(r.fakeFlags).toContain("GROWTH_SPIKE");
  });

  it("sans historique : rien", () => {
    expect(diffSnapshots({ history: [], current: pointOf(fx.base, {}), now: NOW, status: "QUALIFIED", postsRead: 20 }).alerts).toEqual([]);
  });

  it("empreinte d'un abandon de marque datée, une fois par objet", () => {
    const c = fx.cases[0]!;
    const r = diffSnapshots({ history: c.history.map((h) => pointOf(fx.base, h)), current: pointOf(fx.base, { takenAt: fx.now }), now: NOW, status: "QUALIFIED", postsRead: 20, corpus: c.corpus });
    expect(r.alerts[0]!.dedupeKey).toBe("AFFILIATE_DROPPED:1xbet:2026-10-04");
    expect(ONCE_PER_KEY_KINDS.has("AFFILIATE_DROPPED")).toBe(true);
  });

  it("familles : opportunités, affiliés, pipeline, informations", () => {
    expect(familyOf("AFFILIATE_DROPPED", "QUALIFIED")).toBe("opportunity");
    expect(familyOf("GROWTH_SPIKE", "QUALIFIED")).toBe("opportunity");
    expect(familyOf("AFFILIATE_RISKY_CLAIM", "SIGNED")).toBe("affiliate");
    expect(familyOf("WENT_SILENT", "NEGOTIATING")).toBe("pipeline");
    expect(familyOf("WENT_SILENT", "QUALIFIED")).toBe("info");
    expect(familyOf("DECLINE", "CONTACTED")).toBe("info");
  });
});

describe("historique : 26 points au plus", () => {
  const row = (i: number): SnapshotRow => ({
    id: `s${i}`,
    prospectId: "p",
    takenAt: new Date(Date.UTC(2026, 0, 1 + i * 7)),
    subscribers: 1000 + i * 100,
    medianViews: 100 + i,
    viewRate: 0.1,
    postsPerDay: 2,
    brands: i === 0 ? [{ brand: "1xbet", intensity: "HEAVY", lastSeenAt: "2026-01-01" }] : [],
    competitiveState: "FREE",
    bestContact: null,
    contactConfidence: "NONE",
    sellsAds: false,
    marketplace: false,
    lastPostAt: null,
    tier: "B",
    score: 50,
    merged: 1,
  });
  it("26 : rien ; 28 : les plus anciens fusionnés, date du plus ancien gardée", () => {
    expect(compactionPlan(Array.from({ length: 26 }, (_, i) => row(i)))).toEqual({ update: [], deleteIds: [] });
    const plan = compactionPlan(Array.from({ length: 28 }, (_, i) => row(i)));
    expect(plan.deleteIds).toEqual(["s1", "s2"]);
    expect(plan.update).toHaveLength(1);
    const u = plan.update[0]!;
    expect(u.id).toBe("s0");
    expect(u.data.merged).toBe(3);
    expect(u.data.takenAt).toEqual(row(0).takenAt);
    expect(u.data.subscribers).toBe(1100);
    expect((u.data.brands as Array<{ brand: string }>).map((b) => b.brand)).toEqual(["1xbet"]);
  });
});
