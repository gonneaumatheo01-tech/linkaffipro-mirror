import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = {
    broadcast: {} as Row,
    members: [] as Row[],
    outbound: [] as Row[],
    posts: [] as Row[],
    enqueued: [] as Array<{ queue: string; data: Row; opts: Row }>,
    /** Identifiants des envois appartenant au groupe A/B simulé. */
    groupBroadcastIds: new Set<string>(),
  };
  let seq = 0;
  const prisma = {
    broadcast: {
      findUnique: vi.fn(async () => ({ ...state.broadcast })),
      update: vi.fn(async ({ data }: { data: Row }) => {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as Row)) state.broadcast[k] = ((state.broadcast[k] as number) ?? 0) + ((v as Row).increment as number);
          else state.broadcast[k] = v;
        }
        return state.broadcast;
      }),
      findMany: vi.fn(async () => [{ id: state.broadcast.id }]),
    },
    setting: { findUnique: vi.fn(async () => null) },
    post: { findFirst: vi.fn(async () => state.posts[0] ?? null) },
    outboundMessage: {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        const bc = where.broadcast as { abGroupId?: string; id?: { not?: string } } | undefined;
        if (bc) return state.outbound.filter((o) => state.groupBroadcastIds.has(String(o.broadcastId)) && o.broadcastId !== bc.id?.not);
        return state.outbound.filter((o) => o.broadcastId === where.broadcastId);
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `om${++seq}`, status: "QUEUED", ...data };
        state.outbound.push(row);
        return { id: row.id };
      }),
      count: vi.fn(async ({ where }: { where: Row }) => state.outbound.filter((o) => o.broadcastId === where.broadcastId && o.status === where.status).length),
      groupBy: vi.fn(async ({ where }: { where: Row }) => {
        const rows = state.outbound.filter((o) => o.broadcastId === where.broadcastId);
        const by = new Map<string, number>();
        for (const r of rows) by.set(r.status as string, (by.get(r.status as string) ?? 0) + 1);
        return [...by.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
    },
    member: {
      findMany: vi.fn(async ({ take, cursor, skip }: { take: number; cursor?: { id: string }; skip?: number }) => {
        const sorted = [...state.members].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        let start = 0;
        if (cursor) start = sorted.findIndex((m) => m.id === cursor.id) + (skip ?? 0);
        return sorted.slice(start, start + take);
      }),
    },
  };
  const enqueue = vi.fn(async (queue: string, data: Row, opts: Row) => {
    state.enqueued.push({ queue, data, opts });
  });
  return { state, prisma, enqueue };
});

vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, recordEvent: vi.fn(async () => undefined), toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: db.enqueue }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { expandBroadcast } from "./expand";
import { closeIfFinished, recordBroadcastOutcome } from "./progress";
import { resolveBroadcastButtons } from "./buttons";

