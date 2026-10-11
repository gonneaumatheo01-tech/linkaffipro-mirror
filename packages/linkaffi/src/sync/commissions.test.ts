import { describe, expect, it } from "vitest";
import { buildRateTable, mapPlayer, mapStat, ourAffiliateIds } from "./mapping";
import {
  SYNC_TABLES,
  STATS_DEEP_DAYS,
  STATS_RECENT_DAYS,
  statsDeepDue,
  statsQueries,
} from "./window";

/** Ligne `players` telle que lue le 11 octobre 2026 (valeurs anonymisées). */
const reversedRow = {
  id: "pl-rev",
  external_player_id: "9001",
  casino_id: "cas-1",
  campaign_id: "camp-1",
  affiliate_id: "aff-1",
  status: "ftd_disqualified",
  cpa_status: "reversed",
  cpa_affiliate_amount: 70,
  cpa_credited_at: "2026-10-04T13:42:27.32203+00:00",
  cpa_reversed_at: "2026-10-06T06:17:01.773859+00:00",
  qualified_at: "2026-10-04T18:00:04.24471+00:00",
  disqualified_at: "2026-10-06T06:17:01.773859+00:00",
  created_at: "2026-10-03T10:00:00Z",
  updated_at: "2026-10-06T06:17:02Z",
};

describe("joueurs : champs de commission", () => {
  it("recopie le statut, le montant (part affilié, EUR) et les dates de crédit et d'annulation", () => {
    const p = mapPlayer(reversedRow)!;
    expect(p.cpaStatus).toBe("reversed");
    expect(p.cpaAmount).toBe(70);
    expect(p.cpaCreditedAt?.toISOString()).toBe("2026-10-04T13:42:27.322Z");
    expect(p.cpaReversedAt?.toISOString()).toBe("2026-10-06T06:17:01.773Z");
    expect(p.qualifiedAt?.toISOString()).toBe("2026-10-04T18:00:04.244Z");
    expect(p.disqualifiedAt?.toISOString()).toBe("2026-10-06T06:17:01.773Z");
  });

  it("montant converti en euros si une devise est donnée ; colonnes absentes : vides", () => {
    const rates = buildRateTable([{ currency: "USD", rate: 1.25 }]);
    expect(
      mapPlayer({ ...reversedRow, currency: "USD", cpa_affiliate_amount: 100 }, rates)!.cpaAmount,
    ).toBe(80);
    const bare = mapPlayer({ id: "p2", external_player_id: "7" })!;
    expect(bare).toMatchObject({
      cpaStatus: null,
      cpaAmount: null,
      cpaCreditedAt: null,
      cpaReversedAt: null,
      qualifiedAt: null,
      disqualifiedAt: null,
    });
  });
});

describe("table stats : une ligne Link Affi = une ligne AffiliateDailyStat", () => {
  const row = {
    id: "st-1",
    affiliate_id: "aff-1",
    casino_id: "cas-1",
    campaign_id: "camp-1",
    date: "2026-10-04",
    created_at: "2026-10-04T00:02:23.62937+00:00",
    clicks: 31,
    signups: 7,
    deposits: 5,
    deposit_amount: 250.5,
    revenue: 223.09,
    cpa_revenue: 210,
    revshare_revenue: 13.092594000000002,
    revshare_gross_revenue: 52.370376,
  };

  it("garde le jour, l'offre, le casino, l'affilié et les montants (revshare à 4 décimales)", () => {
    expect(mapStat(row)).toEqual({
      externalId: "st-1",
      date: "2026-10-04",
      campaignExternalId: "camp-1",
      programExternalId: "cas-1",
      affiliateExternalId: "aff-1",
      clicks: 31,
      signups: 7,
      deposits: 5,
      depositAmount: 250.5,
      revenue: 223.09,
      cpaRevenue: 210,
      revshareRevenue: 13.0926,
      sourceCreatedAt: new Date("2026-10-04T00:02:23.629Z"),
      raw: row,
    });
  });

  it("ligne sans offre (prime manuelle, correction) : gardée, offre vide ; sans identifiant ou sans jour : ignorée", () => {
    expect(mapStat({ ...row, campaign_id: null, deposits: -1 })).toMatchObject({
      campaignExternalId: null,
      deposits: -1,
    });
    expect(mapStat({ ...row, id: undefined })).toBeNull();
    expect(mapStat({ ...row, date: "pas une date" })).toBeNull();
    expect(mapStat({ ...row, date: "2026-10-04T00:00:00+00:00" })!.date).toBe("2026-10-04");
  });

  it("nos affiliés : ceux des offres rattachées (colonne affiliate_id de la ligne brute), sans doublon", () => {
    expect(
      ourAffiliateIds([
        { raw: { affiliate_id: "aff-1" } },
        { raw: { affiliate_id: "aff-1" } },
        { raw: { affiliate_id: "aff-2" } },
        { raw: null },
        { raw: { affiliate_id: "" } },
      ]),
    ).toEqual(["aff-1", "aff-2"]);
  });
});

