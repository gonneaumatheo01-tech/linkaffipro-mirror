import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
// ---- Fausse base Prisma en mémoire (seules les méthodes utilisées par la synchro) ----
  type Row = Record<string, unknown>;
  const store = { programs: [] as Row[], campaigns: [] as Row[], players: [] as Row[], events: [] as Row[], syncStates: new Map<string, Row>(), clicks: [] as Row[], postStats: new Map<string, Row>(), recorded: [] as Row[] };
  let seq = 0;
  const id = () => `id${++seq}`;
  const resetSeq = () => { seq = 0; };
  
  function matchWhere(row: Row, where: Row): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Row;
        if ("programId" in o && k === "affiliateCampaign") {
          const camp = store.campaigns.find((c) => c.id === row.affiliateCampaignId);
          return camp?.programId === o.programId;
        }
        if ("postId" in o && k === "click") {
          const click = store.clicks.find((c) => c.id === row.clickId);
          return click?.postId === o.postId;
        }
        return Object.values(o).every((vv) => Object.values(row).includes(vv)) || Object.entries(o).every(([kk, vv]) => row[kk] === vv);
      }
      return row[k] === v;
    });
  }
  
  function table(rows: Row[], uniq: (where: Row) => (r: Row) => boolean) {
    return {
      findMany: vi.fn(async (args?: { where?: Row }) => rows.filter((r) => !args?.where || matchWhere(r, args.where))),
      findUnique: vi.fn(async (args: { where: Row }) => rows.find(uniq(args.where)) ?? null),
      findFirst: vi.fn(async (args: { where: Row }) => rows.find((r) => matchWhere(r, args.where)) ?? null),
      upsert: vi.fn(async (args: { where: Row; create: Row; update: Row }) => {
        const hit = rows.find(uniq(args.where));
        if (hit) {
          Object.assign(hit, args.update);
          return hit;
        }
        const created = { id: id(), ...args.create };
        rows.push(created);
        return created;
      }),
      update: vi.fn(async (args: { where: Row; data: Row }) => {
        const hit = rows.find((r) => r.id === args.where.id || uniq(args.where)(r));
        if (!hit) throw new Error("introuvable");
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === "object" && "increment" in (v as Row)) hit[k] = ((hit[k] as number) ?? 0) + ((v as Row).increment as number);
          else hit[k] = v;
        }
        return hit;
      }),
      create: vi.fn(async (args: { data: Row }) => {
        const created = { id: id(), ...args.data };
        rows.push(created);
        return created;
      }),
    };
  }
  
  const fakePrisma = {
    affiliateProgram: table(store.programs, (w) => (r) => { const u = w.source_externalId as Row | undefined; return u ? r.source === u.source && r.externalId === u.externalId : r.id === w.id; }),
    affiliateCampaign: table(store.campaigns, (w) => (r) => { const u = w.programId_externalId as Row | undefined; return u ? r.programId === u.programId && r.externalId === u.externalId : r.id === w.id; }),
    player: table(store.players, (w) => (r) => { const u = w.affiliateCampaignId_externalPlayerId as Row | undefined; return u ? r.affiliateCampaignId === u.affiliateCampaignId && r.externalPlayerId === u.externalPlayerId : r.id === w.id; }),
    playerEvent: table(store.events, (w) => (r) => { const u = w.playerId_externalId as Row | undefined; return u ? r.playerId === u.playerId && r.externalId === u.externalId : r.id === w.id; }),
    click: table(store.clicks, (w) => (r) => (w.subId ? r.subId === w.subId : r.id === w.id)),
    syncState: {
      upsert: vi.fn(async (args: { where: { source: string }; create: Row }) => {
        const hit = store.syncStates.get(args.where.source);
        if (hit) return hit;
        const created = { source: args.where.source, cursor: {}, isRunning: false, lastRunAt: null, rowsImported: 0, ...args.create };
        store.syncStates.set(args.where.source, created);
        return created;
      }),
      update: vi.fn(async (args: { where: { source: string }; data: Row }) => {
        const hit = store.syncStates.get(args.where.source)!;
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === "object" && "increment" in (v as Row)) hit[k] = ((hit[k] as number) ?? 0) + ((v as Row).increment as number);
          else hit[k] = v;
        }
        return hit;
      }),
    },
    postStats: {
      upsert: vi.fn(async (args: { where: { postId: string }; create: Row; update: Row }) => {
        const hit = store.postStats.get(args.where.postId);
        if (hit) Object.assign(hit, args.update);
        else store.postStats.set(args.where.postId, { ...args.create });
        return store.postStats.get(args.where.postId);
      }),
    },
  };
  
  
  return { store, fakePrisma, id, resetSeq };
});
const { store, resetSeq } = h;
vi.mock("@linkaffipro/db", () => ({
  prisma: h.fakePrisma,
  recordEvent: vi.fn(async (e: Record<string, unknown>) => {
    h.store.recorded.push(e);
  }),
  toJsonValue: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));

import { runSync } from "./linkaffi-sync";
import type { LinkAffiClient } from "@linkaffipro/linkaffi";
type Row = Record<string, unknown>;

// ---- Faux client API ----
const data: Record<string, Row[]> = {
  casinos: [{ id: "cas1", name: "Celsius", is_active: true }],
  campaigns: [{ id: "camp1", campaign_key: "47eb8mwc", name: "TT", casino_id: "cas1", domain: "linkaffi.me" }],
  currency_rates: [{ currency: "EUR", rate: 1 }],
  players: [
    { id: "la1", casino_id: "cas1", campaign_id: "camp1", external_player_id: 241253, sub_id: "AbC123def456", sub_id_source: "time_match", status: "registered", all_deposits_count: 0, total_deposited_amount: 0, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z" },
  ],
  player_events: [{ id: "ev1", player_id: "la1", event: "registration", idempotency_key: "registration:241253", created_at: "2026-10-01T10:00:00Z" }],
  player_financials: [],
  revshare_snapshots: [],
  deposit_snapshots: [],
  ftd_invalidations: [],
  clicks: [],
};
const calls: string[] = [];
const fakeClient = {
  getPage: vi.fn(async (t: string, q: Row) => {
    calls.push(`${t}?${new URLSearchParams(q as Record<string, string>).toString()}`);
    const rows = data[t] ?? [];
    return { table: t, total: rows.length, offset: 0, limit: 5000, count: rows.length, rows };
  }),
} as unknown as LinkAffiClient;

beforeEach(() => {
  resetSeq();
  store.programs.length = 0;
  store.campaigns.length = 0;
  store.players.length = 0;
  store.events.length = 0;
  store.clicks.length = 0;
  store.recorded.length = 0;
  store.syncStates.clear();
  store.postStats.clear();
  calls.length = 0;
  store.clicks.push({ id: "clk1", subId: "AbC123def456", memberId: "mem1", postId: "post1" });
});

describe("runSync", () => {
  it("importe, rattache par sub_id et reste idempotent sur deux passages", async () => {
    const now = () => new Date("2026-10-09T12:00:00Z");
    const r1 = await runSync({ client: fakeClient, now });
    expect(r1.every((r) => r.ok)).toBe(true);
    expect(store.programs).toHaveLength(1);
    expect(store.campaigns[0]).toMatchObject({ campaignKey: "47eb8mwc", trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}" });
    expect(store.players).toHaveLength(1);
    expect(store.players[0]).toMatchObject({ subId: "AbC123def456", subIdSource: "time_match", clickId: "clk1", memberId: "mem1" });
    expect(store.events).toHaveLength(1);
    expect(store.recorded.map((e) => e.type)).toEqual(["player.registered"]);
    expect(store.recorded[0]).toMatchObject({ memberId: "mem1" });
    expect(store.postStats.get("post1")).toMatchObject({ registrations: 1, ftds: 0 });

    const r2 = await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(r2.every((r) => r.ok)).toBe(true);
    expect(store.players).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.recorded).toHaveLength(1);
    expect(store.syncStates.get("players")).toMatchObject({ isRunning: false, lastError: null, rowsImported: 2 });
  });

  it("lit une fenêtre incrémentale avec chevauchement au second passage", async () => {
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    calls.length = 0;
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    const playersCall = calls.find((c) => c.startsWith("players?"))!;
    expect(playersCall).toContain("date_col=updated_at");
    expect(playersCall).toContain("from=2026-10-09");
    expect(calls.find((c) => c.startsWith("casinos?"))).not.toContain("from=");
  });

  it("un postback remplace ensuite le time_match et la table en erreur ne bloque pas les autres", async () => {
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    data.players![0] = { ...data.players![0]!, sub_id: "NEW999new000", sub_id_source: "postback", updated_at: "2026-10-09T12:05:00Z" };
    store.clicks.push({ id: "clk2", subId: "NEW999new000", memberId: "mem2", postId: "post2" });
    const failing = { getPage: vi.fn(async (t: string, q: Row) => { if (t === "revshare_snapshots") throw new Error("503"); return (fakeClient as unknown as { getPage: (t: string, q: Row) => Promise<unknown> }).getPage(t, q); }) } as unknown as LinkAffiClient;
    const r = await runSync({ client: failing, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(r.find((x) => x.table === "revshare_snapshots")).toMatchObject({ ok: false, error: "503" });
    expect(r.find((x) => x.table === "clicks")).toMatchObject({ ok: true });
    expect(store.players[0]).toMatchObject({ subId: "NEW999new000", subIdSource: "postback", clickId: "clk2", memberId: "mem2" });
    expect(store.syncStates.get("revshare_snapshots")).toMatchObject({ isRunning: false, lastError: "503" });
    data.players![0] = { ...data.players![0]!, sub_id: "AbC123def456", sub_id_source: "time_match", updated_at: "2026-10-01T10:00:00Z" };
  });
});
