import { describe, expect, it } from "vitest";
import { voiceCheck } from "../boss/voice";
import { createFakePrisma } from "../testing/fake-prisma";
import { agentsOverview, overviewLines } from "./overview-contract";
import { projectMonthEnd, todayCounts } from "./overview";
import { agoLabel } from "./overview-lines";

// 23 octobre 2026, 10 h à Paris (UTC+2).
const NOW = new Date("2026-10-23T08:00:00Z");
const H = 3600_000;

describe("supervision des agents", () => {
  it("projection à fin de mois : rythme moyen depuis le 1er (au moins un jour)", () => {
    // Octobre 2026 à Paris : 31 jours + 1 h (changement d'heure du 25) ; 22 jours et 10 h écoulés.
    expect(projectMonthEnd(0, NOW)).toBe(0);
    expect(projectMonthEnd(1000, NOW)).toBe(Math.round((1000 * 745) / (22 * 24 + 10)));
    expect(projectMonthEnd(500, new Date("2026-10-01T00:30:00Z"))).toBe(Math.round((500 * 745) / 24));
  });

  it("missions du jour : créées, publiées, refusées, échouées aujourd'hui ; en attente maintenant", () => {
    const start = new Date("2026-10-22T22:00:00Z");
    const old = new Date("2026-10-20T10:00:00Z");
    const c = todayCounts(
      [
        { teamKey: "dating", status: "DONE", createdAt: NOW, updatedAt: NOW },
        { teamKey: "dating", status: "DONE", createdAt: old, updatedAt: old },
        { teamKey: "dating", status: "CANCELLED", createdAt: old, updatedAt: NOW },
        { teamKey: "dating", status: "BLOCKED_BUDGET", createdAt: NOW, updatedAt: NOW },
        { teamKey: "dating", status: "WAITING_VALIDATION", createdAt: old, updatedAt: old },
      ],
      start,
      2,
    );
    expect(c).toEqual({ created: 2, published: 1, waiting: 1, rejected: 1, failed: 1, fallbacks: 2 });
  });

  it("résumé complet : états, dépense, résultats hors canal Test, Algorithme, Ads, santé", async () => {
    const prisma = createFakePrisma({
      agentTeamConfig: [
        { teamKey: "dating", simulation: false, autonomyLevel: 1, monthlyBudgetCents: { video: 5000 } },
        { teamKey: "casino", paused: true },
        { teamKey: "ads", paused: false },
      ],
      setting: [{ key: "agents.secret.providers.fal.apiKey", value: { enc: "x", last4: "abcd", updatedAt: "" } }],
      channel: [
        { id: "chD", title: "Rencontres FR" },
        { id: "chT", title: "Test", isTest: true },
      ],
      agentMission: [
        { id: "m1", teamKey: "dating", status: "DONE", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW },
        { id: "m2", teamKey: "dating", status: "DONE", createdAt: new Date(NOW.getTime() - 10 * 24 * H), updatedAt: new Date(NOW.getTime() - 10 * 24 * H), lastActivityAt: NOW },
        { id: "m3", teamKey: "dating", status: "RUNNING", createdAt: NOW, updatedAt: NOW, lastActivityAt: new Date(NOW.getTime() - 2 * H) },
        { id: "m4", teamKey: "casino", status: "DONE", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW },
      ],
      agentUsage: [
        { teamKey: "dating", provider: "video", month: "2026-10", cents: 2200 },
        { teamKey: "dating", provider: "video", month: "2026-09", cents: 9999 },
      ],
      postInsight: [
        // Post de 2 jours (7 et 28 jours), de 10 jours (28 jours), et un post du canal Test (exclu).
        { postId: "p1", channelId: "chD", sentAt: new Date(NOW.getTime() - 48 * H), viewsFinal: 100, clicks: 10, registrations: 2, ftds: 1, agentMissionId: "m1" },
        { postId: "p2", channelId: "chD", sentAt: new Date(NOW.getTime() - 240 * H), viewsFinal: 50, clicks: 5, registrations: 1, ftds: 0, agentMissionId: "m2" },
        { postId: "p3", channelId: "chT", sentAt: new Date(NOW.getTime() - 24 * H), viewsFinal: 999, clicks: 99, registrations: 9, ftds: 9, agentMissionId: "m4" },
        { postId: "p4", channelId: "chD", sentAt: new Date(NOW.getTime() - 24 * H), viewsFinal: 7, clicks: 0, registrations: 0, ftds: 0, agentMissionId: null },
      ],
      click: [
        { id: "c1", postId: "p1", isBot: false },
        { id: "c2", postId: "p2", isBot: false },
        { id: "c3", postId: "p1", isBot: true },
      ],
      player: [
        { id: "pl1", clickId: "c1" },
        { id: "pl2", clickId: "c2" },
        { id: "pl3", clickId: "c3" },
      ],
      playerEvent: [
        { playerId: "pl1", type: "CPA", amount: 50 },
        { playerId: "pl2", type: "CPA", amount: 40 },
        { playerId: "pl2", type: "CPA_REVERSAL", amount: -40 },
        { playerId: "pl1", type: "DEPOSIT", amount: 500 },
        { playerId: "pl3", type: "CPA", amount: 1000 },
      ],
      event: [
        { type: "agents.dating.fallback", occurredAt: NOW },
        { type: "agents.cycle", occurredAt: new Date(NOW.getTime() - 12 * 60_000) },
      ],
      recommendation: [
        { id: "r1", teamKey: "dating", target: "CHANNEL_PLAN", targetId: "chD", field: "windowStart", status: "APPLIED", appliedAt: new Date(NOW.getTime() - H) },
        { id: "r2", teamKey: "dating", target: "CHANNEL_PLAN", targetId: "chD", field: "mix", status: "APPLIED", appliedAt: new Date("2026-10-10T10:00:00Z") },
        { id: "r3", teamKey: "ads", target: "AD", targetId: "x", field: "budget", status: "PROPOSED" },
      ],
      experiment: [{ status: "RUNNING" }, { status: "CLOSED" }],
      alert: [
        { kind: "agents_media_low", resolvedAt: null },
        { kind: "ads_spend_spike", resolvedAt: null },
        { kind: "worker_down", resolvedAt: null },
        { kind: "agents_team_paused", resolvedAt: NOW },
      ],
      humanRequest: [{ status: "QUEUED" }, { status: "ANSWERED" }],
      agentValidation: [{ status: "PENDING" }],
      insightReport: [{ teamKey: "ads", weekStart: "2026-10-23", content: "x", createdAt: new Date(NOW.getTime() - H) }],
      agentRun: [
        { agentKey: "media-ia", status: "OK", startedAt: new Date(NOW.getTime() - 3 * H), endedAt: new Date(NOW.getTime() - 3 * H), outputSummary: "vidéo envoyée à fal (580p)" },
        { agentKey: "media-ia", status: "ERROR", startedAt: new Date(NOW.getTime() - H), error: "fal 500" },
        { agentKey: "cotes", status: "ERROR", startedAt: new Date(NOW.getTime() - 30 * H), error: "vieux" },
      ],
    });

    const o = await agentsOverview(prisma, { now: NOW });
    const dating = o.teams.find((t) => t.teamKey === "dating")!;
    expect(dating).toMatchObject({ simulation: false, paused: false, autonomyLevel: 1 });
    expect(dating.today).toEqual({ created: 2, published: 1, waiting: 0, rejected: 0, failed: 0, fallbacks: 1 });
    const video = dating.spend.find((s) => s.provider === "video")!;
    expect(video).toMatchObject({ cents: 2200, capCents: 5000 });
    expect(video.projectedCents).toBeGreaterThan(2200);
    // Plafonds par défaut gardés (IA texte 20 €, images 15 €).
    expect(dating.spend.find((s) => s.provider === "llm")).toMatchObject({ capCents: 2000 });
    expect(dating.results.d7).toEqual({ posts: 1, views: 100, clicks: 10, registrations: 2, ftds: 1, commissions: 50 });
    expect(dating.results.d28).toEqual({ posts: 2, views: 150, clicks: 15, registrations: 3, ftds: 1, commissions: 50 });
    const casino = o.teams.find((t) => t.teamKey === "casino")!;
    expect(casino.paused).toBe(true);
    expect(casino.results.d28.posts).toBe(0);
    expect(o.teams.find((t) => t.teamKey === "sports")).toMatchObject({ simulation: true, paused: false, autonomyLevel: 0 });

    expect(o.algoAppliedThisWeek).toEqual([
      { id: "r1", teamKey: "dating", field: "windowStart", targetLabel: "Rencontres FR", appliedAt: new Date(NOW.getTime() - H).toISOString() },
    ]);
    expect(o).toMatchObject({ experimentsRunning: 1, openAlerts: 2, openHumanRequests: 1, pendingValidations: 1, pausedAll: false });
    expect(o.ads).toEqual({ paused: false, openRecommendations: 1, lastReportAt: new Date(NOW.getTime() - H).toISOString() });
    expect(o.health.stuckMissions).toBe(1);
    expect(o.health.lastGrandChefAt).toBe(new Date(NOW.getTime() - 12 * 60_000).toISOString());
    const fal = o.health.providers.find((p) => p.key === "fal")!;
    expect(fal).toMatchObject({ keyPresent: true, errors24h: 1, lastOkAt: new Date(NOW.getTime() - 3 * H).toISOString() });
    expect(o.health.providers.find((p) => p.key === "odds")).toMatchObject({ keyPresent: false, errors24h: 0, lastOkAt: null });
    expect(o.health.providers.find((p) => p.key === "magichour")).toMatchObject({ errors24h: 0, lastOkAt: null });

    const lines = overviewLines(o);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines[0]).toBe("À valider : 1, demandes : 1, alertes : 2.");
    expect(lines[1]).toContain("Rencontres : active, en vrai, niveau 1. Aujourd'hui 2 créés, 1 publié, 0 en attente, 1 repli.");
    expect(lines[1]).toContain("Sur 7 jours : 1 post, 2 inscriptions, 50 €.");
    expect(lines[2]).toContain("Casino : en pause");
    expect(lines[5]).toContain("Ads : active, 1 recommandation ouverte, dernier rapport il y a 1 h.");
    expect(lines[6]).toBe("Algorithme cette semaine : 1 réglage appliqué, 1 test A/B en cours.");
    expect(lines[7]).toContain("Santé : dernier tour des équipes il y a 12 min. 1 post bloqué. 1 erreur chez les fournisseurs (24 h). Sans clé : IA texte");
    // Texte envoyé par Kevin : voix contrôlée (un emoji au plus, ni « mission », ni « simulation », ni « Grand Chef »).
    expect(voiceCheck(lines.join("\n")).problems).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/mission|simulation|Grand Chef/i);
  });

  it("pause générale : visible en tête, Ads en pause aussi", async () => {
    const prisma = createFakePrisma({ setting: [{ key: "agents.pausedAll", value: true }] });
    const o = await agentsOverview(prisma, { now: NOW });
    expect(o.pausedAll).toBe(true);
    expect(o.ads.paused).toBe(true);
    expect(overviewLines(o)[0]).toContain("Pause générale en cours.");
  });

  it("libellés de durée", () => {
    expect(agoLabel(null, NOW)).toBe("jamais");
    expect(agoLabel(new Date(NOW.getTime() - 3 * 24 * H).toISOString(), NOW)).toBe("il y a 3 j");
  });
});