describe("table stats : fenêtres de lecture (notre affilié seulement)", () => {
  const now = new Date("2026-10-11T10:00:00.000Z");

  it("est synchronisée en dernier, après les offres et les joueurs", () => {
    expect(SYNC_TABLES.at(-1)).toEqual({ table: "stats", dateCol: "date" });
  });

  it("sans curseur ou en resynchro complète : toutes les lignes de chaque affilié", () => {
    expect(statsQueries(["aff-1", "aff-2"], {}, now, false)).toEqual([
      { eq: { affiliate_id: "aff-1" }, order: "date" },
      { eq: { affiliate_id: "aff-2" }, order: "date" },
    ]);
    expect(statsQueries(["aff-1"], { since: "2026-10-11T09:58:00.000Z" }, now, true)).toEqual([
      { eq: { affiliate_id: "aff-1" }, order: "date" },
    ]);
  });

  it("passage normal : les jours récents (mis à jour en place) et les lignes créées depuis le dernier succès", () => {
    const qs = statsQueries(
      ["aff-1"],
      { since: "2026-10-11T00:05:00.000Z", affiliates: ["aff-1"] },
      now,
      false,
    );
    expect(STATS_RECENT_DAYS).toBe(7);
    expect(qs).toEqual([
      { eq: { affiliate_id: "aff-1" }, date_col: "date", from: "2026-10-04", order: "date" },
      // 15 minutes de chevauchement : 23:50 UTC la veille.
      {
        eq: { affiliate_id: "aff-1" },
        date_col: "created_at",
        from: "2026-10-10",
        order: "created_at",
      },
    ]);
  });

  it("un affilié qui devient le nôtre (nouvelle offre rattachée) : tout son historique est lu", () => {
    const qs = statsQueries(
      ["aff-1", "aff-2"],
      { since: "2026-10-11T00:05:00.000Z", affiliates: ["aff-1"] },
      now,
      false,
    );
    expect(qs.filter((q) => q.eq.affiliate_id === "aff-2")).toEqual([
      { eq: { affiliate_id: "aff-2" }, order: "date" },
    ]);
    expect(qs.filter((q) => q.eq.affiliate_id === "aff-1")).toHaveLength(2);
    // Ancien curseur sans liste d'affiliés : historique complet par prudence.
    expect(statsQueries(["aff-1"], { since: "2026-10-11T00:05:00.000Z" }, now, false)).toEqual([
      { eq: { affiliate_id: "aff-1" }, order: "date" },
    ]);
  });

  it("aucun affilié à nous : aucune lecture", () => {
    expect(statsQueries([], {}, now, true)).toEqual([]);
  });

  it("relecture de nuit : les 35 derniers jours par date, toujours une requête par affilié et par colonne", () => {
    const cursor = { since: "2026-10-11T00:05:00.000Z", affiliates: ["aff-1"] };
    const qs = statsQueries(["aff-1"], cursor, now, false, true);
    expect(STATS_DEEP_DAYS).toBe(35);
    expect(qs).toEqual([
      { eq: { affiliate_id: "aff-1" }, date_col: "date", from: "2026-09-06", order: "date" },
      {
        eq: { affiliate_id: "aff-1" },
        date_col: "created_at",
        from: "2026-10-10",
        order: "created_at",
      },
    ]);
  });

  it("relecture de nuit due entre 3 h et 6 h de Paris, une fois par nuit ; à toute heure après 36 h sans relecture", () => {
    // 3 h 30 à Paris (heure d'été : UTC+2).
    const night = new Date("2026-10-11T01:30:00.000Z");
    expect(statsDeepDue({}, night)).toBe(true);
    expect(statsDeepDue({ deepAt: "2026-10-10T01:10:00.000Z" }, night)).toBe(true);
    // Déjà faite cette nuit (il y a 20 minutes) : pas deux fois.
    expect(statsDeepDue({ deepAt: "2026-10-11T01:10:00.000Z" }, night)).toBe(false);
    // Midi : jamais en journée, sauf si la dernière date de plus de 36 h.
    expect(statsDeepDue({}, now)).toBe(false);
    expect(statsDeepDue({ deepAt: "2026-10-10T01:10:00.000Z" }, now)).toBe(false);
    expect(statsDeepDue({ deepAt: "2026-10-09T20:00:00.000Z" }, now)).toBe(true);
  });
});
