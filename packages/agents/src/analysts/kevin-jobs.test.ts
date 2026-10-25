/**
 * Phase 29, chantier C — file `agents-analystes` : planification horaire (premier lancement une fois, sources dues,
 * rapport du lundi 8 h une seule fois et jamais le mardi), alertes immédiates HIGH / BAN et tendances virales (une
 * seule fois), source coupée après 5 échecs (Kevin prévient une fois), source découverte (deux boutons, OUI → active),
 * `analysts.enabled = false`. Chantiers A / B simulés (`deps.analystsKevin`), aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { respondToRequest } from "../human/respond";
import { resetVoiceRotation, voiceCheck } from "../boss/voice";
import { LEGAL_DISCLAIMER, type AnalystsQueueJob } from "./contract";
import { runAnalystsJob, ANALYSTS_BOOTSTRAP_SETTING } from "./kevin-jobs";
import type { AnalystsKevinDeps, AnalystsKevinPort } from "./kevin-port";
import { alertFor } from "./alert-texts";
import { bossFastPath } from "../boss/fast";

const MONDAY_8H = new Date("2026-10-26T07:00:00Z"); // lundi 8 h, Paris (heure d'hiver)
const MONDAY_7H = new Date("2026-10-26T06:00:00Z");
const TUESDAY_9H = new Date("2026-10-27T08:00:00Z");

type Kit = ReturnType<typeof createTestKit>;

function setup(start = MONDAY_8H, port: Partial<AnalystsKevinPort> = {}) {
  const kit = createTestKit(start);
  const jobs: AnalystsQueueJob[] = [];
  const calls = { seed: 0, rules: 0, weekly: 0, report: 0 };
  const base: Partial<AnalystsKevinPort> = {
    seedSources: vi.fn(async () => {
      calls.seed++;
      return { created: 3, existing: 0 };
    }),
    buildInitialRules: vi.fn(async () => {
      calls.rules++;
      return { created: [], updated: [], rejected: 0, pages: [], entries: 0, alerts: [], costCents: 0, errors: [] };
    }),
    weeklySynthesis: vi.fn(async () => {
      calls.weekly++;
      return { weekStart: "2026-10-26", since: "", groups: [], recommendations: [], entries: 0, costCents: 0, writtenBy: "none" as const };
    }),
    buildWeeklyReport: vi.fn(async () => {
      calls.report++;
      const row = await kit.prisma.strategyReport.create({ data: { market: null, countries: [], period: "2026-W44", reportType: "WEEKLY", title: "Rapport de la semaine 44", summary: "x", content: { text: "Rapport de la semaine 44\n\nCasino\n- Les streams montent (https://www.reddit.com/r/x)" }, recommendations: [], sentAt: null } as never });
      return { reportId: row.id } as never;
    }),
    discoverSources: vi.fn(async () => ({ ok: false as const, skipped: "not_due" as const, nextRunAt: new Date() })),
    reverifyRules: vi.fn(async () => ({ checked: [], confirmed: [], deactivated: [], unreachable: [], changedRisk: [], alerts: [], costCents: 0, errors: [] }) as never),
    purgeRawTexts: vi.fn(async () => ({ purged: 0 })),
    ...port,
  };
  const deps = kit.deps as AnalystsKevinDeps;
  deps.analystsKevin = base;
  deps.analysts = { enqueue: vi.fn(async (job: AnalystsQueueJob) => void jobs.push(job)) };
  return { kit, deps, jobs, calls };
}

/** Exécute toutes les tâches en file (comme le worker), jusqu'à vider la file. */
async function drain(deps: AnalystsKevinDeps, jobs: AnalystsQueueJob[]) {
  for (let guard = 0; jobs.length && guard < 50; guard++) await runAnalystsJob(deps, jobs.shift()!);
}

async function rule(kit: Kit, data: Record<string, unknown> = {}) {
  const now = kit.deps.now!();
  return kit.prisma.complianceRule.create({ data: { platform: "META", market: "CASINO", country: "FR", rule: "Meta coupe les comptes qui montrent des gains de casino.", riskLevel: "BAN", evidence: [{ url: "https://www.blackhatworld.com/threads/ban" }], verified: false, isActive: true, lastVerifiedAt: now, updatedAt: now, createdAt: now, ...data } as never });
}

beforeEach(() => resetVoiceRotation());

