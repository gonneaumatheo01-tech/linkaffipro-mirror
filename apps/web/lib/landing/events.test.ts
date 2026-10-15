import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queued: Array<{ queue: string; data: unknown; opts: unknown }> = [];
vi.mock("@linkaffipro/queue", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@linkaffipro/queue")>();
  return {
    ...orig,
    enqueue: async (queue: string, data: unknown, opts: unknown) => {
      queued.push({ queue, data, opts });
      return { id: "job" };
    },
  };
});

const {
  LandingBeaconLimiter,
  beaconRequestInfo,
  ipBucket,
  landingEventInput,
  parseLandingBeacon,
  pendingLandingAdds,
  readBeaconBody,
  recordLandingBeacon,
  sameOriginBeacon,
} = await import("./events");
const { LandingCache } = await import("./cache");

const TIKTOK_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6";

function beacon(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    p: "p1",
    s: "tk01",
    v: "a1b2c3d4e5f6a7b8c9d0e1f2",
    t: "CLICK",
    m: "tg_scheme",
    q: "?src=tk01&ttclid=TT-123&fbclid=FB.9",
    ...over,
  });
}

describe("envoi des visites et clics : lecture", () => {
  it("lit un envoi complet (méthode en majuscules, ttclid / fbclid de l'adresse)", () => {
    expect(parseLandingBeacon(beacon())).toEqual({
      pageId: "p1",
      sourceKey: "tk01",
      visitId: "a1b2c3d4e5f6a7b8c9d0e1f2",
      type: "CLICK",
      method: "TG_SCHEME",
      rawSrc: null,
      ttclid: "TT-123",
      fbclid: "FB.9",
    });
  });

  it("garde le ?src= non suivi pour le diagnostic (source inconnue : page par défaut)", () => {
    expect(parseLandingBeacon(beacon({ s: "", q: "?src=exo9" }))).toMatchObject({
      sourceKey: "",
      rawSrc: "exo9",
    });
    expect(parseLandingBeacon(beacon({ s: "tk01", q: "?src=TK01" }))?.rawSrc).toBeNull();
    expect(parseLandingBeacon(beacon({ s: "", q: "" }))?.rawSrc).toBeNull();
    // Clé de source trafiquée : source par défaut, valeur gardée.
    expect(parseLandingBeacon(beacon({ s: "<x>", q: "" }))).toMatchObject({
      sourceKey: "",
      rawSrc: "<x>",
    });
  });

  it("pas de méthode pour une visite ; envois illisibles ignorés", () => {
    expect(parseLandingBeacon(beacon({ t: "VIEW", m: "TG_SCHEME" }))?.method).toBeNull();
    expect(parseLandingBeacon("pas du json")).toBeNull();
    expect(parseLandingBeacon("[]")).toBeNull();
    expect(parseLandingBeacon(beacon({ t: "BUY" }))).toBeNull();
    expect(parseLandingBeacon(beacon({ v: "court" }))).toBeNull();
    expect(parseLandingBeacon(beacon({ p: "x y" }))).toBeNull();
    expect(parseLandingBeacon(beacon({ q: "?ttclid=" + "x".repeat(5000) }))).toBeNull();
  });

  it("lit le corps dans la limite de 4 Ko", async () => {
    const ok = new Request("https://go.goolink.eu/j/_e", { method: "POST", body: beacon() });
    expect(await readBeaconBody(ok)).toBe(beacon());
    const big = new Request("https://go.goolink.eu/j/_e", {
      method: "POST",
      body: "x".repeat(5000),
    });
    expect(await readBeaconBody(big)).toBeNull();
    const declared = new Request("https://go.goolink.eu/j/_e", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999999" },
    });
    expect(await readBeaconBody(declared)).toBeNull();
  });

  it("refuse un envoi venu d'une autre origine, accepte la même ou aucune", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(sameOriginBeacon(h({ host: "go.goolink.eu", origin: "https://go.goolink.eu" }))).toBe(
      true,
    );
    expect(
      sameOriginBeacon(
        h({
          host: "web.internal:8080",
          "x-forwarded-host": "go.goolink.eu",
          origin: "https://go.goolink.eu",
        }),
      ),
    ).toBe(true);
    expect(sameOriginBeacon(h({ host: "go.goolink.eu" }))).toBe(true);
    expect(sameOriginBeacon(h({ host: "go.goolink.eu", origin: "https://evil.example" }))).toBe(
      false,
    );
  });
});

