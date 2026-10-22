import { describe, expect, it } from "vitest";
import { buildRateTable, chooseSubId, keepUuidIds, mapCampaign, mapCasino, mapClick, mapDepositSnapshot, mapEventType, mapFtdInvalidation, mapPlayer, mapPlayerEvent, mapRevshareSnapshot, toEur, trackingUrlTemplateFor } from "./mapping";

const rates = buildRateTable([
  { currency: "EUR", rate: 1 },
  { currency: "USD", rate: 1.1634 },
  { currency: "xx", rate: 0 },
]);

describe("taux et conversion", () => {
  it("construit la table avec EUR = 1 et ignore les taux invalides", () => {
    expect(rates).toEqual({ EUR: 1, USD: 1.1634 });
  });
  it("convertit en EUR et arrondit au centime", () => {
    expect(toEur(116.34, "USD", rates)).toBe(100);
    expect(toEur(10, "eur", rates)).toBe(10);
    expect(toEur(10, "ZZZ", rates)).toBe(10);
    expect(toEur(null, "USD", rates)).toBeNull();
  });
});

describe("casinos et campagnes", () => {
  it("mappe un casino", () => {
    expect(mapCasino({ id: "c1", name: "Casino A", is_active: true })).toMatchObject({
      source: "LINKAFFI",
      externalId: "c1",
      name: "Casino A",
      isActive: true,
    });
    expect(mapCasino({ id: "c2", is_active: false })).toMatchObject({
      name: "c2",
      isActive: false,
    });
    expect(mapCasino({ name: "sans id" })).toBeNull();
  });
  it("mappe une campagne avec le modèle d'URL sub_id", () => {
    const c = mapCampaign({
      id: "k1",
      campaign_key: "47eb8mwc",
      name: "TT 1",
      casino_id: "c1",
      domain: "linkaffi.me",
    });
    expect(c).toMatchObject({
      externalId: "k1",
      campaignKey: "47eb8mwc",
      programExternalId: "c1",
      trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
    });
    expect(trackingUrlTemplateFor(null, "abc")).toBe("https://linkaffi.me/go/abc?sub_id={subid}");
    expect(trackingUrlTemplateFor("https://mystakesport.fr/", "abc")).toBe(
      "https://mystakesport.fr/go/abc?sub_id={subid}",
    );
    expect(mapCampaign({ id: "k2" })).toBeNull();
  });
});