describe("planification horaire", () => {
  it("premier lancement une seule fois ; sources dues mises en file", async () => {
    const { kit, deps, jobs, calls } = setup(MONDAY_7H);
    await kit.prisma.trendSource.create({ data: { name: "Due", url: "https://a.example", sourceType: "FORUM", market: "CASINO", isActive: true, errorCount: 0, nextScrapeAt: new Date(MONDAY_7H.getTime() - 60_000) } as never });
    await kit.prisma.trendSource.create({ data: { name: "Plus tard", url: "https://b.example", sourceType: "FORUM", market: "CASINO", isActive: true, errorCount: 0, nextScrapeAt: new Date(MONDAY_7H.getTime() + 3600_000) } as never });
    await kit.prisma.trendSource.create({ data: { name: "Coupée", url: "https://c.example", sourceType: "FORUM", market: "CASINO", isActive: false, errorCount: 5, nextScrapeAt: null } as never });
    await runAnalystsJob(deps, { type: "analysts.schedule" });
    expect(calls).toMatchObject({ seed: 1, rules: 1 });
    expect(jobs.filter((j) => j.type === "analysts.scrape")).toHaveLength(1);
    expect(kit.tables("setting").find((s) => s.key === ANALYSTS_BOOTSTRAP_SETTING)).toBeTruthy();
    await runAnalystsJob(deps, { type: "analysts.schedule" });
    expect(calls).toMatchObject({ seed: 1, rules: 1 });
  });

  it("rapport de la semaine : lundi 8 h, une seule fois ; jamais avant 8 h ni le mardi", async () => {
    const early = setup(MONDAY_7H);
    await runAnalystsJob(early.deps, { type: "analysts.schedule" });
    expect(early.jobs.some((j) => j.type === "analysts.strategy")).toBe(false);

    const { kit, deps, jobs, calls } = setup(MONDAY_8H);
    await runAnalystsJob(deps, { type: "analysts.schedule" });
    expect(jobs.filter((j) => j.type === "analysts.strategy")).toEqual([{ type: "analysts.strategy", kind: "weekly" }]);
    await drain(deps, jobs);
    expect(calls.report).toBe(1);
    const reports = kit.sent.filter((m) => m.html.includes("Rapport de la semaine 44"));
    expect(reports).toHaveLength(1);
    expect(reports[0]!.html).toContain("https://www.reddit.com/r/x");
    // Une heure plus tard, le même lundi : rien de plus.
    kit.advance(3600_000);
    await runAnalystsJob(deps, { type: "analysts.schedule" });
    await drain(deps, jobs);
    // Tâche rejouée par erreur : le rapport n'est pas renvoyé.
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(calls.report).toBe(1);
    expect(kit.sent.filter((m) => m.html.includes("Rapport de la semaine 44"))).toHaveLength(1);

    const tuesday = setup(TUESDAY_9H);
    await runAnalystsJob(tuesday.deps, { type: "analysts.schedule" });
    expect(tuesday.jobs.some((j) => j.type === "analysts.strategy")).toBe(false);
  });

  it("rapport de la semaine avec propositions numérotées : « applique 1 » les garde, sans rien toucher dehors", async () => {
    const { kit, deps, jobs } = setup(MONDAY_8H);
    const rec = await kit.prisma.recommendation.create({ data: { teamKey: "analystes", source: "market_analysis", status: "PROPOSED", target: "MARKET", targetId: "CASINO:FR", field: "ad_strategy", after: { title: "Vidéo de gros gain en 9:16", market: "CASINO", countries: ["FR"], risk: "MEDIUM" }, evidence: { sources: [{ url: "https://www.reddit.com/r/x" }] } } as never });
    deps.analystsKevin!.buildWeeklyReport = vi.fn(async () => {
      const row = await kit.prisma.strategyReport.create({ data: { market: null, countries: [], period: "2026-W44", reportType: "WEEKLY", title: "Rapport de la semaine 44", summary: "x", content: { text: "Rapport de la semaine 44" }, recommendations: [{ id: rec.id, title: "Vidéo de gros gain en 9:16" }], sentAt: null } as never });
      return { reportId: row.id } as never;
    });
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.sent[0]!.html).toContain("1. Vidéo de gros gain en 9:16");
    const before = JSON.stringify([kit.tables("post"), kit.tables("channelAgentPlan"), kit.tables("agentMission")]);
    const r = await bossFastPath(kit.deps, { text: "applique 1", messageId: 5, source: "text" });
    expect(r).toMatchObject({ handled: true });
    expect(kit.tables("recommendation")[0]!.status).toBe("APPLIED");
    expect(JSON.stringify([kit.tables("post"), kit.tables("channelAgentPlan"), kit.tables("agentMission")])).toBe(before);
  });

  it("jour et heure réglables (`analysts.weekly_report_day` / `_hour`)", async () => {
    const { kit, deps, jobs } = setup(TUESDAY_9H);
    await kit.prisma.setting.create({ data: { key: "analysts.weekly_report_day", value: 2 } as never });
    await kit.prisma.setting.create({ data: { key: "analysts.weekly_report_hour", value: 9 } as never });
    await runAnalystsJob(deps, { type: "analysts.schedule" });
    expect(jobs.some((j) => j.type === "analysts.strategy")).toBe(true);
  });

  it("`analysts.enabled = false` : rien ne tourne, rien n'est envoyé", async () => {
    const { kit, deps, jobs, calls } = setup(MONDAY_8H);
    await kit.prisma.setting.create({ data: { key: "analysts.enabled", value: false } as never });
    await kit.prisma.trendSource.create({ data: { name: "Due", url: "https://a.example", sourceType: "FORUM", market: "CASINO", isActive: true, errorCount: 0, nextScrapeAt: null } as never });
    const r = await runAnalystsJob(deps, { type: "analysts.schedule" });
    expect(r).toEqual({ skipped: "disabled" });
    await runAnalystsJob(deps, { type: "analysts.scrape", sourceId: "x" });
    expect(jobs).toHaveLength(0);
    expect(calls).toMatchObject({ seed: 0, rules: 0, report: 0 });
    expect(kit.sent).toHaveLength(0);
  });
});

