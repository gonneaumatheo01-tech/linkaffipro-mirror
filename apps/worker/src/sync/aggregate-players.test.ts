import { describe, expect, it } from "vitest";
import {
  aggregatePlayersFor,
  dayOfAggregateId,
  noonOfDay,
  reconcileAggregatePlayers,
} from "./aggregate-players";

type P = {
  id: string;
  affiliateCampaignId: string;
  externalPlayerId: string;
  subIdSource: string | null;
  registeredAt: Date | null;
  ftdAt: Date | null;
};
type S = { affiliateCampaignId: string; date: Date; signups: number; deposits: number };

/** Base en mémoire : seules les requêtes utilisées par reconcileAggregatePlayers. */
function fakeDb(o: { offersInCampaigns: string[]; players?: P[]; stats?: S[] }) {
  const players: P[] = [...(o.players ?? [])];
  let n = 0;
  const isAggregate = (p: P) => p.subIdSource === "aggregate";
  const db = {
    campaign: { findMany: async () => [{ affiliateCampaignIds: o.offersInCampaigns }] },
    affiliateCampaign: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    },
    player: {
      count: async ({ where }: { where: { affiliateCampaignId: string } }) =>
        players.filter((p) => p.affiliateCampaignId === where.affiliateCampaignId && !isAggregate(p)).length,
      findMany: async ({ where }: { where: { affiliateCampaignId: string } }) =>
        players.filter((p) => p.affiliateCampaignId === where.affiliateCampaignId && isAggregate(p)),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: string; externalPlayerId: string } };
        create: Partial<P> & Pick<P, "affiliateCampaignId" | "externalPlayerId">;
        update: Partial<P>;
      }) => {
        const k = where.affiliateCampaignId_externalPlayerId;
        const cur = players.find((p) => p.affiliateCampaignId === k.affiliateCampaignId && p.externalPlayerId === k.externalPlayerId);
        if (cur) Object.assign(cur, update);
        else players.push({ id: `p${++n}`, subIdSource: null, registeredAt: null, ftdAt: null, ...create });
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) {
          const i = players.findIndex((p) => p.id === id && isAggregate(p));
          if (i >= 0) players.splice(i, 1);
        }
      },
    },
    affiliateDailyStat: {
      groupBy: async ({ where }: { where: { affiliateCampaignId: string } }) => {
        const byDay = new Map<number, { date: Date; _sum: { signups: number; deposits: number } }>();
        for (const s of o.stats ?? []) {
          if (s.affiliateCampaignId !== where.affiliateCampaignId) continue;
          const g = byDay.get(s.date.getTime()) ?? { date: s.date, _sum: { signups: 0, deposits: 0 } };
          g._sum.signups += s.signups;
          g._sum.deposits += s.deposits;
          byDay.set(s.date.getTime(), g);
        }
        return [...byDay.values()];
      },
    },
  };
  return { db: db as never, players };
}

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("joueurs agrégés (offres sans fiches joueurs)", () => {
  it("un joueur par inscription, dont autant de premiers dépôts que de dépôts, à midi heure de Paris", () => {
    const out = aggregatePlayersFor([{ day: "2026-10-17", signups: 3, deposits: 1 }]);
    expect(out.map((p) => p.externalPlayerId)).toEqual(["agg:2026-10-17:1", "agg:2026-10-17:2", "agg:2026-10-17:3"]);
    expect(out.filter((p) => p.registeredAt).length).toBe(3);
    expect(out.filter((p) => p.ftdAt).length).toBe(1);
    expect(out[0]!.registeredAt!.toISOString()).toBe("2026-10-17T10:00:00.000Z"); // midi à Paris (été)
    expect(noonOfDay("2026-10-28").toISOString()).toBe("2026-10-28T11:00:00.000Z"); // midi à Paris (hiver)
  });

  it("plus de dépôts que d'inscriptions : joueurs ajoutés avec seulement un premier dépôt ; négatifs ignorés", () => {
    const out = aggregatePlayersFor([
      { day: "2026-10-20", signups: 1, deposits: 2 },
      { day: "2026-10-21", signups: -1, deposits: 0 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ externalPlayerId: "agg:2026-10-20:2", registeredAt: null });
    expect(out[1]!.ftdAt).not.toBeNull();
  });

  it("lit le jour d'un identifiant agrégé, jamais celui d'un vrai joueur", () => {
    expect(dayOfAggregateId("agg:2026-10-17:12")).toBe("2026-10-17");
    expect(dayOfAggregateId("3f1c2b8e-0000-4000-8000-000000000000")).toBeNull();
  });

  it("crée les joueurs agrégés d'une offre de nos campagnes sans vrai joueur, puis suit les corrections", async () => {
    const { db, players } = fakeDb({
      offersInCampaigns: ["spiice"],
      stats: [
        { affiliateCampaignId: "spiice", date: day("2026-10-17"), signups: 2, deposits: 0 },
        { affiliateCampaignId: "spiice", date: day("2026-10-18"), signups: 1, deposits: 0 },
      ],
    });
    const changed = await reconcileAggregatePlayers(db);
    expect([...changed].sort()).toEqual(["2026-10-17", "2026-10-18"]);
    expect(players.filter((p) => p.registeredAt)).toHaveLength(3);
    expect(players.every((p) => p.subIdSource === "aggregate")).toBe(true);
    // Deuxième passage sans changement : rien à recalculer.
    expect((await reconcileAggregatePlayers(db)).size).toBe(0);
  });

  it("retire les joueurs agrégés quand l'offre reçoit de vrais joueurs (jamais de double compte)", async () => {
    const { db, players } = fakeDb({
      offersInCampaigns: ["celsius"],
      players: [
        { id: "a1", affiliateCampaignId: "celsius", externalPlayerId: "agg:2026-10-17:1", subIdSource: "aggregate", registeredAt: noonOfDay("2026-10-17"), ftdAt: null },
        { id: "r1", affiliateCampaignId: "celsius", externalPlayerId: "la-uuid-1", subIdSource: "postback", registeredAt: noonOfDay("2026-10-17"), ftdAt: null },
      ],
      stats: [{ affiliateCampaignId: "celsius", date: day("2026-10-17"), signups: 1, deposits: 0 }],
    });
    const changed = await reconcileAggregatePlayers(db);
    expect([...changed]).toEqual(["2026-10-17"]);
    expect(players.map((p) => p.id)).toEqual(["r1"]);
  });

  it("ignore les offres qui ne sont dans aucune de nos campagnes", async () => {
    const { db, players } = fakeDb({
      offersInCampaigns: [],
      stats: [{ affiliateCampaignId: "autre", date: day("2026-10-17"), signups: 5, deposits: 1 }],
    });
    expect((await reconcileAggregatePlayers(db)).size).toBe(0);
    expect(players).toHaveLength(0);
  });
});
