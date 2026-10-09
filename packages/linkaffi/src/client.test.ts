import { describe, expect, it, vi } from "vitest";
import { LinkAffiClient, LinkAffiError } from "./client";

type Handler = (url: string) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

function makeClient(handler: Handler, extra: Partial<ConstructorParameters<typeof LinkAffiClient>[0]> = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("lkst_test");
    expect(headers["apikey"]).toBe("anon_test");
    const r = await handler(url);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  let clock = 0;
  const sleeps: number[] = [];
  const client = new LinkAffiClient({
    baseUrl: "https://api.example/stats-api",
    apiKey: "lkst_test",
    anonKey: "anon_test",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...extra,
  });
  return { client, calls, sleeps, fetchMock };
}

describe("LinkAffiClient", () => {
  it("liste les tables", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, body: { tables: ["clicks", "players"] } }));
    expect(await client.listTables()).toEqual(["clicks", "players"]);
    expect(calls[0]).toBe("https://api.example/stats-api");
  });

  it("construit les paramètres de requête", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, body: { table: "clicks", total: 0, offset: 0, limit: 10, count: 0, rows: [] } }));
    await client.getPage("clicks", { from: "2026-09-01", to: "2026-09-30", date_col: "updated_at", limit: 10, offset: 20, order: "-created_at", eq: { affiliate_id: "abc" } });
    expect(calls[0]).toBe("https://api.example/stats-api/clicks?from=2026-09-01&to=2026-09-30&date_col=updated_at&limit=10&offset=20&order=-created_at&eq.affiliate_id=abc");
  });

  it("plafonne limit à 5000", async () => {
    const { client, calls } = makeClient(() => ({ status: 200, body: { table: "x", total: 0, offset: 0, limit: 5000, count: 0, rows: [] } }));
    await client.getPage("x", { limit: 99999 });
    expect(calls[0]).toContain("limit=5000");
  });

  it("pagine jusqu'à total", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i }));
    const { client, calls } = makeClient((url) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit"));
      const slice = rows.slice(offset, offset + limit);
      return { status: 200, body: { table: "players", total: rows.length, offset, limit, count: slice.length, rows: slice } };
    });
    const all = await client.getAll<{ id: number }>("players", { limit: 3 });
    expect(all.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(calls).toHaveLength(3);
  });

  it("respecte une requête par seconde", async () => {
    const { client, sleeps } = makeClient(() => ({ status: 200, body: { table: "x", total: 0, offset: 0, limit: 1, count: 0, rows: [] } }), { minIntervalMs: 1000 });
    await Promise.all([client.count("x"), client.count("x"), client.count("x")]);
    expect(sleeps.filter((s) => s === 1000)).toHaveLength(2);
  });

  it("réessaie sur 429 puis réussit", async () => {
    let n = 0;
    const { client, sleeps } = makeClient(() => (++n < 3 ? { status: 429 } : { status: 200, body: { table: "x", total: 1, offset: 0, limit: 1, count: 1, rows: [{}] } }));
    expect(await client.count("x")).toBe(1);
    expect(n).toBe(3);
    expect(sleeps).toContain(1000);
    expect(sleeps).toContain(2000);
  });

  it("n'insiste pas sur 401", async () => {
    let n = 0;
    const { client } = makeClient(() => (n++, { status: 401 }));
    await expect(client.count("x")).rejects.toBeInstanceOf(LinkAffiError);
    expect(n).toBe(1);
  });

  it("abandonne après le nombre maximal de tentatives", async () => {
    let n = 0;
    const { client } = makeClient(() => (n++, { status: 503 }), { maxAttempts: 2 });
    await expect(client.count("x")).rejects.toMatchObject({ status: 503, retryable: true });
    expect(n).toBe(2);
  });

  it("exige les clés", () => {
    expect(() => new LinkAffiClient({ baseUrl: "https://x", apiKey: "", anonKey: "" })).toThrow(/LINKAFFI_API_KEY/);
  });
});
