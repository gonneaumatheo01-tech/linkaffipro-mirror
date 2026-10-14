import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // ---- Fausse base Prisma en mémoire (seules les méthodes utilisées par la synchro) ----
  type Row = Record<string, unknown>;
  const store = {
    programs: [] as Row[],
    campaigns: [] as Row[],
    players: [] as Row[],
    events: [] as Row[],
    syncStates: new Map<string, Row>(),
    clicks: [] as Row[],
    postStats: new Map<string, Row>(),
    recorded: [] as Row[],
    /** Nos campagnes (offres rattachées) et lignes `stats` importées (phase 10). */
    ourCampaigns: [] as Row[],
    dailyStats: [] as Row[],
    settings: new Map<string, Row>(),
  };
  let seq = 0;
  const id = () => `id${++seq}`;
  const resetSeq = () => {
    seq = 0;
  };

  function matchWhere(row: Row, where: Row): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Row;
        if ("programId" in o && k === "affiliateCampaign") {
          const camp = store.campaigns.find((c) => c.id === row.affiliateCampaignId);
          return camp?.programId === o.programId;
        }
        if (Array.isArray(o.in)) return (o.in as unknown[]).includes(row[k]);
        if ("postId" in o && k === "click") {
          const click = store.clicks.find((c) => c.id === row.clickId);
          return click?.postId === o.postId;
        }
        return (
          Object.values(o).every((vv) => Object.values(row).includes(vv)) ||
          Object.entries(o).every(([kk, vv]) => row[kk] === vv)
        );
      }
      return row[k] === v;
    });
  }

  function table(rows: Row[], uniq: (where: Row) => (r: Row) => boolean) {
    return {
      findMany: vi.fn(async (args?: { where?: Row }) =>
        rows.filter((r) => !args?.where || matchWhere(r, args.where)),
      ),
      findUnique: vi.fn(async (args: { where: Row }) => rows.find(uniq(args.where)) ?? null),
      findFirst: vi.fn(
        async (args: { where: Row }) => rows.find((r) => matchWhere(r, args.where)) ?? null,
      ),
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
          if (v && typeof v === "object" && "increment" in (v as Row))
            hit[k] = ((hit[k] as number) ?? 0) + ((v as Row).increment as number);
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

  const fakePrisma: Record<string, unknown> = {
    // Transaction interactive : en cas d'erreur, joueurs et événements reviennent à leur état d'avant (comme Postgres).
    // Forme tableau (requêtes déjà lancées) : attend chacune.
    $transaction: vi.fn(async (fn: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
      if (Array.isArray(fn)) return Promise.all(fn);
      const players = store.players.map((r) => ({ ...r }));
      const events = store.events.map((r) => ({ ...r }));
      try {
        return await fn(fakePrisma);
      } catch (err) {
        store.players.splice(0, store.players.length, ...players);
        store.events.splice(0, store.events.length, ...events);
        throw err;
      }
    }),
    affiliateProgram: table(store.programs, (w) => (r) => {
      const u = w.source_externalId as Row | undefined;
      return u ? r.source === u.source && r.externalId === u.externalId : r.id === w.id;
    }),
    affiliateCampaign: table(store.campaigns, (w) => (r) => {
      const u = w.programId_externalId as Row | undefined;
      return u ? r.programId === u.programId && r.externalId === u.externalId : r.id === w.id;
    }),
    player: {
      ...table(store.players, (w) => (r) => {
        const u = w.affiliateCampaignId_externalPlayerId as Row | undefined;
        return u
          ? r.affiliateCampaignId === u.affiliateCampaignId &&
              r.externalPlayerId === u.externalPlayerId
          : r.id === w.id;
      }),
      // Offres qui portent nos joueurs rattachés par sub-ID.
      groupBy: vi.fn(async () =>
        [...new Set(store.players.filter((p) => p.clickId).map((p) => p.affiliateCampaignId))].map(
          (affiliateCampaignId) => ({ affiliateCampaignId }),
        ),
      ),
    },
    playerEvent: {
      ...table(store.events, (w) => (r) => {
        const u = w.playerId_externalId as Row | undefined;
        return u ? r.playerId === u.playerId && r.externalId === u.externalId : r.id === w.id;
      }),
      deleteMany: vi.fn(
        async (args: { where: { playerId: string; externalId: { in: string[] } } }) => {
          const keep = store.events.filter(
            (e) =>
              !(
                e.playerId === args.where.playerId &&
                args.where.externalId.in.includes(e.externalId as string)
              ),
          );
          const count = store.events.length - keep.length;
          store.events.splice(0, store.events.length, ...keep);
          return { count };
        },
      ),
    },
    campaign: { findMany: vi.fn(async () => store.ourCampaigns) },
    trackingLink: { findMany: vi.fn(async () => []) },
    affiliateDailyStat: table(store.dailyStats, (w) => (r) => r.externalId === w.externalId),
    setting: {
      findUnique: vi.fn(
        async (args: { where: { key: string } }) => store.settings.get(args.where.key) ?? null,
      ),
      upsert: vi.fn(async (args: { where: { key: string }; create: Row; update: Row }) => {
        const row = { ...(store.settings.get(args.where.key) ?? args.create), ...args.update };
        store.settings.set(args.where.key, row);
        return row;
      }),
    },
    click: table(store.clicks, (w) => (r) => (w.subId ? r.subId === w.subId : r.id === w.id)),
    syncState: {
      upsert: vi.fn(async (args: { where: { source: string }; create: Row }) => {
        const hit = store.syncStates.get(args.where.source);
        if (hit) return hit;
        const created = {
          source: args.where.source,
          cursor: {},
          isRunning: false,
          lastRunAt: null,
          rowsImported: 0,
          ...args.create,
        };
        store.syncStates.set(args.where.source, created);
        return created;
      }),
      update: vi.fn(async (args: { where: { source: string }; data: Row }) => {
        const hit = store.syncStates.get(args.where.source)!;
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === "object" && "increment" in (v as Row))
            hit[k] = ((hit[k] as number) ?? 0) + ((v as Row).increment as number);
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
  campaigns: [
    { id: "camp1", campaign_key: "47eb8mwc", name: "TT", casino_id: "cas1", domain: "linkaffi.me" },
  ],
  currency_rates: [{ currency: "EUR", rate: 1 }],
  players: [
    {
      id: "la1",
      casino_id: "cas1",
      campaign_id: "camp1",
      external_player_id: 241253,
      sub_id: "AbC123def456",
      sub_id_source: "time_match",
      status: "registered",
      all_deposits_count: 0,
      total_deposited_amount: 0,
      created_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-01T10:00:00Z",
    },
  ],
  player_events: [
    {
      id: "ev1",
      player_id: "la1",
      event: "registration",
      idempotency_key: "registration:241253",
      created_at: "2026-10-01T10:00:00Z",
    },
  ],
  player_financials: [],
  revshare_snapshots: [],
  deposit_snapshots: [],
  ftd_invalidations: [],
  clicks: [],
  stats: [],
};
const calls: string[] = [];
const fakeClient = {
  getPage: vi.fn(async (t: string, q: Row) => {
    const { eq, ...rest } = q as Row & { eq?: Record<string, string> };
    const qs = new URLSearchParams(rest as Record<string, string>);
    for (const [k, v] of Object.entries(eq ?? {})) qs.set(`eq.${k}`, v);
    calls.push(`${t}?${qs.toString()}`);
    const rows = (data[t] ?? []).filter((r) =>
      Object.entries(eq ?? {}).every(([k, v]) => r[k] === v),
    );
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
  store.ourCampaigns.length = 0;
  store.dailyStats.length = 0;
  store.settings.clear();
  calls.length = 0;
  store.clicks.push({ id: "clk1", subId: "AbC123def456", memberId: "mem1", postId: "post1" });
});

describe("runSync", () => {
  it("importe, rattache par sub_id et reste idempotent sur deux passages", async () => {
    const now = () => new Date("2026-10-09T12:00:00Z");
    const r1 = await runSync({ client: fakeClient, now });
    expect(r1.every((r) => r.ok)).toBe(true);
    expect(store.programs).toHaveLength(1);
    expect(store.campaigns[0]).toMatchObject({
      campaignKey: "47eb8mwc",
      trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
    });
    expect(store.players).toHaveLength(1);
    expect(store.players[0]).toMatchObject({
      subId: "AbC123def456",
      subIdSource: "time_match",
      clickId: "clk1",
      memberId: "mem1",
    });
    expect(store.events).toHaveLength(1);
    expect(store.recorded.map((e) => e.type)).toEqual(["player.registered"]);
    expect(store.recorded[0]).toMatchObject({ memberId: "mem1" });
    expect(store.postStats.get("post1")).toMatchObject({ registrations: 1, ftds: 0 });

    const r2 = await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(r2.every((r) => r.ok)).toBe(true);
    expect(store.players).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.recorded).toHaveLength(1);
    expect(store.syncStates.get("players")).toMatchObject({
      isRunning: false,
      lastError: null,
      rowsImported: 2,
    });
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
    data.players![0] = {
      ...data.players![0]!,
      sub_id: "NEW999new000",
      sub_id_source: "postback",
      updated_at: "2026-10-09T12:05:00Z",
    };
    store.clicks.push({ id: "clk2", subId: "NEW999new000", memberId: "mem2", postId: "post2" });
    const failing = {
      getPage: vi.fn(async (t: string, q: Row) => {
        if (t === "revshare_snapshots") throw new Error("503");
        return (
          fakeClient as unknown as { getPage: (t: string, q: Row) => Promise<unknown> }
        ).getPage(t, q);
      }),
    } as unknown as LinkAffiClient;
    const r = await runSync({ client: failing, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(r.find((x) => x.table === "revshare_snapshots")).toMatchObject({
      ok: false,
      error: "503",
    });
    expect(r.find((x) => x.table === "clicks")).toMatchObject({ ok: true });
    expect(store.players[0]).toMatchObject({
      subId: "NEW999new000",
      subIdSource: "postback",
      clickId: "clk2",
      memberId: "mem2",
    });
    expect(store.syncStates.get("revshare_snapshots")).toMatchObject({
      isRunning: false,
      lastError: "503",
    });
    data.players![0] = {
      ...data.players![0]!,
      sub_id: "AbC123def456",
      sub_id_source: "time_match",
      updated_at: "2026-10-01T10:00:00Z",
    };
  });
});

describe("NGR daté depuis les instantanés revshare (phase 8)", () => {
  const snap = (ngr: number, at: string) => [
    {
      id: "s1",
      player_id: 241253,
      casino_id: "cas1",
      last_ngr: ngr,
      last_seen_at: at,
      updated_at: at,
    },
  ];
  const ngrEvents = () =>
    store.events
      .filter((e) => e.type === "NGR")
      .map((e) => ({ amount: e.amount, occurredAt: (e.occurredAt as Date).toISOString() }));

  it("instantané 10 puis 25 : deux événements +10 et +15 à la date réelle, rien si le NGR ne bouge pas", async () => {
    data.revshare_snapshots = snap(10, "2026-10-05T08:00:00.000Z");
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    data.revshare_snapshots = snap(25, "2026-10-08T09:30:00.000Z");
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:20:00Z") });
    expect(ngrEvents()).toEqual([
      { amount: 10, occurredAt: "2026-10-05T08:00:00.000Z" },
      { amount: 15, occurredAt: "2026-10-08T09:30:00.000Z" },
    ]);
    expect(Number(store.players[0]!.ngr)).toBe(25);
    // Journal des événements : dates réelles Link Affi, pas la date d'import.
    const at = (type: string) =>
      store.recorded
        .filter((e) => e.type === type)
        .map((e) => (e.occurredAt as Date | undefined)?.toISOString());
    expect(at("player.registered")).toEqual(["2026-10-01T10:00:00.000Z"]);
    expect(at("player.ngr_updated")).toEqual([
      "2026-10-05T08:00:00.000Z",
      "2026-10-08T09:30:00.000Z",
    ]);
    data.revshare_snapshots = [];
  });

  it("si l'événement NGR ne peut pas être écrit, le joueur n'est pas modifié et la table passe en erreur (repris au passage suivant)", async () => {
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    data.revshare_snapshots = snap(12, "2026-10-06T08:00:00.000Z");
    const create = h.fakePrisma.playerEvent as { create: ReturnType<typeof vi.fn> };
    create.create.mockRejectedValueOnce(new Error("base saturée"));
    const r = await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(r.find((x) => x.table === "revshare_snapshots")).toMatchObject({
      ok: false,
      error: "base saturée",
    });
    expect(Number(store.players[0]!.ngr ?? 0)).toBe(0);
    expect(ngrEvents()).toEqual([]);
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:20:00Z") });
    expect(ngrEvents()).toEqual([{ amount: 12, occurredAt: "2026-10-06T08:00:00.000Z" }]);
    expect(Number(store.players[0]!.ngr)).toBe(12);
    data.revshare_snapshots = [];
  });
});

describe("commissions (phase 10) : CPA par joueur et agrégat stats de notre affilié", () => {
  const cpaEvents = () =>
    store.events
      .filter((e) => e.type === "CPA" || e.type === "CPA_REVERSAL")
      .map((e) => [e.type, e.amount, (e.occurredAt as Date).toISOString(), e.externalId]);

  it("CPA créditée puis annulée : +70 au crédit, −70 à l'annulation, rien de plus au passage suivant", async () => {
    const original = data.players![0]!;
    data.players![0] = {
      ...original,
      cpa_status: "approved",
      cpa_affiliate_amount: 70,
      cpa_credited_at: "2026-10-04T11:36:48Z",
      updated_at: "2026-10-04T12:00:00Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-04T12:05:00Z") });
    expect(cpaEvents()).toEqual([["CPA", 70, "2026-10-04T11:36:48.000Z", "cpa:la1"]]);
    expect(store.players[0]).toMatchObject({ cpaStatus: "approved", cpaAmount: 70 });

    data.players![0] = {
      ...data.players![0]!,
      cpa_status: "reversed",
      cpa_reversed_at: "2026-10-06T06:17:01Z",
      updated_at: "2026-10-06T06:17:02Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-06T06:20:00Z") });
    await runSync({ client: fakeClient, now: () => new Date("2026-10-06T06:30:00Z") });
    expect(cpaEvents()).toEqual([
      ["CPA", 70, "2026-10-04T11:36:48.000Z", "cpa:la1"],
      ["CPA_REVERSAL", -70, "2026-10-06T06:17:01.000Z", "cpa_reversal:la1"],
    ]);
    expect(
      store.recorded.filter((e) => String(e.type).startsWith("player.cpa_")).map((e) => e.type),
    ).toEqual(["player.cpa_credited", "player.cpa_reversed"]);
    // Jours à recalculer : le plus ancien touché (le crédit du 4).
    expect(store.settings.get("stats.daily.dirtySince")?.value).toMatchObject({
      day: "2026-10-04",
    });
    data.players![0] = original;
  });

  it("stats : seules les lignes de notre affilié sont demandées et importées (une ligne Link Affi = une ligne)", async () => {
    data.campaigns = [
      { ...data.campaigns![0]!, affiliate_id: "aff-ours" },
      {
        id: "camp2",
        campaign_key: "zz",
        name: "Autre",
        casino_id: "cas1",
        affiliate_id: "aff-other",
      },
    ];
    data.stats = [
      {
        id: "st1",
        affiliate_id: "aff-ours",
        casino_id: "cas1",
        campaign_id: "camp1",
        date: "2026-10-04",
        created_at: "2026-10-03T22:02:00Z",
        revenue: 223.09,
        cpa_revenue: 210,
        revshare_revenue: 13.0926,
      },
      {
        id: "st2",
        affiliate_id: "aff-other",
        casino_id: "cas1",
        campaign_id: "camp2",
        date: "2026-10-04",
        created_at: "2026-10-03T22:02:00Z",
        revenue: 500,
        cpa_revenue: 500,
        revshare_revenue: 0,
      },
    ];
    // Le joueur rattaché par sub-ID fait de camp1 une offre à nous (et de aff-ours notre affilié).
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    const statsCalls = calls.filter((c) => c.startsWith("stats?"));
    expect(statsCalls).toEqual(["stats?order=date&limit=5000&offset=0&eq.affiliate_id=aff-ours"]);
    expect(
      store.dailyStats.map((r) => [r.externalId, r.revshareRevenue, r.affiliateCampaignId]),
    ).toEqual([["st1", 13.0926, store.campaigns[0]!.id]]);
    expect(store.syncStates.get("stats")).toMatchObject({ isRunning: false, lastError: null });
    expect(store.syncStates.get("stats")!.cursor).toMatchObject({ affiliates: ["aff-ours"] });

    // Passage suivant : incrémental (jours récents + lignes créées depuis), rien de réimporté en double.
    calls.length = 0;
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:10:00Z") });
    expect(calls.filter((c) => c.startsWith("stats?"))).toEqual([
      "stats?date_col=date&from=2026-10-02&order=date&limit=5000&offset=0&eq.affiliate_id=aff-ours",
      "stats?date_col=created_at&from=2026-10-09&order=created_at&limit=5000&offset=0&eq.affiliate_id=aff-ours",
    ]);
    expect(store.dailyStats).toHaveLength(1);
    data.campaigns = data.campaigns.slice(0, 1).map(({ affiliate_id: _a, ...c }) => c);
    data.stats = [];
  });

  it("relecture de nuit : les 35 derniers jours par date, une fois par nuit", async () => {
    data.campaigns = [{ ...data.campaigns![0]!, affiliate_id: "aff-ours" }];
    // 1er passage (historique complet) à midi, puis 3 h 30 à Paris le lendemain : relecture profonde.
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    expect(store.syncStates.get("stats")!.cursor).toMatchObject({
      deepAt: "2026-10-09T12:00:00.000Z",
    });
    calls.length = 0;
    await runSync({ client: fakeClient, now: () => new Date("2026-10-10T01:30:00Z") });
    expect(calls.filter((c) => c.startsWith("stats?date_col=date"))).toEqual([
      "stats?date_col=date&from=2026-09-05&order=date&limit=5000&offset=0&eq.affiliate_id=aff-ours",
    ]);
    // Même nuit, 10 minutes plus tard : retour aux 7 derniers jours.
    calls.length = 0;
    await runSync({ client: fakeClient, now: () => new Date("2026-10-10T01:40:00Z") });
    expect(calls.filter((c) => c.startsWith("stats?date_col=date"))).toEqual([
      "stats?date_col=date&from=2026-10-03&order=date&limit=5000&offset=0&eq.affiliate_id=aff-ours",
    ]);
    data.campaigns = data.campaigns.slice(0, 1).map(({ affiliate_id: _a, ...c }) => c);
  });

  it("CPA inchangée : aucune lecture des événements du joueur au passage suivant", async () => {
    const original = data.players![0]!;
    data.players![0] = {
      ...original,
      cpa_status: "approved",
      cpa_affiliate_amount: 70,
      cpa_credited_at: "2026-10-04T11:36:48Z",
      updated_at: "2026-10-04T12:00:00Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-04T12:05:00Z") });
    const findMany = (h.fakePrisma.playerEvent as { findMany: ReturnType<typeof vi.fn> }).findMany;
    findMany.mockClear();
    // Resynchro complète des joueurs : la ligne est relue, sa CPA n'a pas changé.
    await runSync({ client: fakeClient, now: () => new Date("2026-10-04T12:15:00Z"), full: true });
    const cpaReads = findMany.mock.calls.filter((c) =>
      JSON.stringify(c[0]?.where ?? {}).includes("CPA_REVERSAL"),
    );
    expect(cpaReads).toEqual([]);
    expect(cpaEvents()).toEqual([["CPA", 70, "2026-10-04T11:36:48.000Z", "cpa:la1"]]);
    data.players![0] = original;
  });

  it("crédité, annulé puis crédité de nouveau : +70 / −70 / +70, l'ancien couple est gardé", async () => {
    const original = data.players![0]!;
    const credited = {
      ...original,
      cpa_status: "approved",
      cpa_affiliate_amount: 70,
      cpa_credited_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-01T10:00:00Z",
    };
    data.players![0] = credited;
    await runSync({ client: fakeClient, now: () => new Date("2026-10-01T10:05:00Z") });
    data.players![0] = {
      ...credited,
      cpa_status: "reversed",
      cpa_reversed_at: "2026-10-05T10:00:00Z",
      updated_at: "2026-10-05T10:00:00Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-05T10:05:00Z") });
    data.players![0] = {
      ...credited,
      cpa_credited_at: "2026-10-10T10:00:00Z",
      cpa_reversed_at: null,
      updated_at: "2026-10-10T10:00:00Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-10T10:05:00Z") });
    expect(cpaEvents().sort((a, b) => (String(a[3]) < String(b[3]) ? -1 : 1))).toEqual([
      ["CPA", 70, "2026-10-10T10:00:00.000Z", "cpa:la1"],
      ["CPA", 70, "2026-10-01T10:00:00.000Z", "cpa:la1:1"],
      ["CPA_REVERSAL", -70, "2026-10-05T10:00:00.000Z", "cpa_reversal:la1:1"],
    ]);
    expect(
      store.recorded.filter((e) => String(e.type).startsWith("player.cpa_")).map((e) => e.type),
    ).toEqual(["player.cpa_credited", "player.cpa_reversed", "player.cpa_credited"]);
    data.players![0] = original;
  });

  it("joueur d'un autre affilié (ni clic ni offre à nous) : commission gardée, aucune entrée de journal", async () => {
    const original = data.players![0]!;
    data.players![0] = {
      ...original,
      sub_id: null,
      cpa_status: "approved",
      cpa_affiliate_amount: 500,
      cpa_credited_at: "2026-10-04T11:36:48Z",
      updated_at: "2026-10-04T12:00:00Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-04T12:05:00Z") });
    expect(cpaEvents()).toEqual([["CPA", 500, "2026-10-04T11:36:48.000Z", "cpa:la1"]]);
    expect(store.recorded.filter((e) => String(e.type).startsWith("player.cpa_"))).toEqual([]);
    // La même offre rattachée à une de nos campagnes : le joueur devient le nôtre, sa prochaine commission est
    // journalisée.
    store.ourCampaigns.push({ affiliateCampaignIds: [store.campaigns[0]!.id] });
    data.players![0] = {
      ...data.players![0]!,
      cpa_status: "reversed",
      cpa_reversed_at: "2026-10-06T06:17:01Z",
      updated_at: "2026-10-06T06:17:02Z",
    };
    await runSync({ client: fakeClient, now: () => new Date("2026-10-06T06:20:00Z") });
    expect(
      store.recorded.filter((e) => String(e.type).startsWith("player.cpa_")).map((e) => e.type),
    ).toEqual(["player.cpa_reversed"]);
    data.players![0] = original;
  });

  it("une campagne Telegram d'affilié (phase 13) n'est jamais importée comme offre ; la synchro générale reste verte", async () => {
    data.campaigns!.push({
      id: "tg1",
      campaign_key: "tgPaul01",
      name: "Paul VIP",
      type: "telegram",
      casino_id: null,
      invite_link_id: "link-paul",
    });
    try {
      const r = await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
      expect(r.every((x) => x.ok)).toBe(true);
      expect(store.campaigns.map((c) => c.externalId)).toEqual(["camp1"]);
      expect(store.programs.map((p) => p.externalId)).toEqual(["cas1"]);
      // La lecture Telegram n'ajoute aucune table au résultat ni au suivi des tables (alerte `sync_failed`).
      expect(r.map((x) => x.table)).not.toContain("telegram");
      expect([...store.syncStates.keys()].some((k) => k.startsWith("telegram"))).toBe(false);
    } finally {
      data.campaigns!.pop();
    }
  });

  it("garde la table de taux Link Affi pour la reprise des gains", async () => {
    await runSync({ client: fakeClient, now: () => new Date("2026-10-09T12:00:00Z") });
    expect(store.settings.get("linkaffi.currencyRates")?.value).toEqual({ EUR: 1 });
  });
});