function reset(n: number) {
  db.state.broadcast = { id: "b1", botId: "bot1", status: "SCHEDULED", startedAt: null, text: "Salut", buttons: [], segment: {}, targeted: 0, sent: 0, failed: 0, blocked: 0, bot: { username: "casinobot" } };
  db.state.members = Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(4, "0")}`, players: [] }));
  db.state.outbound = [];
  db.state.posts = [];
  db.state.enqueued = [];
  db.state.groupBroadcastIds = new Set();
  vi.clearAllMocks();
}

describe("développement d'un envoi groupé", () => {
  beforeEach(() => reset(1203));

  it("crée un message et un job par destinataire, par lots de 500", async () => {
    const r = await expandBroadcast("b1");
    expect(r).toEqual({ targeted: 1203, created: 1203 });
    expect(db.state.outbound).toHaveLength(1203);
    expect(db.state.enqueued).toHaveLength(1203);
    expect(db.state.enqueued[0]).toMatchObject({ queue: "telegram-send", data: { type: "dm", outboundMessageId: "om1" }, opts: { jobId: "dm-om1" } });
    expect(db.prisma.member.findMany).toHaveBeenCalledTimes(3);
    expect(db.state.broadcast.status).toBe("SENDING");
    expect(db.state.broadcast.targeted).toBe(1203);
  });

  it("recopie le média de l'envoi sur chaque message privé", async () => {
    db.state.broadcast.mediaAssetId = "asset1";
    db.state.members = [{ id: "m1" }, { id: "m2" }];
    const r = await expandBroadcast("b1");
    expect(r.created).toBe(2);
    expect(db.state.outbound.every((o) => o.mediaAssetId === "asset1")).toBe(true);
  });

  it("est idempotent : un second développement ne recrée rien", async () => {
    await expandBroadcast("b1");
    const r = await expandBroadcast("b1");
    expect(r).toEqual({ targeted: 1203, created: 0 });
    expect(db.state.outbound).toHaveLength(1203);
  });

  it("filtre le niveau de dépense après requête", async () => {
    reset(3);
    db.state.broadcast.segment = { spendLevels: ["VIP"] };
    db.state.members[1]!.players = [{ registeredAt: new Date(), depositCount: 2, depositTotal: 900 }];
    const r = await expandBroadcast("b1");
    expect(r.targeted).toBe(1);
    expect(db.state.outbound[0]!.memberId).toBe("m0001");
  });

  it("clôture immédiatement un envoi sans destinataire", async () => {
    reset(0);
    await expandBroadcast("b1");
    expect(db.state.broadcast.status).toBe("SENT");
  });

  it("ne touche pas à un envoi annulé", async () => {
    db.state.broadcast.status = "CANCELLED";
    const r = await expandBroadcast("b1");
    expect(r.created).toBe(0);
    expect(db.state.outbound).toHaveLength(0);
  });
});

describe("test A/B", () => {
  beforeEach(() => reset(1000));

  it("répartit les destinataires selon la part, de façon disjointe et complète", async () => {
    db.state.broadcast = { ...db.state.broadcast, id: "bA", abGroupId: "grp1", abVariant: "A", abSplit: 30 };
    const a = await expandBroadcast("bA");
    const idsA = new Set(db.state.outbound.map((o) => o.memberId as string));
    expect(Math.abs(a.targeted - 300)).toBeLessThanOrEqual(50);

    db.state.outbound = [];
    db.state.broadcast = { ...db.state.broadcast, id: "bB", abGroupId: "grp1", abVariant: "B", abSplit: 70, targeted: 0 };
    const b = await expandBroadcast("bB");
    const idsB = new Set(db.state.outbound.map((o) => o.memberId as string));
    expect(a.targeted + b.targeted).toBe(1000);
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
  });

  it("l'envoi au reste exclut les membres déjà servis par le test", async () => {
    db.state.broadcast = { ...db.state.broadcast, id: "bA", abGroupId: "grp1", abVariant: "A", abSplit: 50 };
    await expandBroadcast("bA");
    const servedA = db.state.outbound.length;
    db.state.groupBroadcastIds = new Set(["bA"]);
    db.state.broadcast = { ...db.state.broadcast, id: "bRest", abGroupId: "grp1", abVariant: "REST", abSplit: null, targeted: 0 };
    const rest = await expandBroadcast("bRest");
    expect(rest.targeted).toBe(1000 - servedA);
    const servedIds = new Set(db.state.outbound.filter((o) => o.broadcastId === "bA").map((o) => o.memberId));
    for (const o of db.state.outbound.filter((o) => o.broadcastId === "bRest")) expect(servedIds.has(o.memberId)).toBe(false);
  });
});

describe("progression", () => {
  beforeEach(() => reset(2));

  it("compte les issues et passe SENT quand plus rien n'est en attente", async () => {
    await expandBroadcast("b1");
    db.state.outbound[0]!.status = "SENT";
    await recordBroadcastOutcome("b1", "SENT");
    expect(db.state.broadcast.sent).toBe(1);
    expect(db.state.broadcast.status).toBe("SENDING");
    db.state.outbound[1]!.status = "BLOCKED";
    await recordBroadcastOutcome("b1", "BLOCKED");
    expect(db.state.broadcast.status).toBe("SENT");
    expect(db.state.broadcast.blocked).toBe(1);
    expect(db.state.broadcast.finishedAt).toBeInstanceOf(Date);
  });

  it("ignore les messages hors envoi groupé", async () => {
    await recordBroadcastOutcome(null, "SENT");
    expect(db.prisma.broadcast.update).not.toHaveBeenCalled();
  });

  it("closeIfFinished laisse ouvert tant qu'il reste des QUEUED", async () => {
    await expandBroadcast("b1");
    expect(await closeIfFinished("b1")).toBe(false);
  });
});

describe("boutons d'un envoi groupé", () => {
  it("résout URL, lien traqué et offre vers des lignes { text, url }", () => {
    const rows = resolveBroadcastButtons(
      [[{ text: "Site", type: "URL", url: "https://ex.com" }, { text: "Traqué", type: "BUTTON", slug: "abc" }], [{ text: "Offre", type: "OFFER", slug: "off" }], [{ text: "Cassé", type: "URL", url: "javascript:x" }]],
      { trackingBaseUrl: "https://go.goolink.eu/", botUsername: "casinobot", postCode: "P1" },
    );
    expect(rows).toEqual([
      [{ text: "Site", url: "https://ex.com" }, { text: "Traqué", url: "https://go.goolink.eu/abc" }],
      [{ text: "Offre", url: "https://t.me/casinobot?start=ooff_P1" }],
    ]);
  });
});