describe("alertes immédiates", () => {
  it("règle HIGH / BAN : message immédiat de Kevin avec la source et la phrase fixe, une seule fois", async () => {
    const { kit, deps } = setup(MONDAY_8H);
    const r = await rule(kit);
    const entry = await kit.prisma.trendEntry.create({ data: { sourceId: "s", market: "CASINO", category: "AD_BAN", summary: "ban", url: "https://www.blackhatworld.com/threads/ban", relevanceScore: 8 } as never });
    await kit.prisma.complianceRule.update({ where: { id: r.id }, data: { sourceEntryId: entry.id } as never });
    const text = alertFor({ id: r.id, platform: "META", market: "CASINO", country: "FR", rule: "Meta coupe les comptes qui montrent des gains de casino.", riskLevel: "BAN", verified: false, evidence: [{ url: "https://www.blackhatworld.com/threads/ban" }] }).text;
    deps.analystsKevin!.checkEntryCompliance = vi.fn(async () => ({ entryId: entry.id, created: [r.id], updated: [], contradicted: [], rejected: 0, alerts: [{ kind: "compliance" as const, refId: r.id, riskLevel: "BAN" as const, url: "https://www.blackhatworld.com/threads/ban", text }], costCents: 0 }));
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId: entry.id });
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("https://www.blackhatworld.com/threads/ban");
    expect(kit.sent[0]!.html).toContain(LEGAL_DISCLAIMER);
    expect(kit.sent[0]!.html).toMatch(/BAN|bannissement/);
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId: entry.id });
    expect(kit.sent).toHaveLength(1);
  });

  it("filet : une règle HIGH née de l'entrée est signalée même sans texte rendu ; MEDIUM ne l'est pas", async () => {
    const { kit, deps } = setup(MONDAY_8H);
    const entry = await kit.prisma.trendEntry.create({ data: { sourceId: "s", market: "CASINO", category: "PLATFORM_CHANGE", summary: "x", url: "https://news.example/x", relevanceScore: 7 } as never });
    await rule(kit, { riskLevel: "HIGH", sourceEntryId: entry.id, rule: "TikTok refuse les pubs de casino sans licence affichée." });
    await rule(kit, { riskLevel: "MEDIUM", sourceEntryId: entry.id, rule: "Ciblage des moins de 25 ans limité." });
    deps.analystsKevin!.checkEntryCompliance = vi.fn(async () => ({ entryId: entry.id, created: [], updated: [], contradicted: [], rejected: 0, alerts: [], costCents: 0 }));
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId: entry.id });
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("sans licence");
  });

  it("veille : tendance virale → « 🔥 Tendance » tout de suite (une fois) ; entrée « règles » → vérification de la Compliance", async () => {
    const { kit, deps, jobs } = setup(MONDAY_8H);
    const viral = await kit.prisma.trendEntry.create({ data: { sourceId: "s1", market: "SPORTS", category: "MARKET_TREND", summary: "Les paris sur les tirs cadrés explosent en Allemagne", url: "https://www.reddit.com/r/sportsbetting/abc", relevanceScore: 9, verified: false } as never });
    const ban = await kit.prisma.trendEntry.create({ data: { sourceId: "s1", market: "CASINO", category: "AD_BAN", summary: "Des comptes Meta coupés", url: "https://www.blackhatworld.com/threads/9", relevanceScore: 7 } as never });
    const scrape = vi.fn(async () => ({
      ok: true as const,
      sourceId: "s1",
      nextScrapeAt: new Date(),
      read: 2,
      created: 2,
      duplicates: 0,
      belowThreshold: 0,
      failed: 0,
      overLimit: 0,
      stoppedReason: null,
      entryIds: [viral.id, ban.id],
      alerts: [{ kind: "viral" as const, entryId: viral.id, sourceId: "s1", sourceName: "Reddit", market: "SPORTS" as const, category: "MARKET_TREND" as const, platform: null, risk: null, relevanceScore: 9, countries: ["DE"], title: null, summary: "", url: "", publishedAt: null }],
      firstError: null,
    }));
    deps.analystsKevin!.scrapeSource = scrape;
    await runAnalystsJob(deps, { type: "analysts.scrape", sourceId: "s1" });
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toMatch(/^🔥 Tendance/);
    expect(kit.sent[0]!.html).toContain("https://www.reddit.com/r/sportsbetting/abc");
    expect(jobs).toEqual([{ type: "analysts.compliance_check", entryId: ban.id }]);
    await runAnalystsJob(deps, { type: "analysts.scrape", sourceId: "s1" });
    expect(kit.sent).toHaveLength(1);
  });

  it("source coupée après 5 échecs : Kevin prévient une seule fois", async () => {
    const { kit, deps } = setup(MONDAY_8H);
    const event = { type: "source_disabled" as const, sourceId: "s9", name: "GPWA", url: "https://forum.gpwa.org", lastError: "403", errorCount: 5 };
    deps.analystsKevin!.scrapeSource = vi.fn(async () => ({ ok: false as const, sourceId: "s9", error: "403", errorCount: 5, disabled: true, nextScrapeAt: null, event }));
    await runAnalystsJob(deps, { type: "analysts.scrape", sourceId: "s9" });
    await runAnalystsJob(deps, { type: "analysts.scrape", sourceId: "s9" });
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("GPWA");
    expect(kit.sent[0]!.html).toMatch(/5 (échecs|essais)/);
    expect(voiceCheck(kit.sent[0]!.html).problems).toEqual([]);
  });
});

