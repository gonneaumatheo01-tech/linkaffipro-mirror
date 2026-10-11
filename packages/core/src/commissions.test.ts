import { describe, expect, it } from "vitest";
import {
  CPA_EXTERNAL_PREFIX,
  CPA_REVERSAL_EXTERNAL_PREFIX,
  commissionsOf,
  commissionsRoas,
  cpaEvents,
  cpaStateFromRow,
  diffCpaEvents,
  effectiveCpaDates,
  gainsOf,
  isArchivedCpaId,
  isCpaExternalId,
  type CpaState,
  type StoredCpaEvent,
  parisDayKey,
  revshareDayKey,
  revshareRowWhere,
  sumRevshareByDay,
} from "./commissions";

const d = (iso: string) => new Date(iso);

describe("CPA par joueur : créditée au jour du crédit, retranchée le jour de l'annulation", () => {
  it("CPA approuvée : un seul événement positif, daté du crédit, identifiant stable", () => {
    expect(
      cpaEvents({
        laPlayerId: "pl-1",
        status: "approved",
        amount: 70,
        creditedAt: d("2026-10-04T11:36:48Z"),
        reversedAt: null,
      }),
    ).toEqual([
      {
        type: "CPA",
        amount: 70,
        occurredAt: d("2026-10-04T11:36:48Z"),
        externalId: `${CPA_EXTERNAL_PREFIX}pl-1`,
      },
    ]);
  });

  it("CPA créditée puis annulée : +montant au crédit, −montant le jour de l'annulation (somme nulle)", () => {
    const events = cpaEvents({
      laPlayerId: "pl-2",
      status: "reversed",
      amount: 70,
      creditedAt: d("2026-10-04T13:42:27Z"),
      reversedAt: d("2026-10-06T06:17:01Z"),
    });
    expect(events).toEqual([
      { type: "CPA", amount: 70, occurredAt: d("2026-10-04T13:42:27Z"), externalId: "cpa:pl-2" },
      {
        type: "CPA_REVERSAL",
        amount: -70,
        occurredAt: d("2026-10-06T06:17:01Z"),
        externalId: `${CPA_REVERSAL_EXTERNAL_PREFIX}pl-2`,
      },
    ]);
    expect(events.reduce((s, e) => s + e.amount, 0)).toBe(0);
    // Le jour de l'annulation est celui de Paris (le 6), pas celui de la ligne Link Affi d'origine (le 4).
    expect(parisDayKey(events[1]!.occurredAt)).toBe("2026-10-06");
  });

  it("anciens joueurs sans date de crédit : repli sur la qualification ; annulation sans date : la disqualification", () => {
    const dates = effectiveCpaDates({
      laPlayerId: "x",
      status: "reversed",
      amount: 45,
      creditedAt: null,
      reversedAt: null,
      qualifiedAt: d("2026-09-01T10:00:00Z"),
      disqualifiedAt: d("2026-09-03T10:00:00Z"),
    });
    expect(dates).toEqual({
      creditedAt: d("2026-09-01T10:00:00Z"),
      reversedAt: d("2026-09-03T10:00:00Z"),
    });
  });

  it("annulation sans aucune date : retranchée le jour du crédit (jamais une commission fantôme)", () => {
    const events = cpaEvents({
      laPlayerId: "y",
      status: "reversed",
      amount: 50,
      creditedAt: d("2026-09-01T10:00:00Z"),
      reversedAt: null,
    });
    expect(events.map((e) => [e.type, e.amount, e.occurredAt.toISOString()])).toEqual([
      ["CPA", 50, "2026-09-01T10:00:00.000Z"],
      ["CPA_REVERSAL", -50, "2026-09-01T10:00:00.000Z"],
    ]);
  });

  it("annulation datée avant le crédit (donnée incohérente) : ramenée au jour du crédit", () => {
    const events = cpaEvents({
      laPlayerId: "z",
      status: "reversed",
      amount: 10,
      creditedAt: d("2026-09-05T10:00:00Z"),
      reversedAt: d("2026-09-01T10:00:00Z"),
    });
    expect(events[1]!.occurredAt).toEqual(d("2026-09-05T10:00:00Z"));
  });

  it("aucun événement : statut none / not_eligible / inconnu, montant absent ou nul, aucune date de crédit", () => {
    const base = {
      laPlayerId: "p",
      amount: 70,
      creditedAt: d("2026-10-01T10:00:00Z"),
      reversedAt: null,
    };
    expect(cpaEvents({ ...base, status: "none" })).toEqual([]);
    expect(cpaEvents({ ...base, status: "not_eligible" })).toEqual([]);
    expect(cpaEvents({ ...base, status: null })).toEqual([]);
    expect(cpaEvents({ ...base, status: "approved", amount: null })).toEqual([]);
    expect(cpaEvents({ ...base, status: "approved", amount: 0 })).toEqual([]);
    expect(cpaEvents({ ...base, status: "approved", creditedAt: null })).toEqual([]);
    expect(cpaEvents({ ...base, status: "APPROVED", amount: 70.004 })[0]!.amount).toBe(70);
  });

  it("reconnaît les identifiants des événements de commission (rien d'autre n'est retiré)", () => {
    expect(isCpaExternalId("cpa:pl-1")).toBe(true);
    expect(isCpaExternalId("cpa_reversal:pl-1")).toBe(true);
    expect(isCpaExternalId("registration:123")).toBe(false);
    expect(isCpaExternalId(null)).toBe(false);
    expect(isArchivedCpaId("cpa:pl-1:1")).toBe(true);
    expect(isArchivedCpaId("cpa_reversal:pl-1:2")).toBe(true);
    expect(isArchivedCpaId("cpa:pl-1")).toBe(false);
    expect(isArchivedCpaId("registration:1:2")).toBe(false);
  });
});

