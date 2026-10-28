/** Phase 32, chantier A — alertes : anti-répétition 14 jours, plafond 8, ordre, QA, boutons, proposition de coupure après 5. */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../../boss/voice";
import { createFakeQaLlm } from "../../qa/testing";
import type { DetectedAlert, ProspectAlertKind } from "../contract-advanced";
import { createProspectKit } from "../score/prospect-test-kit";
import { DAY_MS } from "../score/settings";
import { listAlerts, muteAlertKind, recordAlerts, unmuteAlertKind } from "./alerts";
import { answerPendingAlertNote, handleAlertCallback, kindsToOfferMute, parseAlertCallback, sendAlertsDigest } from "./digest";
import { familyOf } from "./diff";
import { ALERT_KIND_LABELS, WATCH_ALERT_VARIANTS, WATCH_DIGEST_VARIANTS, alertVariants } from "./texts";
import { NETWORK_CARD_VARIANTS } from "../network/card";

beforeEach(() => resetVoiceRotation());

const det = (kind: ProspectAlertKind, key = kind, strength = 50, data: Record<string, unknown> = {}, evidence: string | null = null): DetectedAlert => ({ kind, family: familyOf(kind, "QUALIFIED"), dedupeKey: key, strength, data, evidence });

describe("écriture des alertes", () => {
  it("ProspectAlert + ProspectEvent ALERT ; même empreinte pas avant 14 jours ; « une fois par objet » jamais", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    expect(await recordAlerts(k.deps, p, [det("GROWTH_SPIKE"), det("AFFILIATE_DROPPED", "AFFILIATE_DROPPED:1xbet:2026-10-01")], k.now())).toHaveLength(2);
    expect(k.tables("prospectAlert")).toHaveLength(2);
    expect(k.events("ALERT")).toHaveLength(2);
    k.advance(10 * DAY_MS);
    expect(await recordAlerts(k.deps, p, [det("GROWTH_SPIKE")], k.now())).toHaveLength(0);
    k.advance(5 * DAY_MS);
    expect(await recordAlerts(k.deps, p, [det("GROWTH_SPIKE"), det("AFFILIATE_DROPPED", "AFFILIATE_DROPPED:1xbet:2026-10-01")], k.now())).toHaveLength(1);
  });
  it("preuve coupée à 15 mots ; canal ou type coupé → MUTED", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    const long = Array.from({ length: 30 }, (_, i) => `mot${i}`).join(" ");
    const [a] = await recordAlerts(k.deps, p, [det("AFFILIATE_RISKY_CLAIM", "R", 90, {}, long)], k.now());
    expect(a!.evidence!.split(" ")).toHaveLength(15);
    await muteAlertKind(k.deps, "DECLINE", "test");
    const [b] = await recordAlerts(k.deps, p, [det("DECLINE")], k.now());
    expect(b!.status).toBe("MUTED");
    await unmuteAlertKind(k.deps, "DECLINE", "test");
    const q = await k.prospect({ watchMuted: true } as never);
    const [c] = await recordAlerts(k.deps, q as never, [det("TIER_UP")], k.now());
    expect(c!.status).toBe("MUTED");
    expect((await listAlerts(k.deps, { status: "MUTED" })).length).toBe(2);
  });
});

async function seedAlerts(k: ReturnType<typeof createProspectKit>, n: number) {
  const kinds: ProspectAlertKind[] = ["DECLINE", "TIER_DOWN", "WENT_SILENT", "AFFILIATE_RISKY_CLAIM", "AFFILIATE_DROPPED", "GROWTH_SPIKE", "CONTACT_CHANGED", "NEW_AFFILIATE", "STARTED_SELLING_ADS", "MARKETPLACE_LISTED"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = await k.prospect({ username: `canal_${i}` });
    const kind = kinds[i % kinds.length]!;
    const fam = kind === "AFFILIATE_RISKY_CLAIM" ? "affiliate" : familyOf(kind, "QUALIFIED");
    out.push(...(await recordAlerts(k.deps, p, [{ kind, family: fam, dedupeKey: kind, strength: 40 + i, data: { brand: "1xbet", days: 20, claim: "gains garantis" }, evidence: kind === "AFFILIATE_RISKY_CLAIM" ? "gains garantis ce soir" : null }], k.now())));
  }
  return out;
}

