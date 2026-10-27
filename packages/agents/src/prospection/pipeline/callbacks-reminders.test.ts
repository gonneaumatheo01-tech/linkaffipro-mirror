/** Phase 31, chantier C — boutons, montant du deal, rappels, rapport de la semaine. */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation } from "../../boss/voice";
import { createFakeQaLlm } from "../../qa/testing";
import { createProspectKit } from "../score/prospect-test-kit";
import { DAY_MS } from "../score/settings";
import { answerPendingDeal, handleProspectCallback, parseDealAmount } from "./callbacks";
import { runReminders } from "./reminders";
import { buildWeeklyReport, sendWeeklyReport } from "./weekly-report";

beforeEach(() => resetVoiceRotation());

const ADMIN = "4242";
const cb = (id: string, action: string, actor: string | null = ADMIN) => ({ data: `prospect:${id}:${action}`, chatId: ADMIN, actorTelegramId: actor });

describe("boutons prospect:", () => {
  it("autre préfixe → null ; contacté → CONTACTED", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    expect(await handleProspectCallback(k.deps, { data: "agv:x:ok", chatId: ADMIN, actorTelegramId: ADMIN })).toBeNull();
    const r = await handleProspectCallback(k.deps, cb(p.id, "contacted"));
    expect(r?.toast).toContain("contacté");
    expect((await k.row(p.id)).status).toBe("CONTACTED");
  });

  it("signé → CPA / Revshare / Hybride → montant → SIGNED avec dealTerms", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    const s = await handleProspectCallback(k.deps, cb(p.id, "signed"));
    expect(s?.reply?.buttons?.flat().map((b) => b.callbackData)).toEqual([`prospect:${p.id}:deal_cpa`, `prospect:${p.id}:deal_revshare`, `prospect:${p.id}:deal_hybrid`]);
    await handleProspectCallback(k.deps, cb(p.id, "deal_cpa"));
    expect(await answerPendingDeal(k.deps, "999", "100")).toBeNull();
    const done = await answerPendingDeal(k.deps, ADMIN, "100 €");
    expect(done).toContain("CPA 100");
    const row = await k.row(p.id);
    expect(row.status).toBe("SIGNED");
    expect(row.dealType).toBe("CPA");
    expect(row.dealTerms).toEqual({ cpa: 100, currency: "EUR" });
    expect(await answerPendingDeal(k.deps, ADMIN, "100")).toBeNull();
  });

  it("hybride «\u00a050 + 15 %\u00a0» ; question expirée après 30 minutes ; texte sans chiffre ignoré", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    await handleProspectCallback(k.deps, cb(p.id, "deal_hybrid"));
    expect(await answerPendingDeal(k.deps, ADMIN, "on verra")).toBeNull();
    expect(await answerPendingDeal(k.deps, ADMIN, "50 + 15 %")).toContain("hybride");
    expect((await k.row(p.id)).dealTerms).toEqual({ cpa: 50, revshare: 15, currency: "EUR" });
    const q = await k.prospect();
    await handleProspectCallback(k.deps, cb(q.id, "deal_revshare"));
    k.advance(31 * 60_000);
    expect(await answerPendingDeal(k.deps, ADMIN, "30 %")).toBeNull();
    expect((await k.row(q.id)).status).toBe("QUALIFIED");
  });

  it("lecture des montants", () => {
    expect(parseDealAmount("100", "CPA")).toEqual({ dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" } });
    expect(parseDealAmount("30 %", "CPA")).toEqual({ dealType: "REVSHARE", dealTerms: { revshare: 30, currency: "EUR" } });
    expect(parseDealAmount("30", "REVSHARE")?.dealType).toBe("REVSHARE");
    expect(parseDealAmount("15 % + 50 €", "HYBRID")?.dealTerms).toEqual({ cpa: 50, revshare: 15, currency: "EUR" });
    expect(parseDealAmount("bonjour", "CPA")).toBeNull();
    expect(parseDealAmount("150 %", "REVSHARE")).toBeNull();
  });

  it("plus tard → reste à contacter, revient dans 7 jours ; pas intéressé → SKIPPED", async () => {
    const k = createProspectKit();
    const a = await k.prospect();
    const b = await k.prospect();
    await handleProspectCallback(k.deps, cb(a.id, "later"));
    const row = await k.row(a.id);
    expect(row.status).toBe("QUALIFIED");
    expect(row.snoozedUntil?.getTime()).toBe(k.now().getTime() + 7 * DAY_MS);
    await handleProspectCallback(k.deps, cb(b.id, "no"));
    expect((await k.row(b.id)).status).toBe("SKIPPED");
  });

  it("un membre simple n'a pas le droit ; un responsable oui", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    await k.prisma.teamMember.create({ data: { telegramUserId: 77n, firstName: "Léa", role: "MEMBER" } as never });
    await k.prisma.teamMember.create({ data: { telegramUserId: 88n, firstName: "Max", role: "MANAGER" } as never });
    const r = await handleProspectCallback(k.deps, cb(p.id, "contacted", "77"));
    expect(r?.toast).toMatch(/admin/);
    expect((await k.row(p.id)).status).toBe("QUALIFIED");
    await handleProspectCallback(k.deps, cb(p.id, "contacted", "88"));
    expect((await k.row(p.id)).status).toBe("CONTACTED");
    expect(await handleProspectCallback(k.deps, cb(p.id, "no", "12345"))).toMatchObject({ toast: expect.stringMatching(/admin/) });
  });

  it("dossier : stocké → renvoyé ; absent → mis en file et livré plus tard", async () => {
    const k = createProspectKit();
    const a = await k.prospect({ dossier: "Canal foot FR." });
    const r = await handleProspectCallback(k.deps, cb(a.id, "dossier"));
    expect(r?.reply?.html).toContain("Canal foot FR.");
    const b = await k.prospect();
    const w = await handleProspectCallback(k.deps, cb(b.id, "dossier"));
    expect(w?.reply?.html).toContain("dès qu'il est prêt");
    expect(k.jobs).toEqual([{ type: "prospection.dossier", prospectId: b.id }]);
  });

  it("rappels : relancé, 3 jours, abandon", async () => {
    const k = createProspectKit();
    const p = await k.prospect({ status: "CONTACTED", contactedAt: new Date(k.now().getTime() - 6 * DAY_MS) });
    await handleProspectCallback(k.deps, cb(p.id, "snooze3"));
    expect((await k.row(p.id)).snoozedUntil?.getTime()).toBe(k.now().getTime() + 3 * DAY_MS);
    await handleProspectCallback(k.deps, cb(p.id, "abandon"));
    expect((await k.row(p.id)).status).toBe("SKIPPED");
  });
});