let rowSeq = 0;

/** Passe de synchro simulée : état Link Affi → écritures, appliquées à la liste des événements gardés. */
function pass(
  stored: StoredCpaEvent[],
  state: CpaState,
): { next: StoredCpaEvent[]; diff: ReturnType<typeof diffCpaEvents> } {
  const diff = diffCpaEvents(stored, cpaEvents(state), { observedAt: state.observedAt ?? null });
  let next = stored.map((e) => {
    const r = diff.renames.find((x) => x.id === e.id);
    return r ? { ...e, externalId: r.to } : e;
  });
  next = next.filter((e) => !diff.deletes.includes(e.externalId!));
  for (const u of diff.upserts) {
    const i = next.findIndex((e) => e.externalId === u.externalId);
    const row = { id: i >= 0 ? next[i]!.id : `row-${++rowSeq}`, ...u };
    if (i >= 0) next[i] = row;
    else next.push(row);
  }
  return { next, diff };
}

const ledger = (events: StoredCpaEvent[]) =>
  events
    .map((e) => [e.externalId, e.type, Number(e.amount), parisDayKey(e.occurredAt)] as const)
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));

describe("CPA : plusieurs cycles crédit / annulation pour un même joueur", () => {
  const base = { laPlayerId: "pl-9", amount: 70 } as const;
  const approved1: CpaState = {
    ...base,
    status: "approved",
    creditedAt: d("2026-10-01T10:00:00Z"),
    reversedAt: null,
    observedAt: d("2026-10-01T10:00:00Z"),
  };
  const reversed5: CpaState = {
    ...base,
    status: "reversed",
    creditedAt: d("2026-10-01T10:00:00Z"),
    reversedAt: d("2026-10-05T10:00:00Z"),
    observedAt: d("2026-10-05T10:00:00Z"),
  };

  it("approuvé → annulé → approuvé de nouveau (nouvelle date de crédit) : +70 / −70 / +70, jours passés inchangés", () => {
    let stored: StoredCpaEvent[] = [];
    stored = pass(stored, approved1).next;
    stored = pass(stored, reversed5).next;
    const again: CpaState = {
      ...base,
      status: "approved",
      creditedAt: d("2026-10-10T10:00:00Z"),
      reversedAt: null,
      observedAt: d("2026-10-10T10:00:00Z"),
    };
    const third = pass(stored, again);
    expect(third.diff.renames.map((r) => [r.from, r.to])).toEqual([
      ["cpa:pl-9", "cpa:pl-9:1"],
      ["cpa_reversal:pl-9", "cpa_reversal:pl-9:1"],
    ]);
    expect(third.diff.deletes).toEqual([]);
    expect(third.diff.created).toEqual(["cpa:pl-9"]);
    // Seul le jour du nouveau crédit est à recalculer : le 1er et le 5 ne changent pas.
    expect(third.diff.days).toEqual(["2026-10-10"]);
    expect(ledger(third.next)).toEqual([
      ["cpa:pl-9", "CPA", 70, "2026-10-10"],
      ["cpa:pl-9:1", "CPA", 70, "2026-10-01"],
      ["cpa_reversal:pl-9:1", "CPA_REVERSAL", -70, "2026-10-05"],
    ]);
    expect(third.next.reduce((t, e) => t + Number(e.amount), 0)).toBe(70);
    // Idempotent : le même état ne produit plus rien.
    const fourth = pass(third.next, { ...again, observedAt: d("2026-10-11T08:00:00Z") });
    expect(fourth.diff).toEqual({ upserts: [], deletes: [], renames: [], created: [], days: [] });
  });

  it("rétabli sans nouvelle date de crédit : le nouveau crédit compte le jour du changement chez Link Affi", () => {
    let stored = pass(pass([], approved1).next, reversed5).next;
    const restored: CpaState = {
      ...base,
      status: "approved",
      creditedAt: d("2026-10-01T10:00:00Z"),
      reversedAt: null,
      observedAt: d("2026-10-08T09:00:00Z"),
    };
    const r = pass(stored, restored);
    expect(ledger(r.next)).toEqual([
      ["cpa:pl-9", "CPA", 70, "2026-10-08"],
      ["cpa:pl-9:1", "CPA", 70, "2026-10-01"],
      ["cpa_reversal:pl-9:1", "CPA_REVERSAL", -70, "2026-10-05"],
    ]);
    stored = r.next;
    // La ligne Link Affi change encore (dépôt) : le crédit reste au 8, rien n'est réécrit.
    expect(
      pass(stored, { ...restored, observedAt: d("2026-10-09T09:00:00Z") }).diff.upserts,
    ).toEqual([]);
    // Sans date de mise à jour : le jour de l'annulation (jamais avant).
    const noObserved = pass(pass(pass([], approved1).next, reversed5).next, {
      ...restored,
      observedAt: null,
    });
    expect(ledger(noObserved.next)[0]).toEqual(["cpa:pl-9", "CPA", 70, "2026-10-05"]);
  });

  it("deuxième annulation puis troisième crédit : deux cycles gardés, numérotés", () => {
    let stored = pass(pass([], approved1).next, reversed5).next;
    stored = pass(stored, {
      ...base,
      status: "approved",
      creditedAt: d("2026-10-10T10:00:00Z"),
      reversedAt: null,
      observedAt: d("2026-10-10T10:00:00Z"),
    }).next;
    stored = pass(stored, {
      ...base,
      status: "reversed",
      creditedAt: d("2026-10-10T10:00:00Z"),
      reversedAt: d("2026-10-12T10:00:00Z"),
      observedAt: d("2026-10-12T10:00:00Z"),
    }).next;
    const last = pass(stored, {
      ...base,
      status: "approved",
      creditedAt: d("2026-10-15T10:00:00Z"),
      reversedAt: null,
      observedAt: d("2026-10-15T10:00:00Z"),
    });
    expect(ledger(last.next)).toEqual([
      ["cpa:pl-9", "CPA", 70, "2026-10-15"],
      ["cpa:pl-9:1", "CPA", 70, "2026-10-01"],
      ["cpa:pl-9:2", "CPA", 70, "2026-10-10"],
      ["cpa_reversal:pl-9:1", "CPA_REVERSAL", -70, "2026-10-05"],
      ["cpa_reversal:pl-9:2", "CPA_REVERSAL", -70, "2026-10-12"],
    ]);
  });

  it("même cycle : une date d'annulation corrigée est réécrite, sans nouveau cycle", () => {
    const stored = pass(pass([], approved1).next, reversed5).next;
    const r = pass(stored, { ...reversed5, reversedAt: d("2026-10-06T10:00:00Z") });
    expect(r.diff.renames).toEqual([]);
    expect(r.diff.created).toEqual([]);
    expect(r.diff.upserts.map((e) => [e.externalId, parisDayKey(e.occurredAt)])).toEqual([
      ["cpa_reversal:pl-9", "2026-10-06"],
    ]);
    expect(r.diff.days).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("un cycle gardé n'est jamais retiré, même si Link Affi repasse le joueur à « none »", () => {
    const stored = pass(pass(pass([], approved1).next, reversed5).next, {
      ...approved1,
      creditedAt: d("2026-10-10T10:00:00Z"),
      observedAt: d("2026-10-10T10:00:00Z"),
    }).next;
    const gone = pass(stored, { ...base, status: "none", creditedAt: null, reversedAt: null });
    expect(gone.diff.deletes).toEqual(["cpa:pl-9"]);
    expect(ledger(gone.next).map((e) => e[0])).toEqual(["cpa:pl-9:1", "cpa_reversal:pl-9:1"]);
  });
});

describe("ligne joueur Link Affi → état CPA (règle unique de la synchro et de la reprise)", () => {
  const row = {
    id: "la-1",
    cpa_status: "reversed",
    cpa_affiliate_amount: "70",
    cpa_credited_at: null,
    qualified_at: "2026-10-04T12:01:03Z",
    cpa_reversed_at: "2026-10-06T06:17:01.773859+00:00",
    updated_at: "2026-10-06T06:17:02Z",
  };

  it("texte ou nombre, dates ISO, mise à jour de la ligne ; sans identifiant : rien", () => {
    expect(cpaStateFromRow(row)).toEqual({
      laPlayerId: "la-1",
      status: "reversed",
      amount: 70,
      creditedAt: null,
      reversedAt: d("2026-10-06T06:17:01.773Z"),
      qualifiedAt: d("2026-10-04T12:01:03Z"),
      disqualifiedAt: null,
      observedAt: d("2026-10-06T06:17:02Z"),
    });
    expect(cpaStateFromRow(null)).toBeNull();
    expect(cpaStateFromRow({ cpa_status: "approved" })).toBeNull();
  });

  it("montant converti en euros comme les autres montants du joueur (devise de la ligne, au centime)", () => {
    const rates = { EUR: 1, USD: 1.25 };
    expect(
      cpaStateFromRow({ ...row, currency: "usd", cpa_affiliate_amount: 100 }, rates)!.amount,
    ).toBe(80);
    expect(cpaStateFromRow({ ...row, cpa_affiliate_amount: 70.004 }, rates)!.amount).toBe(70);
    // Devise inconnue de la table : montant inchangé (même règle que les dépôts).
    expect(
      cpaStateFromRow({ ...row, currency: "GBP", cpa_affiliate_amount: 50 }, rates)!.amount,
    ).toBe(50);
  });
});

describe("part de revshare : agrégat Link Affi par offre et par jour", () => {
  it("jour retenu : celui de la ligne, ou le jour d'arrivée d'une correction créée plus tard", () => {
    // Ligne normale : créée à minuit de Paris (22 h UTC la veille), jour = date.
    expect(revshareDayKey({ date: "2026-10-03", sourceCreatedAt: d("2026-10-02T22:04:50Z") })).toBe(
      "2026-10-03",
    );
    // Correction créée 12 jours après : comptée le jour où elle arrive.
    expect(
      revshareDayKey({
        date: new Date("2026-09-20T00:00:00Z"),
        sourceCreatedAt: d("2026-10-02T08:00:40Z"),
      }),
    ).toBe("2026-10-02");
    expect(revshareDayKey({ date: "2026-10-03", sourceCreatedAt: null })).toBe("2026-10-03");
  });

  it("additionne par jour, nos offres seulement", () => {
    const rows = [
      {
        date: "2026-10-04",
        sourceCreatedAt: null,
        affiliateCampaignId: "o1",
        revshareRevenue: 13.0926,
      },
      {
        date: "2026-10-04",
        sourceCreatedAt: null,
        affiliateCampaignId: "o1",
        revshareRevenue: -2.5,
      },
      {
        date: "2026-10-05",
        sourceCreatedAt: null,
        affiliateCampaignId: "o1",
        revshareRevenue: -9.4987,
      },
      {
        date: "2026-10-05",
        sourceCreatedAt: null,
        affiliateCampaignId: "autre",
        revshareRevenue: 500,
      },
      {
        date: "2026-10-05",
        sourceCreatedAt: null,
        affiliateCampaignId: null,
        revshareRevenue: 200,
      },
    ];
    expect(sumRevshareByDay(rows, new Set(["o1"]))).toEqual(
      new Map([
        ["2026-10-04", 10.59],
        ["2026-10-05", -9.5],
      ]),
    );
  });

  it("condition de lecture : jour retenu dans la période, offres données", () => {
    const where = revshareRowWhere(
      {
        dateFrom: new Date("2026-10-01T00:00:00Z"),
        dateTo: new Date("2026-10-07T00:00:00Z"),
        since: new Date("2026-09-30T22:00:00Z"),
        until: new Date("2026-10-07T22:00:00Z"),
      },
      ["o1", "o1", "o2"],
    );
    expect(where).toEqual({
      affiliateCampaignId: { in: ["o1", "o2"] },
      date: { lte: new Date("2026-10-07T00:00:00Z") },
      AND: [
        {
          OR: [
            { sourceCreatedAt: null },
            { sourceCreatedAt: { lt: new Date("2026-10-07T22:00:00Z") } },
          ],
        },
        {
          OR: [
            { date: { gte: new Date("2026-10-01T00:00:00Z") } },
            { sourceCreatedAt: { gte: new Date("2026-09-30T22:00:00Z") } },
          ],
        },
      ],
    });
    // Aucune offre : rien (jamais toutes les lignes de Link Affi).
    expect(
      revshareRowWhere(
        { dateFrom: new Date(0), dateTo: new Date(0), since: new Date(0), until: new Date(0) },
        [],
      ),
    ).toEqual({
      affiliateCampaignId: { in: [] },
    });
  });
});

describe("gains = commissions − dépense pub", () => {
  it("commissions = CPA nette + part de revshare ; gains et retour sur dépense pub", () => {
    expect(commissionsOf(210, 13.0926)).toBe(223.09);
    expect(gainsOf(223.09, 50)).toBe(173.09);
    expect(gainsOf(0, 62.5)).toBe(-62.5);
    expect(gainsOf(0.004, 0)).toBe(0);
    expect(commissionsRoas(150, 100)).toBe(1.5);
    expect(commissionsRoas(150, 0)).toBeNull();
  });
});
