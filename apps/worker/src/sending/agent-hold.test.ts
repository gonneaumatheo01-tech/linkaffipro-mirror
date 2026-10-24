/** Filet des messages d'agents à la réclamation : pause → retenu 30 min, retour en simulation → annulé. */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = { mission: null as Row | null, team: null as Row | null, pausedAll: null as Row | null, channel: { isTest: false } as Row | null, updates: [] as Row[] };
  const prisma = {
    agentMission: { findUnique: vi.fn(async () => state.mission) },
    agentTeamConfig: { findUnique: vi.fn(async () => state.team) },
    setting: { findUnique: vi.fn(async () => state.pausedAll) },
    channel: { findUnique: vi.fn(async () => state.channel) },
    post: {
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.updates.push(data);
        return data;
      }),
    },
  };
  return { state, prisma };
});
vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, recordEvent: vi.fn(async () => undefined), toJsonValue: (v: unknown) => v }));

import { recordEvent } from "@linkaffipro/db";
import { AGENT_POST_HOLD_MS, agentPostDecision } from "./agent-hold";

const NOW = new Date("2026-10-24T18:00:00Z");
const post = { id: "p1", agentMissionId: "m1", channelId: "c1", botId: "b1" };

beforeEach(() => {
  db.state.mission = { teamKey: "casino", isTest: false };
  db.state.team = { simulation: false, paused: false, enabled: true };
  db.state.pausedAll = null;
  db.state.channel = { isTest: false };
  db.state.updates = [];
  vi.clearAllMocks();
});

describe("message d'agent réclamé par le scheduler", () => {
  it("équipe active, vrai mode : envoyé", async () => {
    expect(await agentPostDecision(post, NOW)).toBe("send");
    expect(db.state.updates).toHaveLength(0);
  });
  it("équipe en pause ou pause générale : retenu 30 min, remis en SCHEDULED, sans échec compté", async () => {
    db.state.team = { simulation: false, paused: true, enabled: true };
    expect(await agentPostDecision(post, NOW)).toBe("held");
    expect(db.state.updates[0]).toEqual({ status: "SCHEDULED", scheduledAt: new Date(NOW.getTime() + AGENT_POST_HOLD_MS) });
    db.state.team = { simulation: false, paused: false, enabled: true };
    db.state.pausedAll = { value: true };
    expect(await agentPostDecision(post, NOW)).toBe("held");
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agents.post.held" }));
  });
  it("équipe repassée en simulation, vrai canal visé : annulé ; canal Test : envoyé", async () => {
    db.state.team = { simulation: true, paused: false, enabled: true };
    expect(await agentPostDecision(post, NOW)).toBe("cancelled");
    expect(db.state.updates[0]).toMatchObject({ status: "CANCELLED" });
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agents.post.cancelled_simulation" }));
    db.state.channel = { isTest: true };
    db.state.updates = [];
    expect(await agentPostDecision(post, NOW)).toBe("send");
    expect(db.state.updates).toHaveLength(0);
  });
  it("message humain (sans mission) : jamais lu ni touché", async () => {
    db.state.team = { simulation: true, paused: true, enabled: true };
    expect(await agentPostDecision({ ...post, agentMissionId: null }, NOW)).toBe("send");
    expect(db.prisma.agentMission.findUnique).not.toHaveBeenCalled();
    expect(db.state.updates).toHaveLength(0);
  });
});
