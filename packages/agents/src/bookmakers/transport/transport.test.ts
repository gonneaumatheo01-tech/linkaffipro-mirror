/**
 * Phase 35, chantier A : transport des bookmakers sans navigateur ni réseau (faux client Prisma, faux transports,
 * faux contexte de requêtes) : file des travaux, verrou par site, rythme, nuit, choix serveur / Mac, transport Mac,
 * appels d'API du transport serveur, exécution d'un travail par le worker.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { BookmakerTransport } from "../contract";
import {
  claimReadJob,
  enqueueReadJob,
  finishReadJob,
  macAlive,
  MAC_HEARTBEAT_KEY,
  readReadJob,
  secretInParams,
  sweepReadJobs,
  writeMacHeartbeat,
} from "../jobs";
import { memoryTransportEnv } from "./env";
import { executeReadJob } from "./execute";
import { SiteLockBusy, SITE_LOCK_PREFIX, withSiteLock } from "./lock";
import { createMacTransport } from "./mac";
import { firstTarget, pickTransport, SERVER_RETRY_MS } from "./pick";
import { createMemoryPaceStore, isParisNight, paceSite, paceWaitMs, readAllowedAt, type PaceClock } from "./pace";
import { createServerTransport, sessionHeaders, type ApiRequestLike, type ApiResponseLike } from "./server";

const DAY = new Date("2026-11-10T14:00:00Z"); // 15 h à Paris
const SITE = { key: "celsius", label: "Celsius", baseUrl: "https://celsius.games", allowedHosts: ["celsius.games"] };

function clockAt(start: Date) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("file des travaux de lecture", () => {
  it("aucun secret dans params (noms d'en-têtes permis)", async () => {
    expect(secretInParams({ req: { url: "https://x/y", headers: ["authorization", "x-csrf-token"] } })).toBeNull();
    expect(secretInParams({ password: "abc" })).toBe("params.password");
    expect(secretInParams({ req: { session: { cookies: [] } } })).toBe("params.req.session");
    expect(secretInParams({ note: "Bearer abcdef" })).toBe("params.note");
    expect(secretInParams({ x: ["lapcr_abcdefgh"] })).toBe("params.x[0]");
    const prisma = createFakePrisma();
    await expect(enqueueReadJob({ prisma }, { siteKey: "celsius", kind: "page", target: "mac", params: { login: "moi@x.fr" } })).rejects.toThrow(/secret refusé/);
    expect(await prisma.bookmakerReadJob.count()).toBe(0);
  });

  it("prise atomique : deux preneurs, un seul gagne", async () => {
    const prisma = createFakePrisma();
    await enqueueReadJob({ prisma }, { siteKey: "celsius", kind: "events", target: "server" });
    const [a, b] = await Promise.all([claimReadJob({ prisma }, { target: "server" }), claimReadJob({ prisma }, { target: "server" })]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("ménage : pris depuis 15 min → rendu une fois, puis abandonné", async () => {
    const prisma = createFakePrisma();
    const c = clockAt(DAY);
    const deps = { prisma, now: c.now };
    const job = await enqueueReadJob(deps, { siteKey: "celsius", kind: "events", target: "server" });
    await claimReadJob(deps, { target: "server" });
    c.advance(16 * 60_000);
    expect(await sweepReadJobs(deps)).toEqual({ released: 1, failed: 0 });
    expect((await readReadJob(deps, job.id))?.status).toBe("PENDING");
    await claimReadJob(deps, { target: "server" });
    c.advance(16 * 60_000);
    expect(await sweepReadJobs(deps)).toEqual({ released: 0, failed: 1 });
    expect((await readReadJob(deps, job.id))?.status).toBe("FAILED");
  });

  it("battement du Mac : vivant moins de 2 min", async () => {
    const prisma = createFakePrisma();
    const c = clockAt(DAY);
    await writeMacHeartbeat({ prisma, now: c.now }, { kinds: ["page"] });
    expect(await macAlive({ prisma, now: c.now })).toBe(true);
    c.advance(2 * 60_000 + 1);
    expect(await macAlive({ prisma, now: c.now })).toBe(false);
  });
});

describe("verrou par site", () => {
  it("un seul lecteur, réentrant, rendu même en cas d'erreur", async () => {
    const prisma = createFakePrisma();
    let inner = "";
    await withSiteLock({ prisma }, "celsius", async () => {
      await expect(withSiteLock({ prisma }, "celsius", async () => "x", { waitMs: 0, owner: "autre" })).resolves.toBe("x"); // même chaîne : réentrant
      inner = await withSiteLock({ prisma }, "sportaza", async () => "autre site");
    });
    expect(inner).toBe("autre site");
    expect(await prisma.setting.count({ where: { key: { startsWith: SITE_LOCK_PREFIX } } })).toBe(0);
    await expect(withSiteLock({ prisma }, "celsius", async () => Promise.reject(new Error("boum")))).rejects.toThrow("boum");
    expect(await prisma.setting.count({ where: { key: { startsWith: SITE_LOCK_PREFIX } } })).toBe(0);
  });

  it("site occupé par un autre processus → SiteLockBusy ; abandonné après 10 min → repris", async () => {
    const c = clockAt(DAY);
    const prisma = createFakePrisma({
      setting: [{ key: `${SITE_LOCK_PREFIX}celsius`, value: { token: "worker:1", owner: "worker", expiresAt: new Date(DAY.getTime() + 10 * 60_000).toISOString() } }],
    });
    await expect(withSiteLock({ prisma, now: c.now }, "celsius", async () => 1, { waitMs: 0 })).rejects.toBeInstanceOf(SiteLockBusy);
    c.advance(10 * 60_000 + 1);
    await expect(withSiteLock({ prisma, now: c.now }, "celsius", async () => 2, { waitMs: 0 })).resolves.toBe(2);
  });
});

describe("rythme et nuit", () => {
  function fakeClock(start = 1_000_000) {
    let t = start;
    const waits: number[] = [];
    const clock: PaceClock = {
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
      random: () => 0.5,
    };
    return { clock, waits, advance: (ms: number) => (t += ms) };
  }

  it("une page toutes les 2 à 5 s", async () => {
    const { clock, waits } = fakeClock();
    const store = createMemoryPaceStore();
    expect(await paceSite({}, "s", { clock, store })).toBe(0);
    const w = await paceSite({}, "s", { clock, store });
    expect(w).toBeGreaterThanOrEqual(2000);
    expect(w).toBeLessThan(5000);
    expect(waits).toEqual([w]);
    for (const r of [0, 0.999999]) {
      const d = paceWaitMs({ lastPageAt: 0, stamps: [] }, "page", 0, r);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it("jamais plus de 60 requêtes par minute", async () => {
    const { clock } = fakeClock();
    const store = createMemoryPaceStore();
    const stamps: number[] = [];
    for (let i = 0; i < 130; i++) {
      await paceSite({}, "s", { clock, store, kind: "request" });
      stamps.push(clock.now());
    }
    for (let i = 60; i < stamps.length; i++) expect(stamps[i]! - stamps[i - 60]!).toBeGreaterThanOrEqual(60_000);
  });

  it("nuit de Paris 1 h - 7 h, sauf ordre", () => {
    expect(isParisNight(new Date("2026-11-10T00:30:00Z"))).toBe(true); // 1 h 30
    expect(isParisNight(new Date("2026-11-10T05:59:00Z"))).toBe(true); // 6 h 59
    expect(isParisNight(new Date("2026-11-10T06:00:00Z"))).toBe(false); // 7 h
    expect(isParisNight(new Date("2026-11-09T23:59:00Z"))).toBe(false); // 0 h 59
    expect(readAllowedAt(new Date("2026-11-10T02:00:00Z"))).toBe(false);
    expect(readAllowedAt(new Date("2026-11-10T02:00:00Z"), true)).toBe(true);
  });
});

function stubTransport(target: "server" | "mac", obstacle: string | null = null) {
  const calls: string[] = [];
  const t: BookmakerTransport = {
    target,
    fetchApi: async (_s, req) => {
      calls.push(`api ${req.url}`);
      return obstacle ? { obstacle } : { status: 200, body: "{}" };
    },
    page: async (_s, req) => {
      calls.push(`page ${req.url}`);
      return obstacle ? { obstacle } : { url: req.url, html: "<p>ok</p>", text: "ok" };
    },
    record: async () => ({ obstacle: obstacle ?? "x" }),
  };
  return { t, calls, setObstacle: (o: string | null) => (obstacle = o) };
}

describe("choix du transport", () => {
  it("auto : serveur d'abord ; géo-blocage → bascule sur le Mac, notée sur le site", async () => {
    const prisma = createFakePrisma({ bookmakerSite: [{ key: "celsius", label: "Celsius", baseUrl: SITE.baseUrl, readTarget: "auto", statusReason: null }] });
    const c = clockAt(DAY);
    const server = stubTransport("server", "geo_blocked");
    const mac = stubTransport("mac");
    const t = await pickTransport({ prisma, now: c.now }, "celsius", { server: server.t, mac: mac.t });
    const r = await t.page("celsius", { url: "https://celsius.games/sports" });
    expect(r).toMatchObject({ text: "ok" });
    expect(t.lastTarget).toBe("mac");
    expect(server.calls).toHaveLength(1);
    const site = (await prisma.bookmakerSite.findFirst({ where: { key: "celsius" } })) as { readTarget: string; statusReason: string };
    expect(site.readTarget).toBe("mac");
    expect(site.statusReason).toMatch(/Mac/);
    // Appel suivant : le Mac directement.
    await t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/events" });
    expect(server.calls).toHaveLength(1);
    expect(mac.calls).toHaveLength(2);
  });

  it("essai serveur hebdomadaire après une bascule automatique ; réussi → retour en auto", async () => {
    const prisma = createFakePrisma({ bookmakerSite: [{ key: "celsius", label: "Celsius", baseUrl: SITE.baseUrl, readTarget: "auto", statusReason: null }] });
    const c = clockAt(DAY);
    const server = stubTransport("server", "server_refused");
    const mac = stubTransport("mac");
    let t = await pickTransport({ prisma, now: c.now }, "celsius", { server: server.t, mac: mac.t });
    await t.page("celsius", { url: "https://celsius.games/" });
    c.advance(SERVER_RETRY_MS - 1000);
    t = await pickTransport({ prisma, now: c.now }, "celsius", { server: server.t, mac: mac.t });
    await t.page("celsius", { url: "https://celsius.games/" });
    expect(server.calls).toHaveLength(1);
    c.advance(2000);
    server.setObstacle(null);
    t = await pickTransport({ prisma, now: c.now }, "celsius", { server: server.t, mac: mac.t });
    await t.page("celsius", { url: "https://celsius.games/" });
    expect(t.lastTarget).toBe("server");
    expect(((await prisma.bookmakerSite.findFirst({ where: { key: "celsius" } })) as { readTarget: string }).readTarget).toBe("auto");
  });

  it("cible « server » : pas de bascule ; nuit : rien sauf ordre", async () => {
    const prisma = createFakePrisma();
    const server = stubTransport("server", "geo_blocked");
    const mac = stubTransport("mac");
    const t = await pickTransport({ prisma, now: () => DAY }, { key: "celsius", readTarget: "server" }, { server: server.t, mac: mac.t });
    expect(await t.page("celsius", { url: "https://celsius.games/" })).toEqual({ obstacle: "geo_blocked" });
    expect(mac.calls).toHaveLength(0);
    const night = new Date("2026-11-10T02:00:00Z");
    const n = await pickTransport({ prisma, now: () => night }, { key: "celsius", readTarget: "auto" }, { server: server.t, mac: mac.t });
    expect(await n.page("celsius", { url: "https://celsius.games/" })).toEqual({ obstacle: "night" });
    const f = await pickTransport({ prisma, now: () => night }, { key: "celsius", readTarget: "mac" }, { server: server.t, mac: mac.t, force: true });
    expect(await f.page("celsius", { url: "https://celsius.games/" })).toMatchObject({ text: "ok" });
    expect(firstTarget("mac", null, DAY)).toEqual({ first: "mac", fallback: false, serverRetry: false });
  });
});

describe("transport Mac (file BookmakerReadJob)", () => {
  it("Mac muet depuis 2 min → mac_absent sans rien déposer", async () => {
    const prisma = createFakePrisma();
    const mac = createMacTransport({ prisma, now: () => DAY });
    expect(await mac.page("celsius", { url: "https://celsius.games/" })).toMatchObject({ obstacle: "mac_absent" });
    expect(await prisma.bookmakerReadJob.count()).toBe(0);
  });

  it("le Mac prend le travail et rend la page ; aucun secret dans params ; la ligne ne garde qu'un résumé", async () => {
    const prisma = createFakePrisma();
    const c = clockAt(DAY);
    const deps = { prisma, now: c.now };
    await writeMacHeartbeat(deps, { kinds: ["page"] });
    const mac = createMacTransport(deps, {
      pollMs: 1000,
      sleep: async (ms) => {
        c.advance(ms);
        const j = await claimReadJob(deps, { target: "mac", kinds: ["page", "fetch-api"] });
        if (j) await finishReadJob(deps, j.id, "DONE", { value: { url: "https://celsius.games/sports", html: "<b>x</b>".repeat(100), text: "x", stepsUsed: [0] } });
      },
    });
    const r = await mac.page("celsius", { url: "https://celsius.games/sports", steps: [{ click: { candidates: [{ text: "Football" }] } }] });
    expect(r).toMatchObject({ url: "https://celsius.games/sports", text: "x" });
    const row = (await prisma.bookmakerReadJob.findFirst({})) as { params: unknown; result: { value?: unknown; summary?: unknown }; target: string };
    expect(row.target).toBe("mac");
    expect(secretInParams(row.params)).toBeNull();
    expect(row.result.value).toBeUndefined();
    expect(row.result.summary).toMatchObject({ htmlBytes: 800 });
  });

  it("délais : 3 min pour une page, puis travail clos", async () => {
    const prisma = createFakePrisma();
    const c = clockAt(DAY);
    const deps = { prisma, now: c.now };
    const mac = createMacTransport(deps, {
      sleep: async (ms) => {
        c.advance(ms);
        await writeMacHeartbeat(deps, { kinds: ["page"] }); // vivant, mais ne prend rien
      },
      pollMs: 10_000,
    });
    await writeMacHeartbeat(deps, { kinds: ["page"] });
    expect(await mac.page("celsius", { url: "https://celsius.games/" })).toMatchObject({ obstacle: "mac_absent" });
    const row = (await prisma.bookmakerReadJob.findFirst({})) as { status: string; finishedAt: Date };
    expect(row.status).toBe("FAILED");
    expect(row.finishedAt.getTime() - DAY.getTime()).toBeGreaterThanOrEqual(3 * 60_000);
    expect(row.finishedAt.getTime() - DAY.getTime()).toBeLessThan(4 * 60_000);
    expect((await prisma.setting.findUnique({ where: { key: MAC_HEARTBEAT_KEY } }))?.value).toBeTruthy();
  });
});

function fakeRequestContext(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; data?: string }> = [];
  const factory = vi.fn(async () => {
    const ctx: ApiRequestLike = {
      fetch: async (url, o) => {
        calls.push({ url, method: o.method, headers: o.headers, ...(o.data ? { data: o.data } : {}) });
        const r = responses.shift() ?? { status: 200, body: "{}" };
        const res: ApiResponseLike = { status: () => r.status, headers: () => ({ "content-type": "application/json", ...(r.headers ?? {}) }), text: async () => r.body ?? "" };
        return res;
      },
      storageState: async () => ({ cookies: [], origins: [] }),
      dispose: async () => undefined,
    };
    return ctx;
  });
  return { factory, calls };
}

describe("transport serveur : appels d'API", () => {
  const session = { cookies: [{ name: "sid", value: "c1" }], origins: [{ origin: "https://celsius.games", localStorage: [{ name: "accessToken", value: "jwt123" }] }] };
  const make = (responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) => {
    const ctx = fakeRequestContext(responses);
    const env = memoryTransportEnv({ site: SITE, session });
    const t = createServerTransport(null, { env, newRequestContext: ctx.factory, pace: async () => undefined });
    return { t, ...ctx };
  };

  it("200 → corps ; jeton du stockage en en-tête, jamais de cookie en en-tête", async () => {
    const { t, calls } = make([{ status: 200, body: '{"events":[]}' }]);
    expect(await t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/events?date=2026-11-10", headers: ["authorization", "cookie"] })).toEqual({ status: 200, body: '{"events":[]}' });
    expect(calls[0]!.headers.authorization).toBe("Bearer jwt123");
    expect(calls[0]!.headers.cookie).toBeUndefined();
  });

  it("401 / 403 → authExpired", async () => {
    expect(await make([{ status: 401 }]).t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/x" })).toEqual({ authExpired: true });
    expect(await make([{ status: 403 }]).t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/x" })).toEqual({ authExpired: true });
  });

  it("garde : méthode, adresse, corps et redirection interdits ; rien n'est envoyé au site", async () => {
    const { t, calls, factory } = make([]);
    expect(await t.fetchApi("celsius", { method: "DELETE", url: "https://celsius.games/api/x" })).toMatchObject({ obstacle: "forbidden_action" });
    expect(await t.fetchApi("celsius", { method: "POST", url: "https://celsius.games/graphql", body: '{"query":"mutation { placeBet(stake: 10) }"}' })).toMatchObject({ obstacle: "forbidden_action" });
    expect(await t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/fr/deposit" })).toMatchObject({ obstacle: "forbidden_action" });
    expect(await t.fetchApi("celsius", { method: "GET", url: "https://evil.example/api" })).toMatchObject({ obstacle: "forbidden_action" });
    expect(factory).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    const r = make([{ status: 302, headers: { location: "/cashier?tab=deposit" } }]);
    expect(await r.t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/events" })).toMatchObject({ obstacle: "forbidden_action" });
    expect(r.calls).toHaveLength(1);
  });

  it("page de géo-blocage en HTML → obstacle", async () => {
    const { t } = make([{ status: 200, headers: { "content-type": "text/html" }, body: "<title>Not available</title><p>This service is not available in your country.</p>" }]);
    expect(await t.fetchApi("celsius", { method: "GET", url: "https://celsius.games/api/x" })).toEqual({ obstacle: "geo_blocked" });
  });

  it("sans navigateur → no_browser ; enregistrement débranché → obstacle", async () => {
    const env = memoryTransportEnv({ site: SITE });
    const t = createServerTransport(null, { env, launch: undefined, pace: async () => undefined, recordSite: null });
    expect(await t.page("celsius", { url: "https://celsius.games/" })).toMatchObject({ obstacle: "no_browser" });
    expect(await t.record("celsius", SITE.baseUrl)).toEqual({ obstacle: "apprentissage indisponible" });
    expect(await t.page("celsius", { url: "https://celsius.games/fr/deposit" })).toMatchObject({ obstacle: "forbidden_action" });
  });

  it("en-têtes : noms seulement, valeurs prises dans la session", () => {
    const h = sessionHeaders(["x-csrf-token", "origin", "host"], { cookies: [{ name: "csrf-token", value: "abc" }], origins: [] }, "https://celsius.games/api", SITE, false);
    expect(h).toMatchObject({ "x-csrf-token": "abc", origin: "https://celsius.games" });
    expect(h.host).toBeUndefined();
  });
});

describe("exécution d'un travail par le worker", () => {
  const server = createServerTransport(null, { env: memoryTransportEnv({ site: SITE }), pace: async () => undefined });

  it("la nuit, une lecture attend (travail rendu) ; un test passe", async () => {
    const prisma = createFakePrisma();
    const night = new Date("2026-11-10T02:00:00Z");
    const deps = { prisma, now: () => night } as never;
    await enqueueReadJob(deps, { siteKey: "celsius", kind: "page", target: "server", params: { req: { url: "https://celsius.games/" } } });
    const j = (await claimReadJob(deps, { target: "server" }))!;
    expect(await executeReadJob(deps, j, { server })).toBe("night");
    expect((await readReadJob(deps, j.id))?.status).toBe("PENDING");
  });

  it("site occupé → rendu sans compter", async () => {
    const prisma = createFakePrisma({
      setting: [{ key: `${SITE_LOCK_PREFIX}celsius`, value: { token: "mac:1", owner: "mac", expiresAt: new Date(DAY.getTime() + 60_000).toISOString() } }],
    });
    const deps = { prisma, now: () => DAY } as never;
    await enqueueReadJob(deps, { siteKey: "celsius", kind: "page", target: "server", params: { req: { url: "https://celsius.games/" } } });
    const j = (await claimReadJob(deps, { target: "server" }))!;
    expect(await executeReadJob(deps, j, { server })).toBe("busy");
    expect((await readReadJob(deps, j.id))).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("travail « mac » orchestré par le worker : lu par le Mac (absent → mac_absent), jamais par le serveur", async () => {
    const prisma = createFakePrisma();
    const deps = { prisma, now: () => DAY } as never;
    const job = await enqueueReadJob(deps, { siteKey: "celsius", kind: "test", target: "mac" });
    const j = (await claimReadJob(deps, { target: "mac", kinds: ["test"] }))!;
    const spy = vi.spyOn(server, "page");
    expect(await executeReadJob(deps, j, { server, mac: createMacTransport(deps) })).toBe("done");
    expect(spy).not.toHaveBeenCalled();
    expect((await readReadJob(deps, job.id))?.result).toMatchObject({ value: { ok: false, obstacle: "mac_absent" }, target: "mac" });
  });
});
