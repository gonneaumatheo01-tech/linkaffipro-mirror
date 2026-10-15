import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { JOB_RETRY_OPTIONS, QUEUE_NAMES, type JobOf } from "./jobs";
import {
  LANDING_INVALIDATE_CHANNEL,
  enqueueLandingEvent,
  landingEventData,
  parseLandingInvalidate,
  publishLandingInvalidate,
  subscribeLandingInvalidate,
  type LandingEventInput,
  type LandingSubscriberClient,
} from "./landing";

const NOW = new Date("2026-10-15T08:00:00.000Z");

const view: LandingEventInput = {
  landingPageId: "page-1",
  type: "VIEW",
  visitId: "v1a2b3c4d5e6",
  sourceKey: "tk01",
  os: "IOS",
  inApp: "TIKTOK",
  country: "FR",
  ipHash: "a".repeat(64),
  isBot: false,
  ttclid: "E.C.P.abc",
  userAgent: "Mozilla/5.0 (iPhone)",
};

describe("file landing-events", () => {
  it("est déclarée avec ses reprises (3 tentatives, attente croissante)", () => {
    expect(QUEUE_NAMES).toContain("landing-events");
    expect(JOB_RETRY_OPTIONS["landing-events"]).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
    const job: JobOf<"landing-events"> = { type: "event", event: landingEventData(view, NOW) };
    expect(job.event.type).toBe("VIEW");
  });
});

describe("ligne à écrire (landingEventData)", () => {
  it("complète l'identifiant, l'heure et les champs absents", () => {
    const d = landingEventData(view, NOW);
    expect(d).toEqual({
      id: d.id,
      landingPageId: "page-1",
      type: "VIEW",
      visitId: "v1a2b3c4d5e6",
      sourceKey: "tk01",
      rawSrc: null,
      os: "IOS",
      inApp: "TIKTOK",
      method: null,
      country: "FR",
      ipHash: "a".repeat(64),
      isBot: false,
      ttclid: "E.C.P.abc",
      fbclid: null,
      userAgent: "Mozilla/5.0 (iPhone)",
      createdAt: "2026-10-15T08:00:00.000Z",
    });
    expect(d.id).toMatch(/^le_[A-Za-z0-9_-]{20,}$/);
    expect(landingEventData(view, NOW).id).not.toBe(d.id);
    expect(
      landingEventData({ ...view, id: "fixe-123", createdAt: "2026-10-14T10:00:00Z" }, NOW),
    ).toMatchObject({
      id: "fixe-123",
      createdAt: "2026-10-14T10:00:00.000Z",
    });
  });

  it("coupe les champs trop longs et ne garde que des valeurs propres (aucune adresse IP)", () => {
    const d = landingEventData(
      {
        ...view,
        rawSrc: "x".repeat(300),
        userAgent: "u".repeat(5000),
        ttclid: "t".repeat(5000),
        fbclid: "f".repeat(5000),
        country: "fr",
        method: "m".repeat(100),
        sourceKey: "s".repeat(100),
        createdAt: "pas une date",
      },
      NOW,
    );
    expect(d.rawSrc).toHaveLength(64);
    expect(d.userAgent).toHaveLength(512);
    expect(d.ttclid).toHaveLength(512);
    expect(d.fbclid).toHaveLength(512);
    expect(d.country).toBe("FR");
    expect(d.method).toHaveLength(32);
    expect(d.sourceKey).toHaveLength(32);
    expect(d.createdAt).toBe(NOW.toISOString());
    expect(landingEventData({ ...view, country: "France" }, NOW).country).toBeNull();
    expect(landingEventData({ ...view, country: "" }, NOW).country).toBeNull();
    expect(Object.keys(d)).not.toContain("ip");
    // Une adresse IP passée par erreur n'est jamais recopiée.
    const withIp = landingEventData({ ...view, ip: "1.2.3.4" } as LandingEventInput, NOW);
    expect(JSON.stringify(withIp)).not.toContain("1.2.3.4");
  });
});

