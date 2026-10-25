/**
 * Phase 34 : client du worker des opérations du site. Aucun réseau : `fetch` simulé. La signature produite est
 * vérifiée par la MÊME fonction que la route du site (`verifySiteOpsSignature`, utilisée par
 * `apps/web/lib/site-ops/endpoint-auth.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import { SITE_OPS_PATH, SITE_OPS_SIGNATURE_HEADER, SITE_OPS_TIMESTAMP_HEADER, siteOpsKeyFrom, verifySiteOpsSignature } from "@linkaffipro/agents";
import { createSiteOpsClient, siteOpsClientFromEnv } from "./site-ops-client";

const KEY = siteOpsKeyFrom(Buffer.alloc(32, 9).toString("base64"));
const actor = { userId: "u1", role: "ADMIN" as const, via: "TELEGRAM" as const, telegramUserId: "4242" };

function recorder(responses: Array<() => Promise<Response>>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("plus de réponse");
    return next();
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client des opérations du site (worker)", () => {
  it("signe le corps : la vérification du site l'accepte ; adresse, en-têtes et corps attendus", async () => {
    const { fetchFn, seen } = recorder([ok({ ok: true, message: "Étiquette créée." })]);
    const client = createSiteOpsClient({ baseUrl: "http://web.railway.internal:8080/", key: KEY, fetch: fetchFn, now: () => 1_761_400_000_000 });
    const r = await client({ op: "reglages.etiquette_creer", input: { nom: "VIP" }, actor, dryRun: false });
    expect(r).toEqual({ ok: true, message: "Étiquette créée." });
    expect(seen[0]!.url).toBe(`http://web.railway.internal:8080${SITE_OPS_PATH}`);
    const headers = seen[0]!.init.headers as Record<string, string>;
    const body = String(seen[0]!.init.body);
    expect(JSON.parse(body)).toEqual({ op: "reglages.etiquette_creer", input: { nom: "VIP" }, actor, dryRun: false });
    expect(
      verifySiteOpsSignature({ key: KEY, timestamp: headers[SITE_OPS_TIMESTAMP_HEADER], signature: headers[SITE_OPS_SIGNATURE_HEADER], body, now: 1_761_400_000_500 }),
    ).toEqual({ ok: true });
    // Une autre clé (autre APP_ENCRYPTION_KEY) ne vérifie pas.
    expect(verifySiteOpsSignature({ key: siteOpsKeyFrom("x"), timestamp: headers[SITE_OPS_TIMESTAMP_HEADER], signature: headers[SITE_OPS_SIGNATURE_HEADER], body, now: 1_761_400_000_500 }).ok).toBe(false);
  });

  it("erreur du site rendue telle quelle (même avec un statut 401 / 400)", async () => {
    const { fetchFn } = recorder([ok({ ok: false, code: "forbidden", error: "Signature refusée." }, 401)]);
    const client = createSiteOpsClient({ baseUrl: "http://x", key: KEY, fetch: fetchFn });
    expect(await client({ op: "a.b", input: {}, actor, dryRun: true })).toEqual({ ok: false, code: "forbidden", error: "Signature refusée." });
  });

  it("erreur réseau : une reprise pour un essai à blanc, jamais pour une écriture ; réponse illisible = indisponible", async () => {
    const boom = async (): Promise<Response> => {
      throw new Error("ECONNRESET");
    };
    const dry = recorder([boom, ok({ ok: true, message: "" })]);
    const c1 = createSiteOpsClient({ baseUrl: "http://x", key: KEY, fetch: dry.fetchFn });
    expect((await c1({ op: "a.b", input: {}, actor, dryRun: true })).ok).toBe(true);
    expect(dry.seen).toHaveLength(2);
    // Chaque essai a sa propre signature (jamais pris pour un rejeu).
    const write = recorder([boom, ok({ ok: true, message: "" })]);
    const c2 = createSiteOpsClient({ baseUrl: "http://x", key: KEY, fetch: write.fetchFn });
    expect(await c2({ op: "a.b", input: {}, actor, dryRun: false })).toMatchObject({ ok: false, code: "unavailable" });
    expect(write.seen).toHaveLength(1);
    const junk = recorder([async () => new Response("<html>502</html>", { status: 502 })]);
    const c3 = createSiteOpsClient({ baseUrl: "http://x", key: KEY, fetch: junk.fetchFn });
    expect(await c3({ op: "a.b", input: {}, actor, dryRun: false })).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("délai dépassé : abandon (signal), indisponible", async () => {
    const slow = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    const client = createSiteOpsClient({ baseUrl: "http://x", key: KEY, fetch: slow, timeoutMs: 20 });
    expect(await client({ op: "a.b", input: {}, actor, dryRun: false })).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("depuis l'environnement : SITE_OPS_URL puis APP_BASE_URL ; sans clé ni adresse : pas de client", () => {
    expect(siteOpsClientFromEnv({ APP_ENCRYPTION_KEY: "k" })).toBeNull();
    expect(siteOpsClientFromEnv({ APP_BASE_URL: "https://app.linkaffipro.com" })).toBeNull();
    expect(typeof siteOpsClientFromEnv({ APP_BASE_URL: "https://app.linkaffipro.com", APP_ENCRYPTION_KEY: "k" })).toBe("function");
  });
});
