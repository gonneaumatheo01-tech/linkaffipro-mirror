/**
 * Dernier filet des paris (relecture de la phase 25) : un post de pari réclamé trop tard n'est jamais envoyé.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = {
    pick: null as Row | null,
    category: { minMinutesBeforeKickoff: 30 } as Row | null,
    team: null as Row | null,
    sent: 0,
    postUpdates: [] as Row[],
    pickUpdates: [] as Row[],
  };
  const prisma = {
    bettingPick: {
      findFirst: vi.fn(async () => state.pick),
      updateMany: vi.fn(async ({ data }: { data: Row }) => {
        state.pickUpdates.push(data);
        return { count: 1 };
      }),
    },
    betCategory: { findUnique: vi.fn(async () => state.category) },
    agentTeamConfig: { findUnique: vi.fn(async () => state.team) },
    post: {
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.postUpdates.push(data);
        return data;
      }),
      count: vi.fn(async () => state.sent),
    },
  };
  return { state, prisma };
});

vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, recordEvent: vi.fn(async () => undefined), toJsonValue: (v: unknown) => v }));

import { recordEvent } from "@linkaffipro/db";
import { BET_TOO_LATE_REASON, betStillOnTime, cancelLateBetPost } from "./bet-kickoff";

const NOW = new Date("2026-10-24T18:00:00Z");
const post = { id: "post1", agentMissionId: "m1", channelId: "c1", botId: "b1" };
const kickoffIn = (min: number) => new Date(NOW.getTime() + min * 60_000);

beforeEach(() => {
  db.state.pick = null;
  db.state.category = { minMinutesBeforeKickoff: 30 };
  db.state.team = null;
  db.state.sent = 0;
  db.state.postUpdates = [];
  db.state.pickUpdates = [];
  vi.clearAllMocks();
});

describe("post de pari au moment de l'envoi", () => {
  it("réclamé à N − 1 min du coup d'envoi : annulé, pari écarté « trop tard », rien n'est envoyé", async () => {
    db.state.pick = { id: "p1", status: "PUBLISHED", kickoffAt: kickoffIn(29), categoryId: "cat" };
    expect(await cancelLateBetPost(post, NOW)).toBe(true);
    expect(db.state.postUpdates).toEqual([expect.objectContaining({ status: "CANCELLED" })]);
    expect(db.state.pickUpdates).toEqual([{ status: "SKIPPED", skipReason: BET_TOO_LATE_REASON }]);
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agents.sports.pick_skipped" }));
  });

  it("match commencé : annulé ; un autre canal l'a déjà reçu : le pari reste publié", async () => {
    db.state.pick = { id: "p1", status: "PUBLISHED", kickoffAt: kickoffIn(-5), categoryId: "cat" };
    db.state.sent = 1;
    expect(await cancelLateBetPost(post, NOW)).toBe(true);
    expect(db.state.postUpdates).toHaveLength(1);
    expect(db.state.pickUpdates).toHaveLength(0);
  });

  it("à l'heure : envoyé ; délai de l'équipe plus long que celui de la catégorie : il s'applique", async () => {
    db.state.pick = { id: "p1", status: "PUBLISHED", kickoffAt: kickoffIn(40), categoryId: "cat" };
    expect(await cancelLateBetPost(post, NOW)).toBe(false);
    db.state.team = { settings: { sports: { minMinutesBeforeKickoff: 45 } } };
    expect(await cancelLateBetPost(post, NOW)).toBe(true);
  });

  it("pari déjà écarté : le post n'est pas envoyé ; post sans mission ou sans pari : rien n'est lu ni changé", async () => {
    db.state.pick = { id: "p1", status: "SKIPPED", kickoffAt: kickoffIn(600), categoryId: "cat" };
    expect(await cancelLateBetPost(post, NOW)).toBe(true);
    db.state.postUpdates = [];
    expect(await cancelLateBetPost({ ...post, agentMissionId: null }, NOW)).toBe(false);
    db.state.pick = null;
    expect(await cancelLateBetPost(post, NOW)).toBe(false);
    expect(db.state.postUpdates).toHaveLength(0);
  });

  it("règle pure : minutes pleines", () => {
    expect(betStillOnTime(kickoffIn(30), NOW, 30)).toBe(true);
    expect(betStillOnTime(new Date(kickoffIn(30).getTime() - 1), NOW, 30)).toBe(false);
    expect(betStillOnTime(kickoffIn(0), NOW, 0)).toBe(false);
  });
});