describe("message du matin", () => {
  it("8 au plus, ordre opportunités > affiliés > pipeline > informations, boutons, puis SENT", async () => {
    const k = createProspectKit();
    await seedAlerts(k, 10);
    const r = await sendAlertsDigest(k.deps, k.now());
    expect(r).toEqual({ sent: 8, qaBlocked: false });
    expect(k.sent).toHaveLength(9);
    const fams = k.sent.slice(1).map((m) => (k.tables("prospectAlert").find((a) => m.buttons?.[0]?.[0]?.callbackData.includes(a.id as string))!.family as string));
    const order = ["opportunity", "affiliate", "pipeline", "info"];
    expect([...fams].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(fams);
    expect(k.sent[1]!.buttons![0]!.map((b) => b.text)).toEqual(["✅ Vu", "📝 Note", "🔕 Plus pour ce canal"]);
    expect(k.tables("prospectAlert").filter((a) => a.status === "SENT")).toHaveLength(8);
    for (const m of k.sent) expect(voiceCheck(m.html).problems.filter((p) => p.code !== "emojis")).toEqual([]);
    // Le lendemain : les 2 restantes seulement.
    k.advance(DAY_MS);
    expect((await sendAlertsDigest(k.deps, k.now())).sent).toBe(2);
  });
  it("QA refuse : rien n'est envoyé, Kevin le dit, alertes toujours NEW", async () => {
    const k = createProspectKit();
    k.deps.qaLlm = createFakeQaLlm({ responses: [{ verdict: "REJECTED", reasons: [{ code: "FALSE_ALERT", severity: "critical", message: "faux" }], corrections: [] } as never] });
    await seedAlerts(k, 3);
    expect(await sendAlertsDigest(k.deps, k.now())).toEqual({ sent: 0, qaBlocked: true });
    expect(k.sent).toHaveLength(1);
    expect(k.tables("prospectAlert").every((a) => a.status === "NEW")).toBe(true);
  });
  it("aucune alerte : aucun message", async () => {
    const k = createProspectKit();
    expect(await sendAlertsDigest(k.deps, k.now())).toEqual({ sent: 0, qaBlocked: false });
    expect(k.sent).toHaveLength(0);
  });
  it("une empreinte envoyée il y a moins de 14 jours n'est pas renvoyée", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    await k.prisma.prospectAlert.create({ data: { prospectId: p.id, kind: "DECLINE", dedupeKey: "DECLINE", family: "info", strength: 40, data: {}, status: "SEEN", sentAt: new Date(k.now().getTime() - 5 * DAY_MS), createdAt: new Date(k.now().getTime() - 5 * DAY_MS) } as never });
    await k.prisma.prospectAlert.create({ data: { prospectId: p.id, kind: "DECLINE", dedupeKey: "DECLINE", family: "info", strength: 40, data: {}, status: "NEW", sentAt: null, createdAt: k.now() } as never });
    expect((await sendAlertsDigest(k.deps, k.now())).sent).toBe(0);
  });
});

