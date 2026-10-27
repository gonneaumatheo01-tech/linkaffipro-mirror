/** Phase 31, chantier C — transitions de statut et Top du jour (mélange, doublons, « Plus tard », NON_EU, QA). */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation } from "../../boss/voice";
import { createFakeQaLlm } from "../../qa/testing";
import { createProspectKit } from "../score/prospect-test-kit";
import { DAY_MS } from "../score/settings";
import { buildDailyTop, sendDailyTop } from "./daily-top";
import { addProspectNote, canTransition, returnSkippedProspects, transitionProspect } from "./status";

beforeEach(() => resetVoiceRotation());

describe("transitions", () => {
  it("table : valides et non valides", () => {
    expect(canTransition("QUALIFIED", "CONTACTED", "client")).toBe(true);
    expect(canTransition("CONTACTED", "RESPONDED", "client")).toBe(true);
    expect(canTransition("RESPONDED", "NEGOTIATING", "client")).toBe(true);
    expect(canTransition("NEGOTIATING", "SIGNED", "client")).toBe(true);
    expect(canTransition("SIGNED", "ACTIVE", "system")).toBe(true);
    expect(canTransition("CONTACTED", "SKIPPED", "client")).toBe(true);
    expect(canTransition("SKIPPED", "QUALIFIED", "system")).toBe(true);
    expect(canTransition("BLACKLISTED", "QUALIFIED", "client")).toBe(false);
    expect(canTransition("BLACKLISTED", "QUALIFIED", "system")).toBe(false);
    expect(canTransition("SIGNED", "CONTACTED", "client")).toBe(false);
    expect(canTransition("QUALIFIED", "DISQUALIFIED", "client")).toBe(false);
    expect(canTransition("QUALIFIED", "QUALIFIED", "client")).toBe(false);
  });

  it("pose les dates et écrit STATUS_CHANGED { from, to, by }", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    expect(await transitionProspect(k.deps, p.id, "CONTACTED", { by: "client" })).toEqual({ ok: true, from: "QUALIFIED", to: "CONTACTED" });
    let row = await k.row(p.id);
    expect(row.contactedAt?.getTime()).toBe(k.now().getTime());
    expect(row.statusChangedAt?.getTime()).toBe(k.now().getTime());
    await transitionProspect(k.deps, p.id, "RESPONDED", { by: "client" });
    await transitionProspect(k.deps, p.id, "SIGNED", { by: "client", dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" } });
    row = await k.row(p.id);
    expect(row.respondedAt).toBeTruthy();
    expect(row.signedAt).toBeTruthy();
    expect(row.dealType).toBe("CPA");
    expect(row.dealTerms).toEqual({ cpa: 100, currency: "EUR" });
    const ev = k.events("STATUS_CHANGED").map((e) => e.payload as Record<string, unknown>);
    expect(ev.map((e) => [e.from, e.to, e.by])).toEqual([
      ["QUALIFIED", "CONTACTED", "client"],
      ["CONTACTED", "RESPONDED", "client"],
      ["RESPONDED", "SIGNED", "client"],
    ]);
  });

  it("refus : à ne plus montrer est terminal ; retour après 60 jours seulement", async () => {
    const k = createProspectKit();
    const b = await k.prospect({ status: "BLACKLISTED" });
    expect((await transitionProspect(k.deps, b.id, "CONTACTED", { by: "client" })).ok).toBe(false);
    const s = await k.prospect({ status: "SKIPPED", statusChangedAt: new Date(k.now().getTime() - 10 * DAY_MS) });
    expect((await transitionProspect(k.deps, s.id, "QUALIFIED", { by: "system" })).ok).toBe(false);
    expect(await returnSkippedProspects(k.deps)).toBe(0);
    k.advance(51 * DAY_MS);
    expect(await returnSkippedProspects(k.deps)).toBe(1);
    expect((await k.row(s.id)).status).toBe("QUALIFIED");
  });

  it("note du client", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    expect((await addProspectNote(k.deps, p.id, "veut des créatives mardi")).ok).toBe(true);
    expect(k.tables("prospectNote")[0]!.note).toBe("veut des créatives mardi");
    expect(k.events("NOTE")).toHaveLength(1);
  });
});

