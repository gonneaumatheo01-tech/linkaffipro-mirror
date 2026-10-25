/**
 * Phase 35, chantier D : sites, identifiants communs, gestes (tester, ré-apprendre, navigateur du Mac), santé et
 * crochet de Kevin. Base en mémoire, aucun réseau ; les fonctions des chantiers A / B / C passent par `./ops`, simulé.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ops = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  readEvents: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  readMarkets: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  readOddsTwice: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({
    ok: false,
    reason: "x",
    reads: [],
  })),
  learnSite: vi.fn(async (..._a: unknown[]) => ({ ok: true, status: "READY", message: "prêt" })),
  macAlive: vi.fn(async () => true),
  waitResult: null as Record<string, unknown> | null,
}));

vi.mock("./ops", () => ({
  enqueueReadJob: vi.fn(async (_deps: unknown, i: Record<string, unknown>) => {
    const row = { id: `job${ops.jobs.length + 1}`, status: "PENDING", ...i };
    ops.jobs.push(row);
    return row;
  }),
  waitReadJob: vi.fn(async (_d: unknown, id: string) =>
    ops.waitResult ? { id, ...ops.waitResult } : null,
  ),
  macAlive: ops.macAlive,
  macHeartbeatFresh: (hb: { at: string } | null, now: Date) =>
    !!hb && now.getTime() - new Date(hb.at).getTime() < 120_000,
  readMacHeartbeat: vi.fn(async () => null),
  learnSite: ops.learnSite,
  readEvents: ops.readEvents,
  readMarkets: ops.readMarkets,
  readOddsTwice: ops.readOddsTwice,
}));

process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

import { BOOKMAKER_DEFAULT_CREDENTIALS_KEY } from "./contract";
import {
  addSite,
  ensureDefaultSites,
  matchSite,
  normalizeSiteUrl,
  setSiteUrl,
  siteKeyFromLabel,
  type SiteRow,
} from "./sites";
import {
  CREDENTIALS_ASKED_SETTING,
  DEFAULT_LOGIN_REQUEST_KEY,
  DEFAULT_PASSWORD_REQUEST_KEY,
  TEST_ALL_REQUEST_KEY,
  askBookmakerCredentials,
  readBookmakerCredentialsFor,
} from "./credentials";
import {
  jobOutcome,
  learnResultText,
  openVisibleBrowser,
  pendingFollows,
  relearnSite,
  testFailureReason,
  testSite,
} from "./actions";
import {
  bookmakerKevinHook,
  bookmakersHealth,
  decideStatus,
  failureCause,
  healthRate,
  readSiteHealth,
  relearnAllowed,
  withCheck,
  emptyHealth,
} from "./health";
import { bookmakersStatusView, oddsOfView, pickSelection, siteMatchesView } from "./views";
import { respondToRequest } from "../human/respond";
import { readSecret, saveSecret, secretSettingKey } from "../human/secrets";
import { createFakePrisma, type FakePrisma } from "../testing/fake-prisma";
import { voiceCheck } from "../boss/voice";
import type { AgentsDeps } from "../types";
import type { BookmakerHookEvent } from "./read/deps";

// Jamais un vrai identifiant : valeurs de test seulement.
const TEST_EMAIL = "compte.test@example.com";
const TEST_PASSWORD = "Mdp-de-test-0000";

function kit(start = new Date("2026-10-25T14:00:00Z")) {
  let now = start;
  const prisma: FakePrisma = createFakePrisma({});
  const sent: string[] = [];
  const deps = {
    prisma,
    now: () => now,
    enqueue: { orchestrator: async () => undefined, step: async () => undefined },
    admin: {
      async send(html: string) {
        sent.push(html);
        return { messageId: sent.length };
      },
    },
  } as unknown as AgentsDeps;
  const t = (n: string) => prisma._tables[n] ?? [];
  return {
    prisma,
    deps,
    sent,
    t,
    setNow: (d: Date) => (now = d),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const actor = { userId: "u1", via: "TELEGRAM" as const };

async function withCredentials(k: ReturnType<typeof kit>) {
  await saveSecret(
    k.deps,
    BOOKMAKER_DEFAULT_CREDENTIALS_KEY,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    actor,
  );
}

beforeEach(() => {
  ops.jobs.length = 0;
  ops.waitResult = null;
  ops.readEvents.mockReset().mockResolvedValue([]);
  ops.learnSite.mockReset().mockResolvedValue({ ok: true, status: "READY", message: "prêt" });
  ops.macAlive.mockReset().mockResolvedValue(true);
});

// ------------------------------------------------------------------------------------------------ sites

describe("sites des bookmakers", () => {
  it("sites par défaut : créés une fois, jamais modifiés ensuite (adresse changée gardée)", async () => {
    const k = kit();
    expect((await ensureDefaultSites(k.deps)).created).toEqual([
      "celsius",
      "sportaza",
      "betportal",
    ]);
    expect((await ensureDefaultSites(k.deps)).created).toEqual([]);
    await setSiteUrl(k.deps, "betportal", "betportal.io", actor);
    await ensureDefaultSites(k.deps);
    const bp = k.t("bookmakerSite").find((s) => s.key === "betportal")!;
    expect(bp.baseUrl).toBe("https://betportal.io/");
    expect(bp.status).toBe("NEW");
    expect(k.t("bookmakerSite")).toHaveLength(3);
    expect(k.t("auditLog").some((a) => a.action === "bookmakers.url_changed")).toBe(true);
  });

  it("adresses : https seulement, jamais d'identifiant, de port ni d'adresse de machine", () => {
    expect(normalizeSiteUrl("x.com")).toEqual({ ok: true, url: "https://x.com/" });
    expect(normalizeSiteUrl("https://sportaza.com/fr/sports?a=1#b")).toEqual({
      ok: true,
      url: "https://sportaza.com/fr/sports",
    });
    for (const bad of [
      "http://x.com",
      "ftp://x.com",
      "https://user:pw@x.com",
      "https://x.com:8443",
      "localhost",
      "192.168.1.2",
      "",
      "pas une adresse",
    ])
      expect(normalizeSiteUrl(bad).ok, bad).toBe(false);
  });

  it("noms : « Bet Portal », « betportal.com », « celsius » ; ambigu ou inconnu → null", () => {
    const sites = [
      { key: "celsius", label: "Celsius" },
      { key: "sportaza", label: "Sportaza" },
      { key: "betportal", label: "Bet Portal" },
    ] as SiteRow[];
    expect(siteKeyFromLabel("Bet Portal")).toBe("betportal");
    expect(matchSite(sites, "bet portal")?.key).toBe("betportal");
    expect(matchSite(sites, "https://www.betportal.com/")?.key).toBe("betportal");
    expect(matchSite(sites, "CELSIUS")?.key).toBe("celsius");
    expect(matchSite(sites, "unibet")).toBeNull();
    expect(matchSite(sites, null)).toBeNull();
  });

  it("ajouter un bookmaker : site créé (identifiants communs), journalisé ; adresse refusée sans rien créer", async () => {
    const k = kit();
    const r = await addSite(k.deps, { label: "Unibet", url: "unibet.fr" }, { actor });
    expect(r.ok).toBe(true);
    expect(r.site).toMatchObject({
      key: "unibet",
      baseUrl: "https://unibet.fr/",
      status: "NEW",
      readTarget: "auto",
    });
    expect(k.t("auditLog").some((a) => a.action === "bookmakers.site_added")).toBe(true);
    expect((await addSite(k.deps, { label: "Autre", url: "http://autre.com" }, { actor })).ok).toBe(
      false,
    );
    expect(k.t("bookmakerSite")).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ identifiants

describe("identifiants communs", () => {
  it("demandés une fois en privé (e-mail puis mot de passe), rangés chiffrés ensemble, messages temporaires effacés, puis test proposé", async () => {
    const k = kit();
    expect((await askBookmakerCredentials(k.deps)).reason).toBe("asked");
    const reqs = k.t("humanRequest");
    expect(reqs.map((r) => [r.kind, r.key])).toEqual([
      ["SECRET", DEFAULT_LOGIN_REQUEST_KEY],
      ["SECRET", DEFAULT_PASSWORD_REQUEST_KEY],
    ]);
    for (const r of reqs)
      expect(voiceCheck(String(r.question), { allowLong: true }).ok, String(r.question)).toBe(true);
    // Demande automatique suivante (santé) : jamais une deuxième fois.
    expect((await askBookmakerCredentials(k.deps, { auto: true })).reason).toBe("already_asked");

    await respondToRequest(k.deps, reqs[0] as never, TEST_EMAIL, actor, { deferNext: true });
    const r2 = await respondToRequest(
      k.deps,
      k.t("humanRequest")[1] as never,
      TEST_PASSWORD,
      actor,
      { deferNext: true },
    );
    expect(r2.ok).toBe(true);
    expect(r2.secret).toBe(true);
    expect(JSON.parse((await readSecret(k.prisma, BOOKMAKER_DEFAULT_CREDENTIALS_KEY))!)).toEqual({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    // Les deux réponses temporaires sont effacées.
    expect(k.t("setting").some((s) => s.key === secretSettingKey(DEFAULT_LOGIN_REQUEST_KEY))).toBe(
      false,
    );
    expect(
      k.t("setting").some((s) => s.key === secretSettingKey(DEFAULT_PASSWORD_REQUEST_KEY)),
    ).toBe(false);
    // Puis Kevin propose de tester les sites d'un coup.
    expect(
      k.t("humanRequest").some((r) => r.key === TEST_ALL_REQUEST_KEY && r.kind === "CONFIRM"),
    ).toBe(true);
    // Jamais la valeur dans le journal, les événements ou une question.
    const dump = JSON.stringify([k.t("auditLog"), k.t("event"), k.t("humanRequest")]);
    expect(dump).not.toContain(TEST_PASSWORD);
    expect(dump).not.toContain(TEST_EMAIL);
    // Déjà rangés : plus de question.
    expect((await askBookmakerCredentials(k.deps)).reason).toBe("already_saved");
    expect(k.t("setting").some((s) => s.key === CREDENTIALS_ASKED_SETTING)).toBe(true);
  });

  it("identifiants propres au site prioritaires sur les communs", async () => {
    const k = kit();
    await withCredentials(k);
    expect((await readBookmakerCredentialsFor(k.deps, "celsius"))?.source).toBe("default");
    await saveSecret(k.deps, "providers.bookmakers.celsius.login", "propre@example.com", actor);
    await saveSecret(k.deps, "providers.bookmakers.celsius.password", "Autre-mdp-1111", actor);
    const own = await readBookmakerCredentialsFor(k.deps, "celsius");
    expect(own?.source).toBe("site");
    expect((await readBookmakerCredentialsFor(k.deps, "sportaza"))?.source).toBe("default");
  });
});

// ------------------------------------------------------------------------------------------------ gestes

describe("gestes : tester, ré-apprendre, navigateur du Mac", () => {
  it("tester : sans identifiants refusé ; sinon une lecture déposée, journalisée, résultat dit par Kevin", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    expect((await testSite(k.deps, "sportaza", actor, { follow: false })).ok).toBe(false);
    expect(ops.jobs).toHaveLength(0);
    await withCredentials(k);
    ops.waitResult = {
      status: "DONE",
      result: { value: { ok: true, url: "https://sportaza.com/fr/sports", textBytes: 900 } },
    };
    const r = await testSite(k.deps, "sportaza", actor);
    expect(r.ok).toBe(true);
    expect(ops.jobs[0]).toMatchObject({ siteKey: "sportaza", kind: "test", target: "server" });
    await Promise.all(pendingFollows());
    expect(k.sent.at(-1)).toMatch(/Sportaza/);
    expect(k.sent.at(-1)).toMatch(/aucune mise|sans souci/);
    expect(
      k
        .t("auditLog")
        .some((a) => a.action === "bookmakers.site_tested" && a.entityId === "sportaza"),
    ).toBe(true);
  });

  it("tester : contrôle anti-robot → Kevin dit le geste (ouvrir le navigateur sur le Mac)", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    await withCredentials(k);
    ops.waitResult = {
      status: "NEEDS_HUMAN",
      result: { value: { ok: false, obstacle: "captcha" } },
    };
    await testSite(k.deps, "celsius", actor);
    await Promise.all(pendingFollows());
    expect(k.sent.at(-1)).toMatch(/navigateur sur le Mac/);
    // Le crochet ne le redit pas juste après (même sujet, 6 h).
    expect((await readSiteHealth(k.deps, "celsius")).lastMessage?.key).toBe("blocked:captcha");
  });

  it("ré-apprendre : travail « learn » pour le worker (jamais dans ce processus), pas deux à la fois, Kevin prévient", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    await withCredentials(k);
    ops.waitResult = {
      status: "DONE",
      result: { value: { ok: true, status: "READY", message: "prêt" } },
    };
    const r = await relearnSite(k.deps, "celsius", actor);
    expect(r.ok).toBe(true);
    expect(ops.jobs[0]).toMatchObject({
      kind: "learn",
      siteKey: "celsius",
      params: { reason: "manual" },
    });
    expect(ops.learnSite).not.toHaveBeenCalled();
    await Promise.all(pendingFollows());
    expect(k.sent.at(-1)).toMatch(/Celsius est prêt|C'est bon pour Celsius/);
    // Un travail en attente : pas de deuxième.
    k.prisma
      ._model("bookmakerReadJob")
      .rows.push({
        id: "j9",
        siteKey: "celsius",
        kind: "learn",
        status: "PENDING",
        createdAt: new Date(),
      });
    const again = await relearnSite(k.deps, "celsius", actor, { follow: false });
    expect(again.message).toMatch(/déjà/);
    expect(ops.jobs).toHaveLength(1);
  });

  it("navigateur du Mac : Mac éteint → le dire ; allumé → travail visible sur le Mac", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    ops.macAlive.mockResolvedValue(false);
    expect((await openVisibleBrowser(k.deps, "sportaza", actor, { follow: false })).ok).toBe(false);
    ops.macAlive.mockResolvedValue(true);
    const r = await openVisibleBrowser(k.deps, "sportaza", actor, { follow: false });
    expect(r.ok).toBe(true);
    expect(ops.jobs.at(-1)).toMatchObject({ kind: "visible", target: "mac" });
    expect(k.t("auditLog").filter((a) => a.action === "bookmakers.browser_opened")).toHaveLength(2);
  });

  it("issues lisibles : Mac absent, obstacle, échec ; raisons sans jargon", () => {
    expect(jobOutcome({ status: "DONE", result: { value: { ok: true } } }).ok).toBe(true);
    expect(
      jobOutcome({ status: "DONE", result: { value: { obstacle: "mac_absent" } } }).cause,
    ).toBe("mac_absent");
    expect(
      jobOutcome({ status: "NEEDS_HUMAN", result: { value: { obstacle: "two_factor" } } }).cause,
    ).toBe("two_factor");
    expect(
      jobOutcome({
        status: "FAILED",
        result: { obstacle: "error", message: "Mot de passe refusé" },
      }).ok,
    ).toBe(false);
    expect(testFailureReason("maintenance")).toBe("le site est en maintenance");
    expect(
      learnResultText(
        { key: "x", label: "X" },
        { status: "DONE", result: { value: { ok: false, message: "site refondu." } } },
      ).text,
    ).toMatch(/site refondu/);
  });
});

// ------------------------------------------------------------------------------------------------ santé

describe("santé des bookmakers", () => {
  it("règles pures : 90 % sur 24 h (5 contrôles au moins), 3 échecs → bloqué, obstacle humain → bloqué tout de suite", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(
      decideStatus({
        current: "READY",
        ok: false,
        cause: "unknown",
        consecutiveFailures: 1,
        rate: { total: 2, ratio: 0.5 },
      }),
    ).toBe("READY");
    expect(
      decideStatus({
        current: "READY",
        ok: false,
        cause: "unknown",
        consecutiveFailures: 3,
        rate: { total: 10, ratio: 0.7 },
      }),
    ).toBe("BLOCKED");
    expect(
      decideStatus({
        current: "READY",
        ok: false,
        cause: "captcha",
        consecutiveFailures: 1,
        rate: { total: 10, ratio: 0.95 },
      }),
    ).toBe("BLOCKED");
    expect(
      decideStatus({
        current: "READY",
        ok: true,
        cause: null,
        consecutiveFailures: 0,
        rate: { total: 10, ratio: 0.8 },
      }),
    ).toBe("DEGRADED");
    expect(
      decideStatus({
        current: "BLOCKED",
        ok: true,
        cause: null,
        consecutiveFailures: 0,
        rate: { total: 10, ratio: 0.95 },
      }),
    ).toBe("READY");
    let h = emptyHealth();
    for (let i = 0; i < 4; i++)
      h = withCheck(
        h,
        {
          at: new Date(now.getTime() - i * 60_000).toISOString(),
          ok: i > 0,
          cause: i > 0 ? null : "x",
        },
        now,
      );
    expect(healthRate(h.checks, now)).toMatchObject({ total: 4, ok: 3 });
    expect(relearnAllowed(new Date(now.getTime() - 23 * 3600_000), now)).toBe(false);
    expect(relearnAllowed(new Date(now.getTime() - 25 * 3600_000), now)).toBe(true);
    expect(failureCause({ diagnosis: "two_factor" })).toBe("two_factor");
    expect(failureCause(new Error("aucune lecture la nuit"))).toBe("night");
  });

  it("rien la nuit (1 h - 7 h Paris), sauf ordre", async () => {
    const k = kit(new Date("2026-10-25T02:30:00Z"));
    await ensureDefaultSites(k.deps);
    expect((await bookmakersHealth(k.deps)).skipped).toBe("night");
    expect(ops.readEvents).not.toHaveBeenCalled();
  });

  it("deux échecs → ré-apprentissage automatique (au plus une fois par 24 h) ; trois → bloqué, journal, alerte, Kevin ; retour → prêt", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    k.prisma._model("bookmakerSite").rows.find((s) => s.key === "sportaza")!.status = "READY";
    ops.readEvents.mockRejectedValue(new Error("page inattendue"));
    ops.learnSite.mockResolvedValue({ ok: false, status: "READY", message: "toujours pas" });

    await bookmakersHealth(k.deps);
    expect(ops.learnSite).not.toHaveBeenCalled();
    k.advance(30 * 60_000);
    await bookmakersHealth(k.deps);
    expect(ops.learnSite).toHaveBeenCalledTimes(1);
    expect(ops.learnSite.mock.calls[0]![2]).toEqual({ reason: "repair" });
    k.advance(30 * 60_000);
    const r3 = await bookmakersHealth(k.deps);
    expect(ops.learnSite).toHaveBeenCalledTimes(1);
    const site = k.t("bookmakerSite").find((s) => s.key === "sportaza")!;
    expect(site.status).toBe("BLOCKED");
    expect(r3.alerts?.created).toBe(1);
    expect(
      k
        .t("auditLog")
        .some(
          (a) =>
            a.action === "bookmakers.status_changed" &&
            (a.metadata as { to?: string }).to === "BLOCKED",
        ),
    ).toBe(true);
    expect(k.t("alert").find((a) => a.kind === "bookmaker_blocked")).toBeTruthy();
    expect(k.sent.at(-1)).toMatch(/Sportaza/);
    // Les sites jamais appris ne sont pas lus.
    expect(ops.readEvents.mock.calls.every((c) => c[1] === "sportaza")).toBe(true);

    ops.readEvents.mockResolvedValue([]);
    k.advance(30 * 60_000);
    await bookmakersHealth(k.deps);
    expect(k.t("bookmakerSite").find((s) => s.key === "sportaza")!.status).not.toBe("BLOCKED");
    expect(k.t("alert").find((a) => a.kind === "bookmaker_blocked")!.resolvedAt).toBeTruthy();
  });

  it("crochet du lecteur : double lecture impossible → Kevin envoie la capture, une fois par pari", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    k.prisma
      ._model("bettingPick")
      .rows.push({
        id: "p1",
        homeTeam: "PSG",
        awayTeam: "OM",
        selectionLabel: "PSG gagne",
        marketLabel: "Résultat",
      });
    const hook = bookmakerKevinHook(k.deps);
    const e: BookmakerHookEvent = {
      type: "double_read_failed",
      siteKey: "sportaza",
      missionId: "m1",
      pickId: "p1",
      reason: "différentes",
      captureAssetId: "a1",
      reads: [],
    };
    await hook(e);
    await hook(e);
    expect(k.sent).toHaveLength(1);
    expect(k.sent[0]).toMatch(/PSG - OM/);
    expect(voiceCheck(k.sent[0]!).ok).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ vues de Kevin

describe("vues de Kevin", () => {
  const ev = (o: Record<string, unknown>) => ({
    siteEventId: "e1",
    league: "Ligue 1",
    homeTeam: "PSG",
    awayTeam: "OM",
    startsAt: new Date("2026-10-25T19:00:00Z"),
    marketsCount: 120,
    ...o,
  });

  it("« quels matchs sur Sportaza ce soir ? » : par ligue, heure et marchés ; site pas appris → le dire", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    expect((await siteMatchesView(k.deps, { site: "sportaza", slot: "soir" })).lines[0]).toMatch(
      /Sportaza/,
    );
    expect(ops.readEvents).not.toHaveBeenCalled();
    k.prisma._model("bookmakerSite").rows.find((s) => s.key === "sportaza")!.status = "READY";
    ops.readEvents.mockResolvedValue([
      ev({}),
      ev({
        siteEventId: "e2",
        league: "Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        startsAt: new Date("2026-10-25T20:00:00Z"),
      }),
    ]);
    const v = await siteMatchesView(k.deps, { site: "sportaza", slot: "soir" });
    expect(v.lines.join("\n")).toMatch(/2 matchs/);
    expect(v.lines.join("\n")).toMatch(/Ligue 1 : PSG - OM/);
    expect(v.lines.join("\n")).not.toMatch(/api|dom|recette|niveau/i);
  });

  it("« la cote de PSG gagne chez Sportaza ? » : double lecture avec l'heure ; lectures différentes → aucun chiffre", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    k.prisma._model("bookmakerSite").rows.find((s) => s.key === "sportaza")!.status = "READY";
    ops.readEvents.mockResolvedValue([ev({})]);
    const odd = {
      siteEventId: "e1",
      marketSite: "Résultat",
      marketKey: "resultat",
      selectionSite: "PSG",
      selectionKey: "home",
      line: null,
      odds: 1.85,
      level: "api" as const,
      readAt: new Date(),
    };
    ops.readMarkets.mockResolvedValue([
      odd,
      { ...odd, selectionSite: "Nul", selectionKey: "draw", odds: 3.6 },
    ]);
    ops.readOddsTwice.mockResolvedValue({ ok: false, reason: "différentes", reads: [] });
    const unsure = await oddsOfView(k.deps, {
      site: "sportaza",
      match: "PSG",
      selection: "PSG gagne",
    });
    expect(unsure.lines[0]).not.toMatch(/1,85/);
    k.prisma
      ._model("bookmakerOdds")
      .rows.push(
        { id: "r1", readAt: new Date("2026-10-25T14:00:00Z") },
        { id: "r2", readAt: new Date("2026-10-25T14:01:00Z") },
      );
    ops.readOddsTwice.mockResolvedValue({
      ok: true,
      odds: 1.85,
      readIds: ["r1", "r2"],
      levels: ["api", "dom"],
    });
    const sure = await oddsOfView(k.deps, {
      site: "sportaza",
      match: "PSG",
      selection: "PSG gagne",
    });
    expect(sure.lines[0]).toMatch(/1,85/);
    expect(sure.lines[0]).toMatch(/15 h 01/); // heure de Paris (heure d'hiver depuis 3 h ce jour-là)
    expect(pickSelection([odd], "nul", { homeTeam: "PSG", awayTeam: "OM" })).toBeNull();
  });

  it("« les bookmakers ça va ? » : état, Mac, identifiants manquants", async () => {
    const k = kit();
    await ensureDefaultSites(k.deps);
    const v = await bookmakersStatusView(k.deps);
    expect(v.lines.join("\n")).toMatch(/Celsius/);
    expect(v.lines.join("\n")).toMatch(/Mac/);
    expect(v.facts.identifiantsCommuns).toBe(false);
  });
});