describe("rappels", () => {
  // Lundi 26 octobre 2026, 09:05 Paris.
  const MONDAY = new Date("2026-10-26T08:05:00Z");

  it("contacté depuis plus de 5 jours → rappel avec 3 boutons ; pas deux fois avant le délai", async () => {
    const k = createProspectKit(MONDAY);
    const p = await k.prospect({ status: "CONTACTED", contactedAt: new Date(MONDAY.getTime() - 6 * DAY_MS) });
    await k.prospect({ status: "CONTACTED", contactedAt: new Date(MONDAY.getTime() - 4 * DAY_MS) });
    expect(await runReminders(k.deps, k.now())).toEqual({ sent: 1, skipped: null });
    expect(k.sent[0]!.html).toMatch(/6 jours/);
    expect(k.sent[0]!.buttons?.flat().map((b) => b.callbackData)).toEqual([`prospect:${p.id}:relaunched`, `prospect:${p.id}:snooze3`, `prospect:${p.id}:abandon`]);
    k.advance(DAY_MS + 3600_000);
    expect((await runReminders(k.deps, k.now())).sent).toBe(1); // l'autre dépasse 5 jours
    k.advance(DAY_MS);
    expect((await runReminders(k.deps, k.now())).sent).toBe(0);
  });

  it("négociation de plus de 10 jours ; plafond du jour", async () => {
    const k = createProspectKit(MONDAY);
    await k.prisma.setting.create({ data: { key: "prospection.reminders_daily_cap", value: 1 } as never });
    await k.prospect({ status: "NEGOTIATING", statusChangedAt: new Date(MONDAY.getTime() - 11 * DAY_MS) });
    await k.prospect({ status: "NEGOTIATING", statusChangedAt: new Date(MONDAY.getTime() - 12 * DAY_MS) });
    expect((await runReminders(k.deps, k.now())).sent).toBe(1);
    expect(k.sent[0]!.html).toMatch(/12 jours/);
    expect((await runReminders(k.deps, k.now())).sent).toBe(0);
  });

  it("jamais le week-end, sauf réglage", async () => {
    const SAT = new Date("2026-10-24T07:05:00Z");
    const k = createProspectKit(SAT);
    await k.prospect({ status: "CONTACTED", contactedAt: new Date(SAT.getTime() - 6 * DAY_MS) });
    expect(await runReminders(k.deps, k.now())).toEqual({ sent: 0, skipped: "weekend" });
    await k.prisma.setting.create({ data: { key: "prospection.reminders_weekend", value: true } as never });
    expect((await runReminders(k.deps, k.now())).sent).toBe(1);
  });

  it("relancé : pas de rappel pendant le délai", async () => {
    const k = createProspectKit(MONDAY);
    const p = await k.prospect({ status: "CONTACTED", contactedAt: new Date(MONDAY.getTime() - 6 * DAY_MS) });
    await handleProspectCallback(k.deps, cb(p.id, "relaunched"));
    expect((await runReminders(k.deps, k.now())).sent).toBe(0);
  });
});

