import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APIFOOTBALL_CALLS_SETTING,
  APIFOOTBALL_SHOTS_SETTING,
  ApiFootballError,
  apiFootballErrorOf,
  createApiFootballClient,
  mapFixture,
  mapShots,
  memoryStore,
  takeApiFootballCall,
  verifyApiFootballKey,
} from "./apifootball";

type Recorded = { responses: Record<string, unknown>; errors: Record<string, unknown> };
const recorded = JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures/apifootball/responses.json", import.meta.url)), "utf8")) as Recorded;

/** Faux `fetch` : rejoue les réponses enregistrées (clé = chemin + requête), compte les appels, vérifie l'en-tête. */
function replay(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const key = `${u.pathname}${u.search}`;
    calls.push(key);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers["x-apisports-key"] !== "cle-de-test") return new Response(JSON.stringify(recorded.errors.token), { status: 200 });
    const body = overrides[key] ?? recorded.responses[key];
    if (!body) return new Response(JSON.stringify({ errors: [], response: [] }), { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const NOW = new Date("2026-10-28T09:00:00Z");

describe("API-Football (statistiques, offre gratuite)", () => {
  it("lit un match et ses tirs cadrés (null = 0 tir cadré)", () => {
    const f = mapFixture((recorded.responses["/fixtures?date=2026-10-28&timezone=Europe%2FParis"] as { response: unknown[] }).response[0]);
    expect(f).toMatchObject({ fixtureId: 9001, leagueId: 39, status: "NS", home: { id: 42, name: "Arsenal" }, away: { id: 49, name: "Chelsea" } });
    expect(f!.kickoffAt.toISOString()).toBe("2026-10-28T20:00:00.000Z");
    const s = mapShots(9001, (recorded.responses["/fixtures/statistics?fixture=9001"] as { response: unknown }).response);
    expect(s).toEqual({ fixtureId: 9001, byTeam: { "42": 6, "49": 0 } });
    expect(mapShots(1, [])).toBeNull();
  });

  it("classe les erreurs du fournisseur (offre, clé, limite) sans jamais citer la clé", () => {
    expect(apiFootballErrorOf(recorded.errors.plan)?.code).toBe("plan");
    expect(apiFootballErrorOf(recorded.errors.token)?.code).toBe("auth");
    expect(apiFootballErrorOf(recorded.errors.requests)?.code).toBe("limit");
    expect(apiFootballErrorOf({ errors: [] })).toBeNull();
    const e = apiFootballErrorOf({ errors: { bug: "cle-secrete refusée" } }, "cle-secrete");
    expect(e?.message).not.toContain("cle-secrete");
  });

  it("garde les matchs du jour, les derniers matchs et les statistiques (pas de second appel)", async () => {
    const store = memoryStore();
    const { fetchImpl, calls } = replay();
    const client = createApiFootballClient({ apiKey: "cle-de-test", store, fetch: fetchImpl, now: () => NOW });
    const day = await client.fixturesOn("2026-10-28");
    expect(day.map((f) => f.fixtureId)).toEqual([9001, 9002, 9003, 9004]);
    // Relu dans le cache : seulement les matchs pas encore commencés.
    expect((await client.fixturesOn("2026-10-28")).map((f) => f.fixtureId)).toEqual([9001, 9002, 9003]);
    const last = await client.lastFixtures(42, 5);
    expect(last).toHaveLength(5);
    expect(last[0]!.kickoffAt.getTime()).toBeGreaterThan(last[4]!.kickoffAt.getTime());
    await client.lastFixtures(42, 5);
    const shots = await client.shotsOnGoal(last[0]!.fixtureId);
    expect(shots?.byTeam["42"]).toBe(7);
    await client.shotsOnGoal(last[0]!.fixtureId);
    expect(calls).toEqual(["/fixtures?date=2026-10-28&timezone=Europe%2FParis", "/fixtures?team=42&last=5&timezone=Europe%2FParis", `/fixtures/statistics?fixture=${last[0]!.fixtureId}`]);
    expect((store.data[APIFOOTBALL_SHOTS_SETTING] as { entries: Record<string, unknown> }).entries[String(last[0]!.fixtureId)]).toBeTruthy();
    expect(store.data[APIFOOTBALL_CALLS_SETTING]).toEqual({ day: "2026-10-28", count: 3 });
  });

  it("refuse au-delà de 90 demandes par jour de Paris, repart à zéro le lendemain", async () => {
    const store = memoryStore({ [APIFOOTBALL_CALLS_SETTING]: { day: "2026-10-28", count: 90 } });
    await expect(takeApiFootballCall(store, NOW)).rejects.toMatchObject({ code: "quota" });
    expect(await takeApiFootballCall(store, new Date("2026-10-29T08:00:00Z"))).toBe(1);
  });

  it("une saison hors offre gratuite donne une erreur claire (jamais un plantage)", async () => {
    const { fetchImpl } = replay({ "/fixtures?date=2026-10-28&timezone=Europe%2FParis": recorded.errors.plan });
    const client = createApiFootballClient({ apiKey: "cle-de-test", store: memoryStore(), fetch: fetchImpl, now: () => NOW });
    const err = await client.fixturesOn("2026-10-28").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFootballError);
    expect((err as ApiFootballError).code).toBe("plan");
    expect((err as Error).message).toMatch(/offre gratuite/);
  });

  it("vérifie une clé gratuitement (/status)", async () => {
    const { fetchImpl } = replay();
    const ok = await verifyApiFootballKey("cle-de-test", fetchImpl);
    expect(ok.ok).toBe(true);
    expect(ok.message).toContain("Free");
    const refused = await verifyApiFootballKey("mauvaise", fetchImpl);
    expect(refused.ok).toBe(false);
    expect(refused.message).not.toContain("mauvaise");
  });
});
