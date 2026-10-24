/**
 * Agent Capture écran sur base en mémoire et faux fournisseur : capture rangée et cote posée, cote bougée → pari
 * écarté sans échec, marché disparu → écarté, site bloqué → image de repli à valider (question proxy / Mac),
 * mode Mac → demande en file puis résultat relu, délai → nouvel essai puis repli.
 */
import { describe, expect, it } from "vitest";
import { createFakePrisma, type FakePrisma } from "../../testing/fake-prisma";
import { createFakeScreenshotProvider, type FakeScreenshotOptions } from "../../providers/screenshot/fake";
import { completeCaptureRequest } from "../../providers/screenshot/requests";
import { registerScreenshotProvider } from "../../providers/screenshot/registry";
import { TINY_PNG } from "../../providers/screenshot/fake";
import type { AgentContext, Mission, TeamSettings } from "../../types";
import { agent } from "./index";

const NOW = new Date("2026-10-24T10:00:00Z");

function setup(o: { screenshot?: FakeScreenshotOptions | null; mode?: "server" | "mac"; tolerance?: number; teamTolerance?: number } = {}) {
  const prisma: FakePrisma = createFakePrisma({
    betCategory: [{ id: "cat1", key: "tirs", name: "Tirs cadrés", maxOddsDriftPct: o.tolerance ?? 5 }],
    agentMission: [{ id: "m1", teamKey: "sports", kind: "BET", status: "RUNNING", payload: { pickId: "p1" }, steps: [] }],
    bettingPick: [
      {
        id: "p1",
        missionId: "m1",
        categoryId: "cat1",
        eventId: "ev1",
        homeTeam: "Paris Saint-Germain",
        awayTeam: "Olympique de Marseille",
        league: "Ligue 1",
        kickoffAt: new Date("2026-10-25T19:45:00Z"),
        marketId: "shots",
        marketLabel: "Tirs cadrés",
        selectionLabel: "Plus de",
        line: 8.5,
        bookmaker: "sportaza",
        odds: 2.1,
        reasoning: {},
        screenshotAssetId: null,
        oddsAtSend: null,
        status: "PROPOSED",
        skipReason: null,
      },
    ],
  });
  const provider = o.screenshot === null ? null : createFakeScreenshotProvider(o.screenshot ?? {});
  const settings = { teamKey: "sports", simulation: true, settings: { sports: { captureMode: o.mode ?? "server", ...(o.teamTolerance !== undefined ? { maxOddsDriftPct: o.teamTolerance } : {}) } } } as unknown as TeamSettings;
  let now = NOW;
  const ctx = {
    prisma,
    now: () => now,
    enqueue: { orchestrator: async () => undefined, step: async () => undefined },
    providers: { llm: null, screenshot: provider },
    settings,
  } as unknown as AgentContext;
  const mission = (payload: Record<string, unknown> = { pickId: "p1" }): Mission =>
    ({ id: "m1", teamKey: "sports", kind: "BET", channelId: null, status: "RUNNING", currentStep: 1, steps: [], payload, costCents: 0, postId: null, scheduledFor: null, isTest: false, attempts: 0 }) as Mission;
  const table = (n: string) => (prisma as unknown as { _tables: Record<string, Array<Record<string, unknown>>> })._tables[n] ?? [];
  return { prisma, ctx, mission, provider, table, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("agent Capture écran", () => {
  it("capture rangée (SCREENSHOT / HUMAN_SITE), cote lue posée, média de la mission", async () => {
    const { ctx, mission, table } = setup({ screenshot: { driftPct: 2 } });
    const r = await agent.run(mission(), ctx);
    expect(r.ok).toBe(true);
    const pick = table("bettingPick")[0]!;
    expect(pick.oddsAtSend).toBe(2.14);
    expect(r.output?.mediaAssetId).toBe(pick.screenshotAssetId);
    expect(table("mediaAsset")[0]).toMatchObject({ kind: "SCREENSHOT", origin: "HUMAN_SITE", teamKey: "sports" });
    expect((r.output?.capture as { status: string }).status).toBe("captured");
  });

  it("cote bougée au-delà de l'écart toléré : pari écarté, mission annulée sans échec", async () => {
    const { ctx, mission, table } = setup({ screenshot: { driftPct: -8 } });
    const r = await agent.run(mission(), ctx);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/cote bougée/);
    expect(table("bettingPick")[0]).toMatchObject({ status: "SKIPPED" });
    expect(String(table("bettingPick")[0]!.skipReason)).toMatch(/2,10 → 1,93/);
    expect(table("agentMission")[0]).toMatchObject({ status: "CANCELLED" });
    expect(table("agentTeamConfig").length).toBe(0); // aucun échec compté
  });

  it("écart toléré = le plus strict de la catégorie (5 %) et de l'équipe (2 %) : cote lue +4 % → pari écarté", async () => {
    const { ctx, mission, table } = setup({ screenshot: { driftPct: 4 }, tolerance: 5, teamTolerance: 2 });
    const r = await agent.run(mission(), ctx);
    expect(r.summary).toMatch(/cote bougée/);
    expect(String(table("bettingPick")[0]!.skipReason)).toMatch(/écart toléré 2 %/);
    expect(table("bettingPick")[0]).toMatchObject({ status: "SKIPPED" });
  });

  it("marché disparu : pari écarté", async () => {
    const { ctx, mission, table } = setup({ screenshot: { error: { kind: "market_missing", message: "sélection suspendue" } } });
    const r = await agent.run(mission(), ctx);
    expect(r.ok).toBe(true);
    expect(table("bettingPick")[0]).toMatchObject({ status: "SKIPPED" });
  });

  it("site bloqué (captcha) : image de repli TEMPLATE à valider, question proxy / Mac signalée", async () => {
    const { ctx, mission, table } = setup({ screenshot: { error: { kind: "captcha", message: "anti-robot" } } });
    const r = await agent.run(mission(), ctx);
    expect(r.ok).toBe(true);
    expect(r.output?.capture).toMatchObject({ status: "fallback", mustValidate: true, blocked: true, kind: "captcha" });
    expect(table("mediaAsset")[0]).toMatchObject({ kind: "SCREENSHOT", origin: "TEMPLATE" });
    expect(table("bettingPick")[0]).toMatchObject({ status: "PROPOSED", oddsAtSend: null });
    expect(table("event").some((e) => e.type === "agents.sports.capture_failed")).toBe(true);
  });

  it("délai dépassé : un nouvel essai 5 min plus tard, puis l'image de repli", async () => {
    const { ctx, mission } = setup({ screenshot: { error: { kind: "timeout", message: "lent" } } });
    const first = await agent.run(mission(), ctx);
    expect(first.wait?.delayMs).toBe(5 * 60_000);
    const second = await agent.run(mission({ pickId: "p1", ...first.output }), ctx);
    expect(second.output?.capture).toMatchObject({ status: "fallback", blocked: false });
  });

  it("mode Mac : demande en file, attente, puis résultat déposé par le Mac relu", async () => {
    const { ctx, mission, prisma, table } = setup({ mode: "mac", screenshot: null });
    registerScreenshotProvider(createFakeScreenshotProvider()); // le worker a un navigateur, mais le client a choisi le Mac
    try {
      const first = await agent.run(mission(), ctx);
      expect(first.wait).toBeTruthy();
      const requestId = first.output?.captureRequestId as string;
      const waiting = await agent.run(mission({ pickId: "p1", captureRequestId: requestId }), ctx);
      expect(waiting.wait).toBeTruthy();
      await completeCaptureRequest(prisma, requestId, { ok: true, png: TINY_PNG, readOdds: 2.08, pageUrl: "https://sportaza.com/x" });
      const done = await agent.run(mission({ pickId: "p1", captureRequestId: requestId }), ctx);
      expect(done.output?.capture).toMatchObject({ status: "captured", via: "mac", readOdds: 2.08 });
      expect(table("bettingPick")[0]).toMatchObject({ oddsAtSend: 2.08 });
    } finally {
      registerScreenshotProvider(null);
    }
  });

  it("mode Mac sans réponse au-delà de l'attente : image de repli", async () => {
    const { ctx, mission, advance } = setup({ mode: "mac", screenshot: null });
    registerScreenshotProvider(createFakeScreenshotProvider());
    try {
      const first = await agent.run(mission(), ctx);
      advance(21 * 60_000);
      const r = await agent.run(mission({ pickId: "p1", captureRequestId: first.output?.captureRequestId }), ctx);
      expect(r.output?.capture).toMatchObject({ status: "fallback", via: "mac", kind: "timeout" });
    } finally {
      registerScreenshotProvider(null);
    }
  });

  it("pari introuvable : échec clair ; capture déjà faite : rien de refait", async () => {
    const { ctx, mission, table } = setup();
    expect((await agent.run(mission({ pickId: "inconnu" }), ctx)).ok).toBe(false);
    table("bettingPick")[0]!.screenshotAssetId = "a1";
    const r = await agent.run(mission(), ctx);
    expect(r).toMatchObject({ ok: true, output: { mediaAssetId: "a1" } });
  });
});
