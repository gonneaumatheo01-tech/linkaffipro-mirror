import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateIntegrationApiKey, hashIntegrationApiKey } from "@linkaffipro/core";

/**
 * Enveloppe des routes de l'API d'intégration : clé vérifiée par empreinte, 60 requêtes / minute, erreurs JSON en
 * français, journal de chaque appel sans la clé, date du dernier appel.
 */
const db = vi.hoisted(() => ({
  hash: "",
  audits: [] as Array<{ action: string; userId: unknown; metadata: Record<string, unknown> }>,
  updates: [] as Array<Record<string, unknown>>,
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    integrationKey: {
      findUnique: vi.fn(async ({ where }: { where: { apiKeyHash: string } }) =>
        where.apiKeyHash === db.hash ? { provider: "linkaffi", apiKeyHash: db.hash } : null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.updates.push(data);
        return {};
      }),
    },
  },
  audit: vi.fn(
    async (a: { action: string; userId: unknown; metadata: Record<string, unknown> }) => {
      db.audits.push(a);
    },
  ),
  toJsonValue: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));
vi.mock("@linkaffipro/queue", () => ({
  getRedis: () => {
    throw new Error("pas de Redis dans ce test");
  },
}));

const { linkaffiMethodNotAllowed, linkaffiNotFound, withLinkaffiIntegration } =
  await import("./handler");
const { IntegrationError } = await import("./http");
const { memoryRateStore } = await import("./rate-limit");

