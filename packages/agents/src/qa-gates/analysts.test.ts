/**
 * Phase 30, chantier B — QA Global des sorties des Analystes (rapport de la semaine, alertes immédiates, règles à
 * risque, réponses du Stratège) et des recommandations (rattrapage, listes, « applique N »). Fausse IA du QA,
 * chantiers A / B des Analystes simulés, aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { respondToRequest } from "../human/respond";
import { resetVoiceRotation } from "../boss/voice";
import type { AnalystsQueueJob } from "../analysts/contract";
import { runAnalystsJob } from "../analysts/kevin-jobs";
import type { AnalystsKevinDeps, AnalystsKevinPort } from "../analysts/kevin-port";
import { alertFor } from "../analysts/alert-texts";
import { createAnalystsRequest } from "../analysts/kevin-state";
import { bossFastPath } from "../boss/fast";
import { createFakeQaLlm, qaUnavailable, type FakeQaStep } from "../qa/testing";
import { QA_RESPONSE_HELD_TEXT } from "../boss/qa-gate-texts";
import { runQaSweep } from "./jobs";
import { isRecommendationApproved, QA_REC_REJECTED_PREFIX, recommendationNotApproved } from "./recommendations";
import "./index";

const MONDAY_8H = new Date("2026-10-26T07:00:00Z");
const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };
const reject = (code: string, message: string): FakeQaStep => ({ verdict: "REJECTED", reasons: [{ code, message, severity: "critical" }], corrections: [{ field: "text", expected: "", got: "", suggestion: "retire le chiffre inventé" }] });

type Kit = ReturnType<typeof createTestKit>;

function setup(qa: FakeQaStep[] | ((req: { user: string }, i: number) => FakeQaStep), port: Partial<AnalystsKevinPort> = {}) {
  const kit = createTestKit(MONDAY_8H);
  const qaLlm = typeof qa === "function" ? createFakeQaLlm({ respond: qa }) : createFakeQaLlm({ responses: qa });
  const deps = kit.deps as AnalystsKevinDeps & { qaLlm: unknown };
  deps.qaLlm = qaLlm;
  const jobs: AnalystsQueueJob[] = [];
  const delayed: Array<{ job: AnalystsQueueJob; delayMs?: number }> = [];
  deps.analystsKevin = {
    buildWeeklyReport: vi.fn(async () => {
      const row = await kit.prisma.strategyReport.create({ data: { market: null, countries: [], period: "2026-W44", reportType: "WEEKLY", title: "Rapport de la semaine 44", summary: "x", content: { text: "Rapport de la semaine 44\nCasino : 340 % de hausse (chiffre inventé)", markets: [], newRules: 0 }, recommendations: [], sentAt: null } as never });
      return { reportId: row.id } as never;
    }),
    weeklySynthesis: vi.fn(async () => ({ weekStart: "2026-10-26", since: "", groups: [], recommendations: [], entries: 0, costCents: 0, writtenBy: "none" as const })),
    ...port,
  };
  deps.analysts = {
    enqueue: vi.fn(async (job: AnalystsQueueJob, o?: { delayMs?: number }) => {
      if (o?.delayMs) delayed.push({ job, delayMs: o.delayMs });
      else jobs.push(job);
    }),
  };
  return { kit, deps, qaLlm, jobs, delayed };
}

async function drain(deps: AnalystsKevinDeps, jobs: AnalystsQueueJob[]) {
  for (let guard = 0; jobs.length && guard < 50; guard++) await runAnalystsJob(deps, jobs.shift()!);
}

async function rule(kit: Kit) {
  const now = kit.deps.now!();
  return kit.prisma.complianceRule.create({ data: { platform: "META", market: "CASINO", country: "FR", rule: "Meta coupe les comptes qui montrent des gains de casino.", riskLevel: "BAN", evidence: [{ url: "https://www.blackhatworld.com/threads/ban" }], verified: false, isActive: true, lastVerifiedAt: now, updatedAt: now, createdAt: now } as never });
}

async function ruleAlertJob(kit: Kit, deps: AnalystsKevinDeps) {
  const r = await rule(kit);
  const entry = await kit.prisma.trendEntry.create({ data: { sourceId: "s", market: "CASINO", category: "AD_BAN", summary: "ban", url: "https://www.blackhatworld.com/threads/ban", relevanceScore: 8 } as never });
  const text = alertFor({ id: r.id, platform: "META", market: "CASINO", country: "FR", rule: "Meta coupe les comptes qui montrent des gains de casino.", riskLevel: "BAN", verified: false, evidence: [{ url: "https://www.blackhatworld.com/threads/ban" }] }).text;
  deps.analystsKevin!.checkEntryCompliance = vi.fn(async () => ({ entryId: entry.id, created: [r.id], updated: [], contradicted: [], rejected: 0, alerts: [{ kind: "compliance" as const, refId: r.id, riskLevel: "BAN" as const, url: "https://www.blackhatworld.com/threads/ban", text }], costCents: 0 }));
  return { ruleId: r.id, entryId: entry.id };
}

beforeEach(() => {
  resetVoiceRotation();
  // Adresse du site dans le rapport écrit par le code (« Détail complet sur le site ») : celle de la production.
  process.env.APP_BASE_URL = "https://app.linkaffipro.com";
});

describe("rapport de la semaine", () => {
  it("approuvé → envoyé une fois", async () => {
    const { kit, deps, jobs, qaLlm } = setup([APPROVE]);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.sent.filter((m) => m.html.includes("Rapport de la semaine 44"))).toHaveLength(1);
    expect(qaLlm.calls).toHaveLength(1);
    expect(kit.tables("qaCheck")[0]).toMatchObject({ contentType: "REPORT", verdict: "APPROVED", teamKey: "analystes" });
  });

  it("refusé (chiffre inventé) → nouvelle rédaction de la même ligne, revérifiée → envoyée ; jamais la version refusée", async () => {
    const { kit, deps, jobs } = setup([reject("INVENTED_NUMBER", "340 % n'est dans aucune source."), APPROVE]);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.sent.some((m) => m.html.includes("340"))).toBe(false);
    expect(kit.sent).toHaveLength(1);
    const report = kit.tables("strategyReport")[0]!;
    expect((report.content as { writtenBy?: string }).writtenBy).toBe("code");
    expect(report.sentAt).toBeTruthy();
    expect(kit.tables("qaCheck").map((q) => q.verdict)).toEqual(["REJECTED", "APPROVED"]);
    expect(kit.tables("event").some((e) => e.type === "qa.report.returned")).toBe(true);
  });

  it("3 refus → rien n'est envoyé, Kevin demande au client ; « Non » → laissé de côté", async () => {
    const { kit, deps, jobs } = setup([reject("UNSOURCED", "Affirmation sans source.")]);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.tables("qaCheck").filter((q) => q.verdict === "REJECTED")).toHaveLength(3);
    // Seule la question au client part (jamais le rapport).
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("3 refus");
    const req = kit.tables("humanRequest")[0]!;
    expect(req).toMatchObject({ kind: "CONFIRM", status: "PENDING" });
    await respondToRequest(kit.deps, req as never, "non", { userId: null, via: "TELEGRAM" });
    const report = kit.tables("strategyReport")[0]!;
    expect((report.content as { qa?: { dropped?: boolean } }).qa?.dropped).toBe(true);
    expect(report.sentAt ?? null).toBeNull();
  });

  it("QA indisponible → rien n'est envoyé, envoi reporté de 5 minutes (jamais approuvé par défaut)", async () => {
    const { kit, deps, jobs, delayed } = setup(() => qaUnavailable() as never);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.sent).toHaveLength(0);
    expect(delayed).toHaveLength(1);
    expect(delayed[0]).toMatchObject({ job: { type: "analysts.report", kind: "weekly" }, delayMs: 5 * 60_000 });
  });
});

describe("alertes et règles à risque", () => {
  it("règle BAN et alerte approuvées → message immédiat", async () => {
    const { kit, deps, qaLlm } = setup([APPROVE]);
    const { entryId } = await ruleAlertJob(kit, deps);
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId });
    expect(kit.sent).toHaveLength(1);
    // Deux vérifications : la règle, puis l'alerte.
    expect(kit.tables("qaCheck").map((q) => q.contentType)).toEqual(["COMPLIANCE_RULE", "ALERT"]);
    expect(qaLlm.calls).toHaveLength(2);
  });

  it("règle refusée → désactivée avec le motif, aucune alerte", async () => {
    const { kit, deps } = setup([reject("HALLUCINATION", "La source ne dit pas ça.")]);
    const { entryId, ruleId } = await ruleAlertJob(kit, deps);
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId });
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("complianceRule").find((r) => r.id === ruleId)!.isActive).toBe(false);
    expect(kit.tables("setting").find((s) => s.key === `qa.ruleRejected.${ruleId}`)?.value).toMatchObject({ motif: "La source ne dit pas ça" });
  });

  it("alerte refusée (faux positif) → annulée et journalisée, jamais renvoyée", async () => {
    const { kit, deps } = setup((_r, i) => (i === 0 ? APPROVE : reject("FALSE_ALERT", "Rien de nouveau : faux positif.")));
    const { entryId } = await ruleAlertJob(kit, deps);
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId });
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId });
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("event").filter((e) => e.type === "qa.alert.cancelled")).toHaveLength(1);
  });

  it("QA indisponible → alerte gardée ; le rattrapage la renvoie quand le QA revient", async () => {
    let down = true;
    const { kit, deps } = setup(() => (down ? (qaUnavailable() as never) : APPROVE));
    const { entryId, ruleId } = await ruleAlertJob(kit, deps);
    await runAnalystsJob(deps, { type: "analysts.compliance_check", entryId });
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("setting").some((s) => s.key === `qa.pendingAlert.rule.${ruleId}`)).toBe(true);
    down = false;
    const r = await runQaSweep(deps as never);
    expect(r.alerts).toBe(1);
    expect(kit.sent).toHaveLength(1);
    expect(kit.tables("setting").some((s) => s.key === `qa.pendingAlert.rule.${ruleId}`)).toBe(false);
  });
});

describe("réponses du Stratège (réponse de Kevin rédigée par l'IA)", () => {
  it("refusée → nouvelle rédaction avec les corrections → approuvée → envoyée", async () => {
    let n = 0;
    const answer = vi.fn(async () => ({ text: `Réponse ${++n} : en Allemagne, les pubs casino passent mieux en vidéo courte ce mois-ci, d'après la veille.`, sources: [], mentionsRules: false, noData: false, suggestSearch: false, usedEntryIds: [], usedRuleIds: [], costCents: 0 }) as never);
    const { kit, deps } = setup([reject("HALLUCINATION", "Aucune source ne parle de vidéo courte."), APPROVE], { answerMarketQuestion: answer });
    const req = await createAnalystsRequest(deps, { kind: "analysis", question: "Qu'est-ce qui marche en Allemagne ?", market: "CASINO", countries: ["DE"], platform: null, chatId: null, askedBy: "admin" } as never);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "on_demand", requestId: (req as { id: string }).id });
    expect(answer).toHaveBeenCalledTimes(2);
    expect(kit.sent.at(-1)!.html).toContain("Réponse 2");
    expect(kit.sent.some((m) => m.html.includes("Réponse 1"))).toBe(false);
  });

  it("toujours refusée → phrase fixe honnête", async () => {
    const answer = vi.fn(async () => ({ text: "En Allemagne, tout le monde gagne 300 % avec les pubs casino en ce moment, c'est sûr.", sources: [], mentionsRules: false, noData: false, suggestSearch: false, usedEntryIds: [], usedRuleIds: [], costCents: 0 }) as never);
    const { kit, deps } = setup([reject("GAIN_PROMISE", "Promesse de gain.")], { answerMarketQuestion: answer });
    const req = await createAnalystsRequest(deps, { kind: "analysis", question: "Ça marche en Allemagne ?", market: "CASINO", countries: ["DE"], platform: null, chatId: null, askedBy: "admin" } as never);
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "on_demand", requestId: (req as { id: string }).id });
    expect(kit.sent.at(-1)!.html).toBe(QA_RESPONSE_HELD_TEXT);
  });
});

describe("recommandations", () => {
  async function marketRec(kit: Kit) {
    return kit.prisma.recommendation.create({ data: { teamKey: "analystes", source: "market_analysis", status: "PROPOSED", target: "MARKET", targetId: "CASINO:FR", field: "ad_strategy", after: { title: "Vidéo de gros gain en 9:16", market: "CASINO", countries: ["FR"], risk: "MEDIUM" }, evidence: { sources: [{ url: "https://www.reddit.com/r/x" }] }, size: "SMALL" } as never });
  }

  it("non approuvée : jamais appliquée (QA absent → « en vérification ») ; le rattrapage la vérifie, refusée → REJECTED avec le motif", async () => {
    let down = true;
    const { kit, deps } = setup(() => (down ? (qaUnavailable() as never) : reject("COMPLIANCE", "Contredit une règle Meta active.")));
    const rec = await marketRec(kit);
    expect(await recommendationNotApproved(deps as never, rec as never)).toMatch(/en vérification/);
    expect(kit.tables("recommendation")[0]!.status).toBe("PROPOSED");
    down = false;
    const r = await runQaSweep(deps as never);
    expect(r).toMatchObject({ rejected: 1 });
    const row = kit.tables("recommendation")[0]!;
    expect(row.status).toBe("REJECTED");
    expect(String(row.comment)).toBe(`${QA_REC_REJECTED_PREFIX}Contredit une règle Meta active`);
    expect(await recommendationNotApproved(deps as never, row as never)).toMatch(/refusé/);
  });

  it("approuvée par le rattrapage → montrée dans le rapport et « applique 1 » la garde ; modifiée ensuite → plus montrée", async () => {
    const { kit, deps, jobs } = setup([APPROVE]);
    const rec = await marketRec(kit);
    await runQaSweep(deps as never);
    expect(await recommendationNotApproved(deps as never, rec as never)).toBeNull();
    deps.analystsKevin!.buildWeeklyReport = vi.fn(async () => {
      const row = await kit.prisma.strategyReport.create({ data: { market: null, countries: [], period: "2026-W44", reportType: "WEEKLY", title: "Rapport de la semaine 44", summary: "x", content: { text: "Rapport de la semaine 44" }, recommendations: [{ id: rec.id, title: "Vidéo de gros gain en 9:16" }], sentAt: null } as never });
      return { reportId: row.id } as never;
    });
    await runAnalystsJob(deps, { type: "analysts.strategy", kind: "weekly" });
    await drain(deps, jobs);
    expect(kit.sent.at(-1)!.html).toContain("1. Vidéo de gros gain en 9:16");
    await bossFastPath(kit.deps, { text: "applique 1", messageId: 5, source: "text" });
    expect(kit.tables("recommendation")[0]!.status).toBe("APPLIED");
  });

  it("modifiée après l'approbation → de nouveau « en vérification »", async () => {
    const { kit, deps } = setup([APPROVE]);
    const rec = await marketRec(kit);
    await runQaSweep(deps as never);
    const row = kit.tables("recommendation")[0]!;
    row.after = { ...(row.after as object), title: "Autre chose" };
    expect(await isRecommendationApproved(deps as never, row as never)).toBe(false);
    expect(rec.id).toBe(row.id);
  });
});
