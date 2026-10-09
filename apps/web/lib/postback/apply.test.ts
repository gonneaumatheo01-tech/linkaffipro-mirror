import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const players: Row[] = [];
  const events: Row[] = [];
  const logs: Row[] = [];
  const campaigns: Row[] = [];
  const clicks: Row[] = [];
  let seq = 0;
  const id = () => `id${++seq}`;
  const prisma = {
    click: { findUnique: vi.fn(async ({ where }: { where: { subId: string } }) => clicks.find((c) => c.subId === where.subId) ?? null) },
    affiliateCampaign: {
      upsert: vi.fn(async ({ where, create }: { where: { programId_externalId: { programId: string; externalId: string } }; create: Row }) => {
        let c = campaigns.find((x) => x.programId === where.programId_externalId.programId && x.externalId === where.programId_externalId.externalId);
        if (!c) {
          c = { id: id(), ...create };
          campaigns.push(c);
        }
        return { id: c.id };
      }),
    },
    player: {
      findUnique: vi.fn(async ({ where }: { where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: string; externalPlayerId: string } } }) =>
        players.find((p) => p.affiliateCampaignId === where.affiliateCampaignId_externalPlayerId.affiliateCampaignId && p.externalPlayerId === where.affiliateCampaignId_externalPlayerId.externalPlayerId) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const p = { id: id(), depositCount: 0, depositTotal: 0, ngr: 0, redepositCount: 0, registeredAt: null, ftdAt: null, subId: null, subIdSource: null, memberId: null, clickId: null, updatedAt: new Date(), ...data };
        players.push(p);
        return p;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const p = players.find((x) => x.id === where.id)!;
        Object.assign(p, data, { updatedAt: new Date() });
        return p;
      }),
    },
    playerEvent: {
      findUnique: vi.fn(async ({ where }: { where: { playerId_externalId: { playerId: string; externalId: string } } }) =>
        events.find((e) => e.playerId === where.playerId_externalId.playerId && e.externalId === where.playerId_externalId.externalId) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const e = { id: id(), ...data };
        events.push(e);
        return e;
      }),
    },
    postbackLog: { create: vi.fn(async ({ data }: { data: Row }) => logs.push(data)) },
    postbackEndpoint: { update: vi.fn(async () => undefined) },
  };
  return { prisma, players, events, logs, campaigns, clicks, recorded: [] as Row[] };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: db.prisma,
  recordEvent: vi.fn(async (e: Row) => {
    db.recorded.push(e);
  }),
  toJsonValue: (v: unknown) => v,
}));

import { handlePostback } from "./apply";

const endpoint = { id: "ep1", name: "Celsius", programId: "prog1", mapping: {}, isActive: true };

beforeEach(() => {
  db.players.length = 0;
  db.events.length = 0;
  db.logs.length = 0;
  db.campaigns.length = 0;
  db.clicks.length = 0;
  db.recorded.length = 0;
});

describe("application d'un postback", () => {
  it("crée le joueur, rattache par sub_id et émet les événements", async () => {
    db.clicks.push({ id: "clk1", subId: "SUB1", memberId: "m1", postId: "p1", trackingLink: { affiliateCampaignId: "camp1" } });
    const r1 = await handlePostback(endpoint, { sub_id: "SUB1", player_id: "42", event: "registration" }, "h");
    expect(r1.status).toBe("ACCEPTED");
    expect(db.players[0]).toMatchObject({ affiliateCampaignId: "camp1", memberId: "m1", clickId: "clk1", subId: "SUB1", subIdSource: "postback" });
    const r2 = await handlePostback(endpoint, { sub_id: "SUB1", player_id: "42", event: "ftd", amount: "20,00" }, "h");
    expect(r2.status).toBe("ACCEPTED");
    expect(db.players[0]).toMatchObject({ depositCount: 1, depositTotal: 20 });
    expect(db.players[0]!.ftdAt).toBeInstanceOf(Date);
    expect(db.recorded.map((e) => e.type)).toEqual(["player.registered", "player.ftd", "player.deposit"]);
    expect(db.recorded[0]).toMatchObject({ memberId: "m1" });
    expect(db.logs).toHaveLength(2);
    expect(db.logs.every((l) => l.status === "ACCEPTED")).toBe(true);
  });

  it("ignore un doublon et cumule les dépôts suivants", async () => {
    await handlePostback(endpoint, { player_id: "7", event: "deposit", amount: "10", txid: "T1" }, null);
    const dup = await handlePostback(endpoint, { player_id: "7", event: "deposit", amount: "10", txid: "T1" }, null);
    expect(dup.status).toBe("IGNORED");
    await handlePostback(endpoint, { player_id: "7", event: "deposit", amount: "5", txid: "T2" }, null);
    expect(db.players[0]).toMatchObject({ depositCount: 2, depositTotal: 15, redepositCount: 1 });
    // sans sub_id : campagne directe de l'endpoint
    expect(db.campaigns[0]).toMatchObject({ externalId: "postback:ep1" });
    expect(db.players[0]!.memberId).toBeNull();
  });

  it("journalise une erreur de paramètres sans lever", async () => {
    const r = await handlePostback(endpoint, { event: "ftd" }, null);
    expect(r.status).toBe("ERROR");
    expect(r.message).toMatch(/player_id/);
    expect(db.logs[0]).toMatchObject({ status: "ERROR" });
  });

  it("additionne le NGR et ne touche pas aux dépôts", async () => {
    await handlePostback(endpoint, { player_id: "9", event: "revenue", amount: "4.5", txid: "a" }, null);
    await handlePostback(endpoint, { player_id: "9", event: "revenue", amount: "-1", txid: "b" }, null);
    expect(db.players[0]).toMatchObject({ ngr: 3.5, depositCount: 0 });
  });
});
