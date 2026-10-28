/**
 * Phase 32, chantier B — lecteur Link Affi de la prospection : lecture seule par construction (le client n'a aucune
 * méthode d'écriture, chaque requête est un GET sur `stats`, `campaigns` ou `profiles`), agrégats et nom seulement,
 * null sans variables. `fetch` simulé, aucun réseau.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import { describe, expect, it } from "vitest";
import { createLinkAffiReader, createLinkAffiReaderFrom } from "./linkaffi-reader";

const FIX = fileURLToPath(new URL("../../../../packages/agents/fixtures/prospection/learn/", import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(`${FIX}${n}`, "utf8"));

function fakeClient() {
  const stats = load("stats.json") as Record<string, Record<string, Array<Record<string, unknown>>>>;
  const campaigns = load("campaigns.json") as Array<Record<string, unknown>>;
  const profiles = load("profiles.json") as Array<Record<string, unknown>>;
  const requests: Array<{ method: string; url: URL }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ method: init?.method ?? "GET", url });
    const table = url.pathname.split("/").pop()!;
    let rows: Array<Record<string, unknown>> = [];
    if (table === "stats") {
      const id = url.searchParams.get("eq.affiliate_id")!;
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      rows = Object.values(stats[id] ?? {}).flat().filter((r) => String(r.date) >= from && String(r.date) <= to);
    } else if (table === "campaigns") rows = campaigns;
    else if (table === "profiles") rows = profiles.filter((p) => p.id === url.searchParams.get("eq.id"));
    return new Response(JSON.stringify({ table, total: rows.length, offset: 0, limit: 5000, count: rows.length, rows }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new LinkAffiClient({ baseUrl: "https://linkaffi.invalid/stats-api", apiKey: "k", anonKey: "a", minIntervalMs: 0, fetch: fetchImpl, sleep: async () => undefined });
  return { client, requests };
}

describe("lecteur Link Affi de la prospection", () => {
  it("null sans variables LINKAFFI_*", () => {
    expect(createLinkAffiReader({})).toBeNull();
    expect(createLinkAffiReader({ LINKAFFI_API_URL: "https://x.invalid" })).toBeNull();
  });

  it("agrégats d'un affilié (stats, date_col=date), champ manquant noté", async () => {
    const { client, requests } = fakeClient();
    const reader = createLinkAffiReaderFrom(client);
    expect(await reader.affiliateStats("aff-a", "2026-09-01", "2026-09-30")).toEqual({ clicks: 900, regs: 30, ftd: 3, revenueCents: 13500, missing: [] });
    const c = await reader.affiliateStats("aff-c", "2026-10-01", "2026-10-31");
    expect(c.revenueCents).toBeNull();
    expect(c.missing).toEqual(["revenue"]);
    expect(requests[0]!.url.searchParams.get("date_col")).toBe("date");
  });

  it("affiliés récents : identifiant, nom, date ; aucune autre donnée de profiles", async () => {
    const { client, requests } = fakeClient();
    const list = await createLinkAffiReaderFrom(client).recentAffiliates(3);
    expect(list.map((x) => x.affiliateId)).toEqual(["aff-d", "aff-c", "aff-b"]);
    expect(list.map((x) => x.name)).toEqual(["delta_tips", null, "Bravo Paris"]);
    for (const x of list) expect(Object.keys(x).sort()).toEqual(["affiliateId", "firstCampaignAt", "name"]);
    expect(JSON.stringify(list)).not.toMatch(/iban|FR76|secret@|\+336/);
    expect(new Set(requests.map((r) => r.url.pathname.split("/").pop()))).toEqual(new Set(["campaigns", "profiles"]));
  });

  it("lecture seule par construction : que des GET, aucune méthode d'écriture", async () => {
    const { client, requests } = fakeClient();
    const reader = createLinkAffiReaderFrom(client);
    await reader.affiliateStats("aff-b", "2026-09-01", "2026-10-31");
    await reader.recentAffiliates(5);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(requests.every((r) => ["stats", "campaigns", "profiles"].includes(r.url.pathname.split("/").pop()!))).toBe(true);
    const methods = Object.getOwnPropertyNames(LinkAffiClient.prototype);
    for (const m of methods) expect(m).not.toMatch(/^(post|put|patch|delete|insert|update|upsert|write|create|remove)/i);
    const src = readFileSync(fileURLToPath(new URL("./linkaffi-reader.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/method\s*:|POST|PUT|PATCH|DELETE|fetch\(/);
  });
});