describe("découverte de sources", () => {
  it("source proposée → « Je l'ajoute à ma veille ? » avec deux boutons ; OUI → source active", async () => {
    const { kit, deps } = setup(MONDAY_8H);
    const s = await kit.prisma.trendSource.create({ data: { name: "AffLift", url: "https://afflift.com", sourceType: "FORUM", market: "CASINO", isActive: false, origin: "discovered", errorCount: 0 } as never });
    deps.analystsKevin!.discoverSources = vi.fn(async () => ({ ok: true as const, searched: 3, candidates: 1, stoppedReason: null, proposals: [{ sourceId: s.id, name: "AffLift", url: "https://afflift.com", sourceType: "FORUM" as const, market: "CASINO" as const, score: 8, reason: "forum actif" }] }));
    await runAnalystsJob(deps, { type: "analysts.discover" });
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toMatch(/AffLift \(https:\/\/afflift\.com\)\. (Je l'ajoute à ma veille|Je la mets dans ma veille) \?/);
    expect(kit.sent[0]!.buttons?.[0]).toHaveLength(2);
    const req = kit.tables("humanRequest")[0]!;
    const r = await respondToRequest(kit.deps, req as never, "oui", { userId: null, via: "TELEGRAM" });
    expect(r.ok).toBe(true);
    expect(kit.tables("trendSource").find((x) => x.id === s.id)!.isActive).toBe(true);
  });
});