describe("Top du jour", () => {
  it("mélange des pays : pas 10 du même pays si d'autres existent ; NON_EU, inconnu, scam, snooze absents", async () => {
    const k = createProspectKit();
    for (let i = 0; i < 12; i++) await k.prospect({ score: 90 - i });
    for (let i = 0; i < 3; i++) await k.prospect({ countries: ["IT"], score: 60 - i, tier: "B" });
    const nonEu = await k.prospect({ region: "NON_EU", countries: ["BR"], score: 99 });
    const unknown = await k.prospect({ region: "UNKNOWN", countries: [], score: 99, tier: "C" });
    const scam = await k.prospect({ riskFlags: ["SCAM_FIXED_MATCHES"], score: 99 });
    const snoozed = await k.prospect({ snoozedUntil: new Date(k.now().getTime() + DAY_MS), score: 99 });
    const top = await buildDailyTop(k.deps, { count: 10, now: k.now() });
    expect(top.items).toHaveLength(10);
    const ids = top.items.map((i) => i.prospectId);
    for (const x of [nonEu, unknown, scam, snoozed]) expect(ids).not.toContain(x.id);
    expect(top.items.filter((i) => i.html.includes("🇮🇹"))).toHaveLength(3);
    expect(top.header).toContain("10 canaux");
    expect(top.header).toContain("7 FR");
    expect(top.items[0]!.buttons.flat().map((b) => b.callbackData)).toContain(`prospect:${top.items[0]!.prospectId}:contacted`);
    for (const b of top.items.flatMap((i) => i.buttons.flat())) expect(Buffer.byteLength(b.callbackData)).toBeLessThanOrEqual(64);
  });

  it("tri : niveau puis score puis cocitations", async () => {
    const k = createProspectKit();
    const b = await k.prospect({ tier: "B", score: 65 });
    const a1 = await k.prospect({ tier: "A", score: 75, cocitationCount: 1 });
    const a2 = await k.prospect({ tier: "A", score: 75, cocitationCount: 5 });
    const top = await buildDailyTop(k.deps, { count: 10, now: k.now() });
    expect(top.items.map((i) => i.prospectId)).toEqual([a2.id, a1.id, b.id]);
  });

  it("envoi : en-tête puis une carte par prospect, presentedAt posé ; «\u00a0encore 10\u00a0» sans doublon", async () => {
    const k = createProspectKit();
    for (let i = 0; i < 4; i++) await k.prospect({ score: 80 - i });
    const r = await sendDailyTop(k.deps, { count: 2 });
    expect(r).toEqual({ sent: 2, qaBlocked: false });
    expect(k.sent).toHaveLength(3);
    expect(k.sent[1]!.buttons?.flat()).toHaveLength(5);
    expect(k.events("PRESENTED")).toHaveLength(2);
    const shown = new Set(k.events("PRESENTED").map((e) => e.prospectId));
    const more = await buildDailyTop(k.deps, { count: 10, now: k.now(), chatScope: "on_demand" });
    expect(more.items).toHaveLength(2);
    for (const i of more.items) expect(shown.has(i.prospectId)).toBe(false);
    expect(more.header).toMatch(/Encore|de plus/);
  });

  it("représenté une seule fois après 7 jours sans action ; revient après «\u00a0Plus tard\u00a0»", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    await sendDailyTop(k.deps, { count: 10 });
    k.advance(DAY_MS);
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items).toHaveLength(0);
    k.advance(7 * DAY_MS);
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items).toHaveLength(1);
    await sendDailyTop(k.deps, { count: 10 });
    k.advance(8 * DAY_MS);
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items).toHaveLength(0);
    // « Plus tard » : revient quand le délai est passé.
    await k.prisma.prospect.update({ where: { id: p.id }, data: { snoozedUntil: new Date(k.now().getTime() + 7 * DAY_MS) } });
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items).toHaveLength(0);
    k.advance(7 * DAY_MS + 1000);
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items).toHaveLength(1);
  });

  it("QA refusé ou en panne : rien n'est envoyé sauf la phrase fixe de Kevin", async () => {
    for (const qa of [createFakeQaLlm({ responses: [{ verdict: "REJECTED", reasons: [{ code: "x", message: "non", severity: "critical" }] }] }), null]) {
      const k = createProspectKit();
      await k.prospect();
      k.deps.qaLlm = qa;
      const r = await sendDailyTop(k.deps, { count: 10 });
      expect(r).toEqual({ sent: 0, qaBlocked: true });
      expect(k.sent).toHaveLength(1);
      expect(k.sent[0]!.buttons).toBeUndefined();
      expect(k.events("PRESENTED")).toHaveLength(0);
      expect((await k.prisma.prospect.findMany()).every((x) => (x as { presentedAt: Date | null }).presentedAt === null)).toBe(true);
    }
  });

  it("rien à présenter : une phrase courte", async () => {
    const k = createProspectKit();
    expect(await sendDailyTop(k.deps, {})).toEqual({ sent: 0, qaBlocked: false });
    expect(k.sent).toHaveLength(1);
  });
});