describe("rapport de la semaine", () => {
  const MONDAY = new Date("2026-10-26T08:00:00Z");

  async function seed() {
    const k = createProspectKit(MONDAY);
    const recent = new Date(MONDAY.getTime() - 2 * DAY_MS);
    await k.prospect({ tier: "A", score: 80, countries: ["IT"], enrichedAt: recent, sourceType: "GRAPH_FORWARD" });
    await k.prospect({ tier: "A", score: 78, countries: ["IT"], enrichedAt: recent, sourceType: "GRAPH_FORWARD" });
    await k.prospect({ tier: "A", score: 75, countries: ["FR"], enrichedAt: recent, sourceType: "GRAPH_FORWARD" });
    await k.prospect({ tier: "B", score: 60, countries: ["ES"], vertical: "CASINO", enrichedAt: recent, sourceType: "DIRECTORY" });
    await k.prospect({ tier: "C", score: 40, enrichedAt: new Date(MONDAY.getTime() - 20 * DAY_MS) });
    await k.prospect({ region: "NON_EU", countries: ["BR"], tier: "A", score: 90, enrichedAt: recent });
    await k.prospect({ status: "SIGNED", contactedAt: new Date(MONDAY.getTime() - 10 * DAY_MS), respondedAt: new Date(MONDAY.getTime() - 8 * DAY_MS), signedAt: new Date(MONDAY.getTime() - 4 * DAY_MS), enrichedAt: new Date(MONDAY.getTime() - 30 * DAY_MS) });
    await k.prospect({ status: "CONTACTED", contactedAt: new Date(MONDAY.getTime() - 3 * DAY_MS), enrichedAt: new Date(MONDAY.getTime() - 30 * DAY_MS) });
    return k;
  }

  it("contenu : niveaux, pays, Top 5, suivi, conversions, sources, suggestion ; NON_EU absent", async () => {
    const k = await seed();
    const text = await buildWeeklyReport(k.deps, k.now());
    expect(text).toContain("4 nouveaux");
    expect(text).toContain("Par niveau : 3 A, 1 B");
    expect(text).toContain("2 IT");
    expect(text).not.toContain("BR");
    expect(text).toContain("Top 5 de la semaine");
    expect(text).toMatch(/Conversions : 2 contactés → 1 réponses/);
    expect(text).toContain("les transferts entre canaux 3");
    expect(text).toMatch(/L'Italie (donne|fait) 67\u00a0% des A/);
  });

  it("QA refusé : rien ne part, Kevin le dit", async () => {
    const k = await seed();
    k.deps.qaLlm = createFakeQaLlm({ responses: [{ verdict: "REJECTED", reasons: [{ code: "x", message: "non", severity: "critical" }] }] });
    expect(await sendWeeklyReport(k.deps, k.now())).toEqual({ sent: false, qaBlocked: true });
    expect(k.sent).toHaveLength(1);
    expect(k.sent[0]!.html).not.toContain("Top 5");
  });

  it("QA approuvé : envoyé", async () => {
    const k = await seed();
    expect(await sendWeeklyReport(k.deps, k.now())).toEqual({ sent: true, qaBlocked: false });
    expect(k.sent[0]!.html).toContain("Top 5");
  });
});