describe("proposition de couper un type", () => {
  it("après 5 ignorées de suite, une seule fois", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    for (let i = 0; i < 5; i++)
      await k.prisma.prospectAlert.create({ data: { prospectId: p.id, kind: "DECLINE", dedupeKey: `D${i}`, family: "info", strength: 40, data: {}, status: "SENT", sentAt: new Date(k.now().getTime() - (i + 1) * DAY_MS), createdAt: k.now() } as never });
    await sendAlertsDigest(k.deps, k.now());
    expect(k.sent).toHaveLength(1);
    expect(k.sent[0]!.html).toContain("canal en baisse");
    const data = k.sent[0]!.buttons![0]![0]!.callbackData;
    expect(parseAlertCallback(data)!.action).toBe("kind");
    k.advance(DAY_MS);
    await sendAlertsDigest(k.deps, k.now());
    expect(k.sent).toHaveLength(1);
    const out = await handleAlertCallback(k.deps, { data, chatId: "4242", actorTelegramId: "4242" });
    expect(out!.handled).toBe(true);
    expect(k.tables("setting").find((s) => s.key === "prospection.alerts.muted_kinds")!.value).toEqual(["DECLINE"]);
  });
  it("une alerte vue casse la série", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d));
    const rows = [1, 2, 3, 4, 5].map((d) => ({ id: `x${d}`, kind: "DECLINE" as const, status: (d === 3 ? "SEEN" : "SENT") as "SEEN" | "SENT", sentAt: at(d) }));
    expect(kindsToOfferMute(rows, { muted: new Set(), offered: new Set() })).toEqual([]);
    expect(kindsToOfferMute(rows.map((r) => ({ ...r, status: "SENT" as const })), { muted: new Set(), offered: new Set() })).toEqual([{ kind: "DECLINE", lastAlertId: "x5" }]);
  });
});

describe("boutons", () => {
  it("Vu, Note (question puis réponse), Plus pour ce canal ; droits ; pas un bouton d'alerte → null", async () => {
    const k = createProspectKit();
    const [a, b] = await seedAlerts(k, 2);
    const cb = (id: string, action: string, who = "4242") => handleAlertCallback(k.deps, { data: `pra:${id}:${action}`, chatId: "4242", actorTelegramId: who });
    expect(await handleAlertCallback(k.deps, { data: "prospect:x:seen", chatId: "1", actorTelegramId: "1" })).toBeNull();
    expect((await cb(a!.id, "seen", "999"))!.toast).toMatch(/admin/);
    await cb(a!.id, "seen");
    expect(k.tables("prospectAlert").find((x) => x.id === a!.id)!.status).toBe("SEEN");
    const n = await cb(b!.id, "note");
    expect(n!.reply).toMatch(/note/i);
    expect(await answerPendingAlertNote(k.deps, "4242", "il a répondu sur Insta")).toMatch(/Note ajoutée|noté/);
    expect(k.tables("prospectNote")[0]!.note).toBe("il a répondu sur Insta");
    expect(await answerPendingAlertNote(k.deps, "4242", "autre")).toBeNull();
    await cb(b!.id, "mute");
    expect(((await k.row(b!.prospectId)) as unknown as { watchMuted: boolean }).watchMuted).toBe(true);
  });
});

describe("voix de Kevin", () => {
  it("toutes les variantes du Veilleur et des réseaux passent voiceCheck ; chaque type a ses phrases", () => {
    const fails: string[] = [];
    for (const [name, table] of Object.entries({ WATCH_ALERT_VARIANTS, WATCH_DIGEST_VARIANTS, NETWORK_CARD_VARIANTS } as Record<string, VoiceTable>))
      for (const [key, entry] of Object.entries(table)) {
        const { texts, rules } = voiceEntryTexts(entry);
        for (const t of texts) {
          const p = voiceCheck(t, rules).problems;
          if (p.length) fails.push(`${name}.${key}: ${JSON.stringify(p)} ${t}`);
        }
      }
    expect(fails).toEqual([]);
    for (const kind of Object.keys(ALERT_KIND_LABELS) as ProspectAlertKind[]) {
      const v = alertVariants(kind, "@pronos_fr", { brand: "1xbet", days: 20, from: "B", to: "A", subscribersFrom: 4000, subscribersTo: 9000, subsGrowth: 1.25, viewsFrom: 2000, viewsTo: 1200, viewsGrowth: -0.4, claim: "gains garantis" });
      expect(v.length).toBeGreaterThanOrEqual(2);
      for (const t of v) expect(voiceCheck(t).problems, t).toEqual([]);
    }
  });
});