describe("envoi des visites et clics : ligne mise en file", () => {
  beforeEach(() => {
    vi.stubEnv("IP_HASH_SALT", "sel-test");
    queued.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("système, navigateur intégré, empreinte et pays, jamais l'adresse IP", () => {
    const req = new Request("https://go.goolink.eu/j/_e", {
      method: "POST",
      headers: { "user-agent": TIKTOK_IOS, "x-forwarded-for": "90.84.1.1, 10.0.0.1" },
    });
    const info = beaconRequestInfo(req, new Date("2026-10-15T10:00:00Z"));
    const input = landingEventInput(parseLandingBeacon(beacon())!, info, { country: "FR" });
    expect(input).toMatchObject({
      landingPageId: "p1",
      type: "CLICK",
      sourceKey: "tk01",
      os: "IOS",
      inApp: "TIKTOK",
      method: "TG_SCHEME",
      country: "FR",
      isBot: false,
      ttclid: "TT-123",
      fbclid: "FB.9",
      userAgent: TIKTOK_IOS,
    });
    expect(input.ipHash).toHaveLength(64);
    expect(JSON.stringify(input)).not.toContain("90.84.1.1");
  });

  it("robot connu : enregistré mais marqué (jamais compté)", () => {
    const req = new Request("https://go.goolink.eu/j/_e", {
      method: "POST",
      headers: { "user-agent": "facebookexternalhit/1.1" },
    });
    const input = landingEventInput(parseLandingBeacon(beacon())!, beaconRequestInfo(req), {
      country: null,
    });
    expect(input.isBot).toBe(true);
    expect(input.ipHash).toBeNull();
  });

  it("met en file une page connue ; ignore une page inconnue ou un envoi d'ailleurs", async () => {
    const cache = new LandingCache({
      store: {
        loadActive: async () => [],
        loadBySlug: async () => null,
        pageExists: async (id) => id === "p1",
        loadPhotos: async () => [],
      },
    });
    const info = {
      userAgent: TIKTOK_IOS,
      ip: "90.84.1.1",
      sameOrigin: true,
      receivedAt: new Date("2026-10-15T10:00:00Z"),
    };
    const country = async () => "FR";
    const queueState = () => "ready";
    expect(await recordLandingBeacon(beacon(), info, { cache, country, queueState })).toBe(
      "queued",
    );
    expect(await recordLandingBeacon(beacon({ p: "p2" }), info, { cache, country })).toBe(
      "unknown-page",
    );
    expect(
      await recordLandingBeacon(beacon(), { ...info, sameOrigin: false }, { cache, country }),
    ).toBe("ignored");
    expect(await recordLandingBeacon(null, info, { cache, country })).toBe("ignored");
    expect(queued).toHaveLength(1);
    const job = queued[0]! as {
      queue: string;
      data: { type: string; event: Record<string, unknown> };
      opts: { jobId: string };
    };
    expect(job.queue).toBe("landing-events");
    expect(job.data.type).toBe("event");
    expect(job.data.event).toMatchObject({
      landingPageId: "p1",
      type: "CLICK",
      country: "FR",
      createdAt: "2026-10-15T10:00:00.000Z",
    });
    expect(job.opts.jobId).toBe(`landing-event:${job.data.event.id as string}`);
    expect(JSON.stringify(job)).not.toContain("90.84.1.1");
  });
});

describe("envoi des visites et clics : garde-fous", () => {
  const knownPage = () =>
    new LandingCache({
      store: {
        loadActive: async () => [],
        loadBySlug: async () => null,
        pageExists: async (id) => id === "p1",
        loadPhotos: async () => [],
      },
    });
  const at = new Date("2026-10-15T10:00:00Z");
  const info = (ip: string, offsetMs = 0) => ({
    userAgent: TIKTOK_IOS,
    ip,
    sameOrigin: true,
    receivedAt: new Date(at.getTime() + offsetMs),
  });
  const country = async () => "FR";
  const queueState = () => "ready";

  beforeEach(() => {
    queued.length = 0;
  });

  it("bloc d'adresse : IPv4 entière, IPv6 par /64 (un abonné)", () => {
    expect(ipBucket("90.84.1.1")).toBe("90.84.1.1");
    expect(ipBucket("2a01:cb00:12:3400:aaaa:bbbb:cccc:dddd")).toBe("2a01:cb00:12:3400");
    expect(ipBucket("2a01:cb00:0012:3400::1")).toBe("2a01:cb00:12:3400");
    expect(ipBucket("2a01:cb00::1")).toBe("2a01:cb00:0:0");
    expect(ipBucket("::1")).toBe("0:0:0:0");
    expect(ipBucket(null)).toBe("?");
  });

  it("flot d'envois fabriqués depuis une adresse : au plus 60 par minute, puis de nouveau la minute suivante", async () => {
    const limiter = new LandingBeaconLimiter();
    const cache = knownPage();
    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      // Identifiant de visite aléatoire à chaque envoi, comme un robot qui imite un navigateur.
      const v = `flood${String(i).padStart(10, "0")}`;
      results.push(
        await recordLandingBeacon(beacon({ t: "VIEW", v }), info("203.0.113.9", i * 100), {
          cache,
          country,
          queueState,
          limiter,
        }),
      );
    }
    expect(results.filter((r) => r === "queued")).toHaveLength(60);
    expect(results.filter((r) => r === "rate-limited")).toHaveLength(40);
    expect(queued).toHaveLength(60);
    // Une autre adresse n'est pas touchée.
    expect(
      await recordLandingBeacon(beacon({ v: "otherip00000001" }), info("198.51.100.7", 1000), {
        cache,
        country,
        queueState,
        limiter,
      }),
    ).toBe("queued");
    // Minute suivante : de nouveau accepté.
    expect(
      await recordLandingBeacon(beacon({ v: "later000000001" }), info("203.0.113.9", 61_000), {
        cache,
        country,
        queueState,
        limiter,
      }),
    ).toBe("queued");
    expect(limiter.size().ips).toBe(2);
    // IPv6 : les adresses d'un même bloc /64 (un seul abonné) partagent le compteur.
    const v6 = new LandingBeaconLimiter();
    let ok = 0;
    for (let i = 0; i < 70; i++)
      if (v6.allow(`2a01:cb00:12:3400::${i.toString(16)}`, "p1", `v6visit${i}0000000`, "VIEW", 0))
        ok++;
    expect(ok).toBe(60);
  });

  it("par visite : 3 VIEW, 10 CLICK et 10 OPENED au plus (rechargements et appuis répétés gardés)", async () => {
    const limiter = new LandingBeaconLimiter();
    const cache = knownPage();
    const send = async (t: string, ip: string) =>
      recordLandingBeacon(beacon({ t, v: "samevisit000001" }), info(ip), {
        cache,
        country,
        queueState,
        limiter,
      });
    const views = [];
    for (let i = 0; i < 5; i++) views.push(await send("VIEW", `10.0.0.${i}`));
    expect(views).toEqual(["queued", "queued", "queued", "rate-limited", "rate-limited"]);
    const clicks = [];
    for (let i = 0; i < 12; i++) clicks.push(await send("CLICK", `10.0.1.${i}`));
    expect(clicks.filter((r) => r === "queued")).toHaveLength(10);
    expect(await send("OPENED", "10.0.2.1")).toBe("queued");
  });

  it("Redis coupé : rien n'est empilé en mémoire, la mise en file reprend à son retour", async () => {
    const limiter = new LandingBeaconLimiter();
    const cache = knownPage();
    const calls: string[] = [];
    const enqueueSpy = (async (name: string) => {
      calls.push(name);
      return { id: "job" };
    }) as never;
    for (const state of ["reconnecting", "close", "end"]) {
      expect(
        await recordLandingBeacon(beacon({ v: `down${state}000001` }), info("192.0.2.1"), {
          cache,
          country,
          limiter,
          queueState: () => state,
          enqueue: enqueueSpy,
        }),
      ).toBe("queue-unavailable");
    }
    expect(calls).toEqual([]);
    for (const state of ["ready", "connecting"]) {
      expect(
        await recordLandingBeacon(beacon({ v: `up${state}00000001` }), info("192.0.2.2"), {
          cache,
          country,
          limiter,
          queueState: () => state,
          enqueue: enqueueSpy,
        }),
      ).toBe("queued");
    }
    expect(calls).toEqual(["landing-events", "landing-events"]);
  });

  it("Redis qui ne répond plus : au-delà d'un nombre borné d'ajouts en attente, les envois sont ignorés", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new LandingBeaconLimiter();
      const cache = knownPage();
      // Ajouts qui ne se terminent jamais (commandes gardées par la connexion tant que Redis est coupé).
      const releases: Array<() => void> = [];
      const hanging = (() => new Promise((r) => releases.push(() => r({ id: "job" })))) as never;
      const opts = { cache, country, limiter, queueState, enqueue: hanging, maxPendingAdds: 3 };
      const results: Array<Promise<string>> = [];
      for (let i = 0; i < 3; i++)
        results.push(
          recordLandingBeacon(beacon({ v: `slow${i}0000000001` }), info(`192.0.2.${i}`), opts),
        );
      await vi.advanceTimersByTimeAsync(10);
      expect(pendingLandingAdds()).toBe(3);
      expect(
        await recordLandingBeacon(beacon({ v: "slow90000000001" }), info("192.0.2.9"), opts),
      ).toBe("queue-unavailable");
      // Délai de 2 s dépassé : la réponse est « erreur de file », les ajouts restent comptés.
      await vi.advanceTimersByTimeAsync(2100);
      expect(await Promise.all(results)).toEqual(["queue-error", "queue-error", "queue-error"]);
      expect(pendingLandingAdds()).toBe(3);
      // Redis revient : les commandes partent, la place se libère.
      for (const r of releases) r();
      await vi.advanceTimersByTimeAsync(1);
      expect(pendingLandingAdds()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
