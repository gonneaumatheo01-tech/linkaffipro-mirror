import { afterEach, describe, expect, it, vi } from "vitest";

const preloadLandingCache = vi.fn<() => Promise<boolean>>();
vi.mock("./lib/landing/cache", () => ({ preloadLandingCache }));

const { landingPreloadWanted, register, startLandingPreload } = await import("./instrumentation");

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("démarrage du serveur : préchargement des pages d'atterrissage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    preloadLandingCache.mockReset();
    vi.restoreAllMocks();
  });

  it("seulement dans le serveur Node, jamais pendant le build, les tests ou avec LANDING_PRELOAD=0", () => {
    expect(landingPreloadWanted({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production" })).toBe(true);
    expect(landingPreloadWanted({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" })).toBe(true);
    expect(landingPreloadWanted({ NEXT_RUNTIME: "edge", NODE_ENV: "production" })).toBe(false);
    expect(landingPreloadWanted({ NODE_ENV: "production" })).toBe(false);
    expect(landingPreloadWanted({ NEXT_RUNTIME: "nodejs", VITEST: "true" })).toBe(false);
    expect(landingPreloadWanted({ NEXT_RUNTIME: "nodejs", NODE_ENV: "test" })).toBe(false);
    expect(
      landingPreloadWanted({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" }),
    ).toBe(false);
    expect(landingPreloadWanted({ NEXT_RUNTIME: "nodejs", LANDING_PRELOAD: "0" })).toBe(false);
  });

  it("register() lance la lecture sans l'attendre : une base lente ne retarde jamais le démarrage", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("VITEST", undefined);
    vi.stubEnv("NODE_ENV", "production");
    let finish!: (ok: boolean) => void;
    preloadLandingCache.mockReturnValue(new Promise<boolean>((r) => (finish = r)));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await register(); // rend la main alors que la lecture n'est pas finie
    await flush();
    expect(preloadLandingCache).toHaveBeenCalledTimes(1);
    finish(true);
    await flush();
    expect(console.info).toHaveBeenCalledWith(
      "[landing] pages préchargées",
      expect.objectContaining({ ms: expect.any(Number) }),
    );
  });

  it("dans les tests : rien n'est lancé", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    await flush();
    expect(preloadLandingCache).not.toHaveBeenCalled();
  });

  it("base ou Redis injoignables : aucune erreur ne remonte, un avertissement seulement", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    startLandingPreload(() => Promise.reject(new Error("connexion refusée")));
    startLandingPreload(() => {
      throw new Error("module illisible");
    });
    await flush();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]![0]).toBe("[landing] préchargement des pages impossible");
  });
});
