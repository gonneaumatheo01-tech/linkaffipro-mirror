import { describe, expect, it } from "vitest";
import { cpaEvents, cpaStateFromRow, effectiveCpaDates } from "@linkaffipro/core";
import { buildRateTable, mapPlayer, type PlayerInput } from "@linkaffipro/linkaffi";
import { applyPlayerRow, diffCpaEvents, type ExistingPlayer } from "./player-apply";

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
  cpaStatus: null,
  cpaAmount: null,
  cpaCreditedAt: null,
  cpaReversedAt: null,
  qualifiedAt: null,
  disqualifiedAt: null,
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

describe("commission CPA du joueur", () => {
  const credited = new Date("2026-10-04T13:42:27Z");
  const reversed = new Date("2026-10-06T06:17:01Z");

  it("recopie le statut et le montant, applique les replis de date et prépare les événements", () => {
    const c = applyPlayerRow(existing, {
      ...base,
      cpaStatus: "reversed",
      cpaAmount: 70,
      cpaCreditedAt: null,
      qualifiedAt: credited,
      cpaReversedAt: reversed,
    });
    expect(c.data).toMatchObject({
      cpaStatus: "reversed",
      cpaAmount: 70,
      cpaCreditedAt: credited,
      cpaReversedAt: reversed,
    });
    expect(c.cpaEvents.map((e) => [e.type, e.amount, e.occurredAt, e.externalId])).toEqual([
      ["CPA", 70, credited, "cpa:la1"],
      ["CPA_REVERSAL", -70, reversed, "cpa_reversal:la1"],
    ]);
  });

  it("sans commission (statut none) : champs vides, aucun événement", () => {
    const c = applyPlayerRow(null, { ...base, cpaStatus: "none", cpaAmount: 70 });
    expect(c.data).toMatchObject({ cpaStatus: "none", cpaAmount: 70, cpaCreditedAt: null, cpaReversedAt: null });
    expect(c.cpaEvents).toEqual([]);
  });

  it("diff idempotent : rien à écrire quand tout est déjà là ; annulation ajoutée ; ancienne commission retirée", () => {
    const desired = applyPlayerRow(existing, {
      ...base,
      cpaStatus: "reversed",
      cpaAmount: 70,
      cpaCreditedAt: credited,
      cpaReversedAt: reversed,
    }).cpaEvents;
    const stored = desired.map((e) => ({ id: e.externalId, ...e }));
    expect(diffCpaEvents(stored, desired)).toEqual({ upserts: [], deletes: [], renames: [], created: [], days: [] });

    // Seule la CPA était connue : l'annulation est ajoutée, le jour de l'annulation (Paris) est à recalculer.
    const onlyCredit = stored.filter((e) => e.type === "CPA");
    const d1 = diffCpaEvents(onlyCredit, desired);
    expect(d1.upserts.map((e) => e.externalId)).toEqual(["cpa_reversal:la1"]);
    expect(d1.deletes).toEqual([]);
    expect(d1.days).toEqual(["2026-10-06"]);

    // Montant corrigé par Link Affi : réécrit ; statut repassé à « none » : les deux événements sont retirés.
    const changed = diffCpaEvents(onlyCredit, [{ ...desired[0]!, amount: 80 }]);
    expect(changed.upserts.map((e) => e.amount)).toEqual([80]);
    expect(changed.days).toEqual(["2026-10-04"]);
    const gone = diffCpaEvents(stored, []);
    expect(gone.deletes.sort()).toEqual(["cpa:la1", "cpa_reversal:la1"]);
    expect(gone.days.sort()).toEqual(["2026-10-04", "2026-10-06"]);

    // Un événement d'un autre type ou d'une autre origine n'est jamais retiré.
    expect(diffCpaEvents([{ id: "x", externalId: "registration:1", type: "CPA", amount: 1, occurredAt: credited }], []).deletes).toEqual([]);
  });
});

describe("une seule règle pour la CPA : synchro (mapPlayer) et reprise (cpaStateFromRow)", () => {
  const rates = buildRateTable([{ currency: "USD", rate: 1.25 }]);
  const row = {
    id: "la-x",
    external_player_id: "9002",
    cpa_status: "reversed",
    cpa_affiliate_amount: "70",
    cpa_credited_at: null,
    qualified_at: "2026-10-04T12:01:03Z",
    cpa_reversed_at: "2026-10-06T06:17:01Z",
    updated_at: "2026-10-06T06:17:02Z",
  };
  for (const [label, r] of [
    ["sans devise (EUR)", row],
    ["en dollars", { ...row, currency: "USD", cpa_affiliate_amount: 100 }],
    ["devise inconnue", { ...row, currency: "GBP", cpa_affiliate_amount: 50.004 }],
    ["approuvée", { ...row, cpa_status: "approved", cpa_reversed_at: null, cpa_credited_at: "2026-10-02T10:00:00Z" }],
  ] as const) {
    it(`même montant, mêmes dates, mêmes événements : ${label}`, () => {
      const viaSync = applyPlayerRow(null, mapPlayer(r, rates)!);
      const state = cpaStateFromRow(r, rates)!;
      const dates = effectiveCpaDates(state);
      expect(viaSync.data).toMatchObject({
        cpaStatus: state.status,
        cpaAmount: state.amount,
        cpaCreditedAt: dates.creditedAt,
        cpaReversedAt: dates.reversedAt,
      });
      expect(viaSync.cpaEvents).toEqual(cpaEvents(state));
    });
  }
});
