/**
 * Runner du Mac (phase 35, chantier A) sans navigateur ni réseau : faux site (API du runner), faux transport.
 * Service macOS : fichier `launchd` (démarrage à l'ouverture de session, redémarrage, journal, aucun secret).
 */
import { describe, expect, it } from "vitest";
import type { BookmakerRunnerJob, ServerTransport } from "@linkaffipro/agents";
import { buildPlist, plistPath, RUNNER_LABEL, servicePath } from "../../scripts/runner-install";
import { handleReadJob, nextQuery, runnerKinds, runnerPass, type RunnerIo } from "./runner-core";

const SITE = { key: "celsius", label: "Celsius", baseUrl: "https://celsius.games", allowedHosts: ["celsius.games"] };

function job(kind: string, params: Record<string, unknown> = {}): BookmakerRunnerJob {
  return { id: `j-${kind}`, siteKey: "celsius", kind, params, site: SITE, credentials: { login: "moi@exemple.fr", password: "secret-du-test" }, session: { cookies: [{ name: "sid", value: "1" }], origins: [] } };
}

function fakeTransport(saveOnPage = true): ServerTransport & { calls: string[] } {
  const calls: string[] = [];
  let env: { saveSession(k: string, s: unknown): Promise<void> } | null = null;
  const t = {
    target: "mac" as const,
    calls,
    bind(e: typeof env) {
      env = e;
    },
    fetchApi: async (_s: string, req: { url: string }) => {
      calls.push(`api ${req.url}`);
      return { status: 200, body: "{}" };
    },
    page: async (_s: string, req: { url: string }) => {
      calls.push(`page ${req.url}`);
      if (saveOnPage) await env?.saveSession("celsius", { cookies: [{ name: "sid", value: "2" }], origins: [] });
      return { url: req.url, html: "<p>ok</p>", text: "ok", stepsUsed: [] };
    },
    record: async () => ({ obstacle: "x" }),
    visible: async (_s: string, req: { url?: string }) => {
      calls.push(`visible ${req.url}`);
      return { ok: true as const, url: req.url ?? "" };
    },
  };
  return t as unknown as ServerTransport & { calls: string[] };
}

function io(t: ReturnType<typeof fakeTransport>, posted: unknown[], next: Array<{ job: null; readJob: BookmakerRunnerJob | null }>): RunnerIo {
  return {
    log: () => undefined,
    launch: async () => {
      throw new Error("pas de navigateur dans ce test");
    },
    transportFor: (_j, env) => {
      (t as unknown as { bind(e: unknown): void }).bind(env);
      return t;
    },
    call: async <T,>(method: "GET" | "POST", _q: string, body?: unknown): Promise<T> => {
      if (method === "POST") {
        posted.push(body);
        return { ok: true } as T;
      }
      return (next.shift() ?? { job: null, readJob: null }) as T;
    },
  };
}

describe("runner du Mac", () => {
  it("annonce ses sortes et attend longuement", () => {
    expect(runnerKinds()).toEqual(expect.arrayContaining(["fetch-api", "page", "record", "visible", "test"]));
    expect(nextQuery({ kinds: ["page", "test"], waitSec: 20, visible: true })).toMatch(/read=1&kinds=page%2Ctest&wait=20&v=.+&visible=1/);
  });

  it("page : faite par le transport local, session rendue au site, rien d'autre", async () => {
    const t = fakeTransport();
    const posted: unknown[] = [];
    expect(await runnerPass(io(t, posted, [{ job: null, readJob: job("page", { req: { url: "https://celsius.games/sports" } }) }]))).toBe("read");
    expect(t.calls).toEqual(["page https://celsius.games/sports"]);
    const out = posted[0] as { readJobId: string; ok: boolean; value: { text: string }; session: { cookies: Array<{ value: string }> } };
    expect(out).toMatchObject({ readJobId: "j-page", ok: true, value: { text: "ok" } });
    expect(out.session.cookies[0]!.value).toBe("2");
    // Les identifiants ne repartent jamais vers le site (ni dans la valeur ni ailleurs).
    expect(JSON.stringify(out)).not.toContain("secret-du-test");
  });

  it("test et navigateur visible ; rien à faire → idle", async () => {
    const t = fakeTransport(false);
    const posted: unknown[] = [];
    const r = io(t, posted, [{ job: null, readJob: job("test") }, { job: null, readJob: job("visible", { url: "https://celsius.games/" }) }]);
    await runnerPass(r);
    await runnerPass(r);
    expect(await runnerPass(r)).toBe("idle");
    expect(posted[0]).toMatchObject({ ok: true, value: { ok: true }, session: null });
    expect(posted[1]).toMatchObject({ ok: true, value: { ok: true, url: "https://celsius.games/" } });
    expect(t.calls).toEqual(["page https://celsius.games", "visible https://celsius.games/"]);
  });

  it("une erreur ne fait jamais tomber le runner", async () => {
    const t = fakeTransport();
    (t as unknown as { page: unknown }).page = async () => {
      throw new Error("navigateur fermé");
    };
    const out = await handleReadJob(job("page", { req: { url: "https://celsius.games/" } }), io(t, [], []));
    expect(out).toMatchObject({ ok: false, message: "navigateur fermé" });
  });
});

describe("service macOS du runner", () => {
  const plist = buildPlist({ root: "/Users/moi/Projet", nodePath: "/opt/homebrew/bin/node", logFile: "/Users/moi/Projet/logs/bookmaker-runner.log", pathEnv: servicePath("/opt/homebrew/bin/node", "/Users/moi") });

  it("démarre à l'ouverture de session, redémarre s'il tombe, journal dans logs/", () => {
    expect(plist).toContain(`<string>${RUNNER_LABEL}</string>`);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>StandardOutPath<\/key>\s*<string>\/Users\/moi\/Projet\/logs\/bookmaker-runner\.log<\/string>/);
    expect(plist).toContain("apps/worker/scripts/bookmaker-runner.ts");
    expect(plist).toContain("--env-file-if-exists=.env.local");
    expect(plistPath("/Users/moi")).toBe("/Users/moi/Library/LaunchAgents/com.linkaffipro.bookmaker-runner.plist");
  });

  it("aucun secret dans le fichier du service", () => {
    expect(plist).not.toMatch(/TOKEN|PASSWORD|SECRET|lapcr_|Bearer|DATABASE_URL|APP_ENCRYPTION_KEY/i);
    const vars = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(plist)?.[1] ?? "";
    expect([...vars.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual(["PATH"]);
  });
});
