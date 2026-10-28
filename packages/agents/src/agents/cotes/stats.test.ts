// Registre d'abord : il charge les agents dans l'ordre (cycle registre ↔ cycle de vie des missions).
import "../registry";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestKit } from "../../human/test-kit";
import { createApiFootballClient, memoryStore } from "../../providers/apifootball";
import { humanOddsTarget } from "../../sports/stats-source";
import type { AgentContext, Mission } from "../../types";
import { agent } from "./index";

type Recorded = { responses: Record<string, unknown> };
const recorded = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/apifootball/responses.json", import.meta.url)), "utf8")) as Recorded;
const replayFetch = (async (url: string | URL) => {
  const u = new URL(String(url));
  return new Response(JSON.stringify(recorded.responses[`${u.pathname}${u.search}`] ?? { errors: [], response: [] }), { status: 200 });
}) as typeof fetch;

async function setup(site: { readTarget: string; status: string } | null) {
  const kit = createTestKit(new Date("2026-10-28T09:00:00Z"));
  if (site) await kit.prisma.bookmakerSite.create({ data: { key: "celsius", label: "Celsius", isActive: true, ...site } as never });
  const category = await kit.prisma.betCategory.create({
    data: {
      key: "tirs-cadres",
      name: "Tirs cadrés",
      marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-away-game-ou-over"],
      leagues: ["EPL", "FR_LIGUE_1"],
      bookmakers: ["Celsius"],
      minOdds: 1.5,
      maxOdds: 3.5,
      picksPerDay: 1,
      minMinutesBeforeKickoff: 30,
      active: true,
    } as never,
  });
  const row = await kit.prisma.agentMission.create({ data: { teamKey: "sports", status: "RUNNING", kind: "BET", steps: [], currentStep: 0, payload: {} } as never });
  const mission = { ...(row as object), isTest: false, payload: { categoryId: (category as { id: string }).id, oddsSource: "live" } } as unknown as Mission;
  const client = createApiFootballClient({ apiKey: "k", store: memoryStore(), fetch: replayFetch, now: kit.deps.now });
  const ctx = { ...kit.deps, providers: { apifootball: client }, settings: { settings: {}, forbiddenWords: [], maxTextLength: 1024 } } as unknown as AgentContext;
  return { kit, mission, ctx };
}

describe("agent Cotes : site illisible → pari choisi sur statistiques, capture et cote demandées à l'équipe", () => {
  it("bookmaker réglé « l'équipe envoie la capture » : pari sur statistiques, cote estimée, en attente de la capture", async () => {
    const { kit, mission, ctx } = await setup({ readTarget: "human", status: "BLOCKED" });
    const r = await agent.run(mission, ctx);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("capture et cote demandées à l'équipe (Celsius)");
    const pick = kit.tables("bettingPick")[0]!;
    expect(pick).toMatchObject({ bookmaker: "celsius", oddsLevel: "human-pending", status: "PROPOSED" });
    expect(String(pick.eventId)).toMatch(/^apifootball:900[12]$/);
    expect(String(pick.marketId)).toMatch(/^shots_onGoal-(all|away)-game-ou-over$/);
    expect((pick.reasoning as { source: string; targetLabel: string }).source).toBe("stats");
    expect((pick.reasoning as { targetLabel: string }).targetLabel).toBe("Celsius");
    expect((pick.reasoning as { lines: string[] }).lines.length).toBe(2);
    expect(r.output).toMatchObject({ pickId: pick.id, statsSource: true });
  });

  it("cible : site lisible → lecture habituelle ; site absent ou bloqué → l'équipe envoie la capture", async () => {
    const ready = await setup({ readTarget: "auto", status: "READY" });
    expect(await humanOddsTarget(ready.kit.deps, { bookmakers: ["celsius"] })).toBeNull();
    const blocked = await setup({ readTarget: "auto", status: "BLOCKED" });
    expect(await humanOddsTarget(blocked.kit.deps, { bookmakers: ["celsius"] })).toEqual({ key: "celsius", label: "Celsius" });
    const none = await setup(null);
    expect(await humanOddsTarget(none.kit.deps, { bookmakers: ["sportaza"] })).toEqual({ key: "sportaza", label: "Sportaza" });
  });
});