const key = generateIntegrationApiKey();
const call = (headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/integrations/linkaffi/v1/channels", { headers });

describe("API d'intégration : enveloppe commune", () => {
  beforeEach(() => {
    db.hash = hashIntegrationApiKey(key);
    db.audits.length = 0;
    db.updates.length = 0;
  });

  it("sans clé ou avec une fausse clé : 401 en français, la route ne tourne pas, l'appel est journalisé", async () => {
    const handler = vi.fn(async () => ({ body: [] }));
    const route = withLinkaffiIntegration("get_channels", handler, {
      rateStore: memoryRateStore(),
    });
    const none = await route(call(), {});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(await none.json()).toEqual({
      error: "unauthorized",
      message: expect.stringMatching(/^Clé de connexion absente/),
    });
    const wrong = await route(call({ authorization: `Bearer ${generateIntegrationApiKey()}` }), {});
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).message).toMatch(/refusée/);
    expect(handler).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(
      db.audits.map((a) => [a.action, a.userId, a.metadata.status, a.metadata.reason]),
    ).toEqual([
      ["integration.linkaffi.get_channels", null, 401, "missing"],
      ["integration.linkaffi.get_channels", null, 401, "invalid"],
    ]);
  });

  it("bonne clé : réponse JSON non mise en cache, date du dernier appel, journal sans la clé", async () => {
    const route = withLinkaffiIntegration(
      "get_channels",
      async () => ({ body: [{ id: "c1" }], metadata: { count: 1 } }),
      { rateStore: memoryRateStore() },
    );
    const res = await route(call({ authorization: `Bearer ${key}` }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual([{ id: "c1" }]);
    expect(db.updates).toEqual([{ lastApiCallAt: expect.any(Date) }]);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      action: "integration.linkaffi.get_channels",
      userId: null,
      metadata: {
        method: "GET",
        path: "/api/integrations/linkaffi/v1/channels",
        status: 200,
        count: 1,
        durationMs: expect.any(Number),
      },
    });
    expect(JSON.stringify(db.audits)).not.toContain(key);
    expect(JSON.stringify(db.audits)).not.toContain(db.hash);
  });

  it("61e appel de la minute : 429 avec Retry-After, journalisé une seule fois par série", async () => {
    let t = 10_000_000;
    const route = withLinkaffiIntegration("get_channels", async () => ({ body: [] }), {
      rateStore: memoryRateStore(),
      now: () => t,
    });
    for (let i = 0; i < 60; i++) {
      t += 10;
      expect((await route(call({ authorization: `Bearer ${key}` }), {})).status).toBe(200);
    }
    t += 10;
    const refused = await route(call({ authorization: `Bearer ${key}` }), {});
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await refused.json()).toEqual({
      error: "rate_limited",
      message: expect.stringMatching(
        /^Trop de requêtes : 60 par minute au plus\. Réessayez dans \d+ secondes?\.$/,
      ),
    });
    await route(call({ authorization: `Bearer ${key}` }), {});
    expect(db.audits.filter((a) => a.metadata.status === 429)).toHaveLength(1);
    // Une minute plus tard, ça repasse.
    t += 60_000;
    expect((await route(call({ authorization: `Bearer ${key}` }), {})).status).toBe(200);
  });

  it("appels sans clé valide : limités par adresse IP (un robot qui essaie des clés est arrêté)", async () => {
    const route = withLinkaffiIntegration("get_channels", async () => ({ body: [] }), {
      rateStore: memoryRateStore(),
    });
    const statuses = [];
    for (let i = 0; i < 61; i++)
      statuses.push((await route(call({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), {})).status);
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses[60]).toBe(429);
    // Une autre adresse n'est pas touchée.
    expect((await route(call({ "x-forwarded-for": "198.51.100.1" }), {})).status).toBe(401);
  });

  it("erreur prévue : son statut et son message ; erreur imprévue : 500 sans détail interne", async () => {
    const expected = withLinkaffiIntegration(
      "post_invite_links",
      async () => {
        throw new IntegrationError(503, "telegram_unavailable", "Telegram ne répond pas.", {
          "Retry-After": "60",
        });
      },
      { rateStore: memoryRateStore() },
    );
    const r1 = await expected(call({ authorization: `Bearer ${key}` }), {});
    expect(r1.status).toBe(503);
    expect(r1.headers.get("retry-after")).toBe("60");
    expect(await r1.json()).toEqual({
      error: "telegram_unavailable",
      message: "Telegram ne répond pas.",
    });
    expect(db.audits.at(-1)).toMatchObject({
      action: "integration.linkaffi.post_invite_links",
      metadata: { status: 503, error: "telegram_unavailable" },
    });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const crash = withLinkaffiIntegration(
      "get_members",
      async () => {
        throw new Error("connexion base perdue : postgres://secret@host");
      },
      { rateStore: memoryRateStore() },
    );
    const r2 = await crash(call({ authorization: `Bearer ${key}` }), {});
    expect(r2.status).toBe(500);
    const body = await r2.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toMatch(/^Erreur interne de la plateforme/);
    expect(JSON.stringify(body)).not.toContain("postgres");
    expect(db.audits.at(-1)).toMatchObject({ metadata: { status: 500, error: "internal_error" } });
  });

  it("méthode non prévue : 405 en JSON avec Allow ; adresse inconnue : 404 en JSON ; journalisés", async () => {
    const auth = { authorization: `Bearer ${key}` };
    const url = "https://app.test/api/integrations/linkaffi/v1/invite-links";
    const notAllowed = linkaffiMethodNotAllowed(["POST"], { rateStore: memoryRateStore() });
    const res = await notAllowed(new Request(url, { method: "GET", headers: auth }), {});
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({
      error: "method_not_allowed",
      message: expect.stringMatching(/^Méthode GET non prévue sur cette adresse : utilisez POST/),
    });
    const notFound = linkaffiNotFound({ rateStore: memoryRateStore() });
    const nf = await notFound(new Request(`${url}/x/y`, { method: "DELETE", headers: auth }), {});
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ error: "not_found" });
    // Sans clé : refusé avant tout (401), comme le reste de l'API.
    expect((await notAllowed(new Request(url, { method: "GET" }), {})).status).toBe(401);
    expect(db.audits.map((a) => [a.action, a.metadata.status, a.metadata.method])).toEqual([
      ["integration.linkaffi.unknown_route", 405, "GET"],
      ["integration.linkaffi.unknown_route", 404, "DELETE"],
      ["integration.linkaffi.unknown_route", 401, "GET"],
    ]);
  });

  it("une clé régénérée invalide aussitôt l'ancienne", async () => {
    const route = withLinkaffiIntegration("get_channels", async () => ({ body: [] }), {
      rateStore: memoryRateStore(),
    });
    expect((await route(call({ authorization: `Bearer ${key}` }), {})).status).toBe(200);
    const fresh = generateIntegrationApiKey();
    db.hash = hashIntegrationApiKey(fresh);
    expect((await route(call({ authorization: `Bearer ${key}` }), {})).status).toBe(401);
    expect((await route(call({ authorization: `Bearer ${fresh}` }), {})).status).toBe(200);
  });
});

describe("API d'intégration : panne de la base avant la route", () => {
  it("la recherche de la clé échoue : 500 en JSON, sans détail interne", async () => {
    const { prisma } = await import("@linkaffipro/db");
    const spy = vi
      .spyOn(prisma.integrationKey, "findUnique")
      .mockRejectedValueOnce(new Error("Can't reach database server at db:5432"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route = withLinkaffiIntegration("get_channels", async () => ({ body: [] }), {
      rateStore: memoryRateStore(),
    });
    const res = await route(call({ authorization: `Bearer ${key}` }), {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("5432");
    spy.mockRestore();
  });
});