describe("joueurs", () => {
  const row = {
    id: "p1",
    casino_id: "c1",
    campaign_id: "k1",
    external_player_id: 241253,
    sub_id: "AbC123def456",
    sub_id_source: "postback",
    status: "ftd_qualified",
    ftd_amount: 20,
    ftd_at: "2026-10-08T18:24:16.660Z",
    all_deposits_count: 3,
    total_deposited_amount: 120,
    redeposits_count: 2,
    last_activity_at: "2026-10-09T09:11:02.635Z",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-09T09:11:02.635Z",
  };
  it("mappe un joueur complet", () => {
    const p = mapPlayer(row, rates)!;
    expect(p).toMatchObject({
      externalId: "p1",
      externalPlayerId: "241253",
      subId: "AbC123def456",
      subIdSource: "postback",
      depositCount: 3,
      redepositCount: 2,
      depositTotal: 120,
      ftdAmount: 20,
      status: "ftd_qualified",
      campaignExternalId: "k1",
      programExternalId: "c1",
    });
    expect(p.registeredAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(p.ftdAt?.toISOString()).toBe("2026-10-08T18:24:16.660Z");
  });
  it("tolère les colonnes manquantes", () => {
    const p = mapPlayer({ id: "p2", external_player_id: "7" })!;
    expect(p).toMatchObject({
      subId: null,
      subIdSource: null,
      depositCount: 0,
      depositTotal: 0,
      ftdAt: null,
      ftdAmount: null,
      registeredAt: null,
    });
    expect(mapPlayer({ id: "p3" })).toBeNull();
  });
  it("ignore une source sans sub_id et normalise la source", () => {
    expect(
      mapPlayer({ id: "p4", external_player_id: "1", sub_id: null, sub_id_source: "postback" })!
        .subIdSource,
    ).toBeNull();
    expect(
      mapPlayer({ id: "p5", external_player_id: "1", sub_id: "X", sub_id_source: "TIME_MATCH" })!
        .subIdSource,
    ).toBe("time_match");
    expect(
      mapPlayer({ id: "p6", external_player_id: "1", sub_id: "X", sub_id_source: "autre" })!
        .subIdSource,
    ).toBeNull();
  });
});

describe("précédence du sub-ID", () => {
  const d1 = new Date("2026-10-01T00:00:00Z");
  const d2 = new Date("2026-10-02T00:00:00Z");
  it("postback remplace time_match", () => {
    expect(
      chooseSubId(
        { subId: "A", subIdSource: "time_match", updatedAt: d2 },
        { subId: "B", subIdSource: "postback", updatedAt: d1 },
      ),
    ).toEqual({ subId: "B", subIdSource: "postback" });
  });
  it("time_match ne remplace pas postback", () => {
    expect(
      chooseSubId(
        { subId: "A", subIdSource: "postback", updatedAt: d1 },
        { subId: "B", subIdSource: "time_match", updatedAt: d2 },
      ),
    ).toEqual({ subId: "A", subIdSource: "postback" });
  });
  it("à source égale, la plus récente gagne", () => {
    expect(
      chooseSubId(
        { subId: "A", subIdSource: "postback", updatedAt: d1 },
        { subId: "B", subIdSource: "postback", updatedAt: d2 },
      ),
    ).toEqual({ subId: "B", subIdSource: "postback" });
    expect(
      chooseSubId(
        { subId: "A", subIdSource: "postback", updatedAt: d2 },
        { subId: "B", subIdSource: "postback", updatedAt: d1 },
      ),
    ).toEqual({ subId: "A", subIdSource: "postback" });
  });
  it("null n'écrase jamais une valeur", () => {
    expect(
      chooseSubId(
        { subId: "A", subIdSource: "time_match", updatedAt: d1 },
        { subId: null, subIdSource: null, updatedAt: d2 },
      ),
    ).toEqual({ subId: "A", subIdSource: "time_match" });
    expect(
      chooseSubId(
        { subId: null, subIdSource: null, updatedAt: null },
        { subId: "B", subIdSource: null, updatedAt: d2 },
      ),
    ).toEqual({ subId: "B", subIdSource: null });
  });
});

describe("événements joueurs", () => {
  it("mappe les types", () => {
    expect(mapEventType("registration", null)).toBe("REGISTRATION");
    expect(mapEventType("ftd", null)).toBe("FTD");
    expect(mapEventType("any_dep", { is_redeposit: true })).toBe("REDEPOSIT");
    expect(mapEventType("any_dep", { is_redeposit: false })).toBe("DEPOSIT");
    expect(mapEventType("prequalification", null)).toBe("OTHER");
    expect(mapEventType(undefined, null)).toBe("OTHER");
  });
  it("une seule source de NGR daté : les « revenue » / « ngr » de player_events ne deviennent pas des NGR (les instantanés font foi)", () => {
    expect(mapEventType("revenue", null)).toBe("OTHER");
    expect(mapEventType("ngr", null)).toBe("OTHER");
    expect(
      mapPlayerEvent({
        id: "r1",
        player_id: "p1",
        event: "revenue",
        amount: 12,
        created_at: "2026-10-09T09:11:02.635Z",
      })?.type,
    ).toBe("OTHER");
  });
  it("garde le montant du dépôt (delta) et non le cumul", () => {
    const e = mapPlayerEvent({
      id: "e1",
      player_id: "p1",
      event: "any_dep",
      amount: 120,
      currency: "EUR",
      idempotency_key: "dep:241253:3",
      details: { is_redeposit: true, redeposit_delta: 40, cumulative_before: 80 },
      created_at: "2026-10-09T09:11:02.635Z",
    })!;
    expect(e).toMatchObject({
      playerExternalId: "p1",
      type: "REDEPOSIT",
      amount: 40,
      currency: "EUR",
      externalId: "dep:241253:3",
    });
    const e2 = mapPlayerEvent({
      id: "e2",
      player_id: "p1",
      event: "any_dep",
      amount: 120,
      details: { cumulative_before: 100 },
      created_at: "2026-10-09T09:11:02.635Z",
    })!;
    expect(e2.amount).toBe(20);
  });
  it("convertit la devise et retombe sur l'id sans clé d'idempotence", () => {
    const e = mapPlayerEvent(
      {
        id: "e3",
        player_id: "p1",
        event: "ftd",
        amount: 116.34,
        currency: "USD",
        created_at: "2026-10-09T09:11:02.635Z",
      },
      rates,
    )!;
    expect(e).toMatchObject({ type: "FTD", amount: 100, externalId: "e3" });
    expect(mapPlayerEvent({ id: "e4", event: "ftd" })).toBeNull();
  });
});

describe("snapshots, invalidations, clics", () => {
  it("mappe le NGR et les dépôts cumulés par identifiant externe", () => {
    expect(
      mapRevshareSnapshot({
        player_id: 239831,
        casino_id: "c1",
        last_ngr: 18.0036,
        last_seen_at: "2026-10-09T00:01:58Z",
      }),
    ).toMatchObject({ programExternalId: "c1", externalPlayerId: "239831", ngr: 18 });
    expect(
      mapDepositSnapshot({ player_id: "145468", casino_id: "c1", last_total: 1253.51 }),
    ).toEqual({
      programExternalId: "c1",
      externalPlayerId: "145468",
      depositTotal: 1253.51,
      at: null,
    });
    expect(
      mapDepositSnapshot({
        player_id: "145468",
        casino_id: "c1",
        last_total: 10,
        last_seen_at: "2026-10-08T07:00:00Z",
      })?.at,
    ).toEqual(new Date("2026-10-08T07:00:00Z"));
    expect(mapRevshareSnapshot({ casino_id: "c1" })).toBeNull();
  });
  it("mappe une invalidation de FTD", () => {
    expect(
      mapFtdInvalidation({
        id: "i1",
        player_id: 223093,
        casino_id: "c1",
        reason: "non validé",
        created_at: "2026-09-27T02:24:56Z",
      }),
    ).toMatchObject({
      programExternalId: "c1",
      externalPlayerId: "223093",
      reason: "non validé",
      externalId: "ftd_invalidation:i1",
    });
  });
  it("ne garde que les clics avec sub_id", () => {
    expect(mapClick({ id: "x", sub_id: null })).toBeNull();
    expect(
      mapClick({
        id: "x",
        sub_id: "AbC123def456",
        campaign_id: "k1",
        created_at: "2026-10-09T12:00:00Z",
      }),
    ).toMatchObject({ subId: "AbC123def456", campaignExternalId: "k1" });
  });
});

describe("keepUuidIds", () => {
  it("garde les uuid et ecarte les slugs de demo", () => {
    expect(keepUuidIds(["0544e2ee-28e4-4ca8-b160-5b910a95fb8d", "demo-affilie", ""])).toEqual([
      "0544e2ee-28e4-4ca8-b160-5b910a95fb8d",
    ]);
  });
  it("accepte la casse haute", () => {
    expect(keepUuidIds(["0544E2EE-28E4-4CA8-B160-5B910A95FB8D"])).toHaveLength(1);
  });
});