describe("mise en file (enqueueLandingEvent)", () => {
  it("ajoute la tâche avec un identifiant de tâche stable (pas de doublon) et rend la main", async () => {
    const add = vi.fn(async () => ({ id: "job" }));
    const r = await enqueueLandingEvent(view, { add, now: () => NOW });
    expect(r).toEqual({ ok: true, id: expect.any(String) });
    expect(add).toHaveBeenCalledTimes(1);
    const [data, opts] = add.mock.calls[0] as unknown as [
      JobOf<"landing-events">,
      Record<string, unknown>,
    ];
    expect(data.type).toBe("event");
    expect(data.event.id).toBe((r as { id: string }).id);
    expect(opts.jobId).toBe(`landing-event:${data.event.id}`);
    expect(opts).toMatchObject({
      removeOnComplete: expect.any(Number),
      removeOnFail: expect.any(Number),
    });
  });

  it("ne lève jamais : Redis en erreur ou qui ne répond pas → { ok: false } dans le délai", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = await enqueueLandingEvent(view, {
      add: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(failing).toEqual({ ok: false, error: "ECONNREFUSED" });
    const started = Date.now();
    const hanging = await enqueueLandingEvent(view, {
      add: () => new Promise(() => undefined),
      timeoutMs: 30,
    });
    expect(hanging.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    const throwing = await enqueueLandingEvent(view, {
      add: () => {
        throw new Error("REDIS_URL manquante");
      },
    });
    expect(throwing).toEqual({ ok: false, error: "REDIS_URL manquante" });
    warn.mockRestore();
  });
});

describe("invalidation des pages en mémoire (canal Redis landing:invalidate)", () => {
  it("lit un message : page, canal, tout ; message vide ou illisible", () => {
    expect(LANDING_INVALIDATE_CHANNEL).toBe("landing:invalidate");
    expect(parseLandingInvalidate('{"pageId":"p1"}')).toEqual({ pageId: "p1" });
    expect(parseLandingInvalidate('{"channelId":"c1","pageId":"p1"}')).toEqual({
      pageId: "p1",
      channelId: "c1",
    });
    expect(parseLandingInvalidate('{"all":true}')).toEqual({ all: true });
    // Message vide : on vide tout (plus sûr que de garder une page périmée).
    expect(parseLandingInvalidate("{}")).toEqual({ all: true });
    expect(parseLandingInvalidate('{"pageId":42}')).toEqual({ all: true });
    expect(parseLandingInvalidate("pas du json")).toBeNull();
    expect(parseLandingInvalidate('"texte"')).toBeNull();
    expect(parseLandingInvalidate(`{"pageId":"${"x".repeat(200)}"}`)).toEqual({ all: true });
  });

  it("publie le message JSON sur le canal ; ne lève jamais", async () => {
    const publish = vi.fn(async () => 1);
    expect(await publishLandingInvalidate({ pageId: "p1" }, { redis: { publish } })).toBe(true);
    expect(publish).toHaveBeenCalledWith("landing:invalidate", '{"pageId":"p1"}');
    expect(await publishLandingInvalidate({}, { redis: { publish } })).toBe(true);
    expect(publish).toHaveBeenLastCalledWith("landing:invalidate", '{"all":true}');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      await publishLandingInvalidate(
        { channelId: "c1" },
        {
          redis: {
            publish: async () => {
              throw new Error("down");
            },
          },
        },
      ),
    ).toBe(false);
    expect(
      await publishLandingInvalidate(
        { all: true },
        { redis: { publish: () => new Promise(() => undefined) }, timeoutMs: 20 },
      ),
    ).toBe(false);
    expect(
      await publishLandingInvalidate(
        { all: true },
        {
          getRedis: () => {
            throw new Error("REDIS_URL manquante");
          },
        },
      ),
    ).toBe(false);
    warn.mockRestore();
  });

  /** Client d'abonnement simulé (sous-ensemble d'ioredis). */
  function fakeSubscriber() {
    const ee = new EventEmitter();
    const client = Object.assign(ee, {
      subscribed: [] as string[],
      quitCalls: 0,
      subscribe: vi.fn(async (channel: string) => {
        client.subscribed.push(channel);
        return 1;
      }),
      quit: vi.fn(async () => {
        client.quitCalls += 1;
        return "OK";
      }),
    });
    return client as typeof client & LandingSubscriberClient;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("s'abonne au canal, transmet les messages, vide tout après chaque (re)connexion", async () => {
    const client = fakeSubscriber();
    const got: unknown[] = [];
    const sub = subscribeLandingInvalidate((m) => got.push(m), { client });
    await tick();
    expect(client.subscribe).toHaveBeenCalledWith("landing:invalidate");
    // Abonnement confirmé : tout ce qui a pu être chargé avant est vidé (aucun message manqué).
    expect(got).toEqual([{ all: true }]);
    client.emit("message", "landing:invalidate", '{"pageId":"p1"}');
    client.emit("message", "autre:canal", '{"pageId":"p2"}');
    client.emit("message", "landing:invalidate", "illisible");
    expect(got).toEqual([{ all: true }, { pageId: "p1" }]);
    // Reconnexion : les messages publiés pendant la coupure sont perdus → on vide tout une fois réabonné.
    client.emit("ready");
    await tick();
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(got).toEqual([{ all: true }, { pageId: "p1" }, { all: true }]);
    await sub.close();
    expect(client.quitCalls).toBe(1);
    client.emit("message", "landing:invalidate", '{"pageId":"p3"}');
    client.emit("ready");
    await tick();
    expect(got).toHaveLength(3);
    await sub.close();
    expect(client.quitCalls).toBe(1);
  });

  it("au démarrage, l'abonnement en attente de connexion n'est pas doublé (un seul « tout vider »)", async () => {
    const client = fakeSubscriber();
    let release: () => void = () => undefined;
    client.subscribe.mockImplementationOnce(() => new Promise((r) => (release = () => r(1))));
    const got: unknown[] = [];
    const sub = subscribeLandingInvalidate((m) => got.push(m), { client });
    client.emit("ready");
    await tick();
    client.emit("ready");
    release();
    await tick();
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ all: true }]);
    await sub.close();
  });

  it("une erreur du gestionnaire, de Redis ou de l'abonnement ne fait jamais tomber le service", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = fakeSubscriber();
    client.subscribe.mockImplementationOnce(async () => {
      throw new Error("Connection is closed.");
    });
    let calls = 0;
    const sub = subscribeLandingInvalidate(
      () => {
        calls += 1;
        throw new Error("cache cassé");
      },
      { client },
    );
    await tick();
    expect(calls).toBe(0);
    expect(() => client.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(() => client.emit("message", "landing:invalidate", '{"all":true}')).not.toThrow();
    expect(calls).toBe(1);
    client.emit("ready");
    await tick();
    expect(calls).toBe(2);
    await sub.close();
    warn.mockRestore();
  });

  it("sans REDIS_URL : abonnement inactif, sans erreur", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sub = subscribeLandingInvalidate(() => undefined, { url: "" });
    await expect(sub.close()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("file maintenance : tâches des pages d'atterrissage (contrat partagé)", () => {
  it("landing-chats et landing-links font partie de MaintenanceJob : le site peut les mettre en file sans conversion", () => {
    // Vérifié par `pnpm typecheck` : une tâche inconnue de `JobOf<"maintenance">` ne compile pas.
    const jobs: Array<JobOf<"maintenance">> = [{ type: "landing-chats" }, { type: "landing-links" }];
    expect(jobs.map((j) => j.type)).toEqual(["landing-chats", "landing-links"]);
  });
});
