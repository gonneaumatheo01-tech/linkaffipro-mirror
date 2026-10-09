import { describe, expect, it } from "vitest";
import type { PlayerInput } from "@linkaffipro/linkaffi";
import { applyPlayerRow, type ExistingPlayer } from "./player-apply";

const base: PlayerInput = {
  externalId: "la1",
  campaignExternalId: "k1",
  programExternalId: "c1",
  externalPlayerId: "241253",
  subId: "AbC123def456",
  subIdSource: "time_match",
  registeredAt: new Date("2026-10-01T10:00:00Z"),
  ftdAt: null,
  ftdAmount: null,
  depositCount: 0,
  redepositCount: 0,
  depositTotal: 0,
  status: "registered",
  lastEventAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  raw: { id: "la1" },
};

const existing: ExistingPlayer = {
  id: "p1",
  subId: "AbC123def456",
  subIdSource: "time_match",
  updatedAt: new Date("2026-10-01T10:00:00Z"),
  registeredAt: new Date("2026-10-01T10:00:00Z"),
  ftdAt: null,
  depositCount: 0,
  depositTotal: 0,
  ngr: 0,
  memberId: "m1",
  clickId: "c1",
};

describe("applyPlayerRow", () => {
  it("émet player.registered pour un nouveau joueur et rien d'autre", () => {
    const c = applyPlayerRow(null, base);
    expect(c.events.map((e) => e.type)).toEqual(["player.registered"]);
    expect(c.subIdChanged).toBe(true);
    expect(c.data.subIdSource).toBe("time_match");
  });
  it("n'émet rien si rien ne change (idempotent)", () => {
    const c = applyPlayerRow(existing, base);
    expect(c.events).toEqual([]);
    expect(c.subIdChanged).toBe(false);
  });
  it("émet player.ftd puis player.deposit sur un vrai changement", () => {
    const c = applyPlayerRow(existing, { ...base, ftdAt: new Date("2026-10-02T00:00:00Z"), ftdAmount: 20, depositCount: 1, depositTotal: 20, updatedAt: new Date("2026-10-02T00:00:00Z") });
    expect(c.events).toEqual([{ type: "player.ftd", amount: 20 }, { type: "player.deposit", amount: 20 }]);
    const c2 = applyPlayerRow({ ...existing, ftdAt: new Date("2026-10-02T00:00:00Z"), depositCount: 1, depositTotal: 20 }, { ...base, ftdAt: new Date("2026-10-02T00:00:00Z"), ftdAmount: 20, depositCount: 2, depositTotal: 50 });
    expect(c2.events).toEqual([{ type: "player.deposit", amount: 30 }]);
  });
  it("les cumuls ne reculent jamais", () => {
    const c = applyPlayerRow({ ...existing, depositCount: 3, depositTotal: 100 }, { ...base, depositCount: 1, depositTotal: 20 });
    expect(c.data.depositCount).toBe(3);
    expect(c.data.depositTotal).toBe(100);
    expect(c.events).toEqual([]);
  });
  it("un sub-ID postback remplace un time_match, pas l'inverse", () => {
    const up = applyPlayerRow(existing, { ...base, subId: "ZZZ999zzz000", subIdSource: "postback", updatedAt: new Date("2026-10-03T00:00:00Z") });
    expect(up.data).toMatchObject({ subId: "ZZZ999zzz000", subIdSource: "postback" });
    expect(up.subIdChanged).toBe(true);
    const down = applyPlayerRow({ ...existing, subIdSource: "postback" }, { ...base, subId: "ZZZ999zzz000", subIdSource: "time_match", updatedAt: new Date("2026-10-03T00:00:00Z") });
    expect(down.data).toMatchObject({ subId: "AbC123def456", subIdSource: "postback" });
    expect(down.subIdChanged).toBe(false);
  });
});
