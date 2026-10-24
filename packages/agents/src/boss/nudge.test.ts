import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { BOSS_NUDGE_SETTING, bossDailyNudge } from "./nudge";

type Kit = ReturnType<typeof createTestKit>;
const push = (kit: Kit, table: string, row: Record<string, unknown>) =>
  (kit.prisma as unknown as Record<string, { create(a: unknown): Promise<unknown> }>)[table]!.create({ data: row });
const H = 3600_000;

// Horloge du kit : 23 octobre 2026, 8 h UTC = 10 h à Paris.
describe("Kevin : relance quotidienne", () => {
  it("rien ne bloque : aucun message, le jour n'est pas marqué", async () => {
    const kit = createTestKit();
    await push(kit, "humanRequest", { key: "k", kind: "TEXT", status: "PENDING", question: "Q ?", askedAt: new Date(kit.deps.now!().getTime() - 2 * H) });
    expect(await bossDailyNudge(kit.deps)).toEqual({ sent: false, reason: "nothing" });
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("setting").find((s) => s.key === BOSS_NUDGE_SETTING)).toBeUndefined();
  });

  it("équipe en pause automatique et plafond atteint : un seul message, une seule fois par jour", async () => {
    const kit = createTestKit();
    await push(kit, "agentTeamConfig", { teamKey: "casino", paused: true, pausedReason: "3 missions échouées de suite" });
    await push(kit, "agentTeamConfig", { teamKey: "sports", paused: true, pausedReason: "pause demandée par Telegram" });
    await push(kit, "agentUsage", { teamKey: "dating", provider: "video", month: "2026-10", cents: 10_000, alerted100: true });
    await push(kit, "agentMission", { teamKey: "dating", status: "BLOCKED_BUDGET", lastActivityAt: kit.deps.now!() });
    const r = await bossDailyNudge(kit.deps);
    expect(r).toEqual({ sent: true, blockers: ["auto-pause", "cap"] });
    expect(kit.sent).toHaveLength(1);
    const html = kit.sent[0]!.html;
    expect(html).toContain("<b>Kevin</b> : 2 choses bloquent.");
    expect(html).toContain("Équipe Casino en pause automatique");
    expect(html).toContain("Plafond vidéo de l'équipe Rencontres atteint (100 €), 1 mission arrêtée");
    expect(html).not.toContain("Paris sportifs");
    expect(html.split("\n").length).toBeLessThanOrEqual(5);
    kit.advance(5 * 60_000);
    expect(await bossDailyNudge(kit.deps)).toEqual({ sent: false, reason: "already" });
    kit.advance(24 * H);
    expect((await bossDailyNudge(kit.deps)).sent).toBe(true);
    expect(kit.sent).toHaveLength(2);
  });

  it("avant 10 h à Paris : rien", async () => {
    const kit = createTestKit(new Date("2026-10-23T06:30:00Z"));
    await push(kit, "agentTeamConfig", { teamKey: "casino", paused: true, pausedReason: "3 missions échouées de suite" });
    expect(await bossDailyNudge(kit.deps)).toEqual({ sent: false, reason: "too-early" });
  });

  it("question ouverte : le rappel des 24 h reste au balayage ; au-delà, la même question est renvoyée", async () => {
    const kit = createTestKit();
    const now = kit.deps.now!().getTime();
    const req = (await push(kit, "humanRequest", {
      key: "k",
      kind: "TEXT",
      status: "PENDING",
      question: "Ton prénom ?",
      askedAt: new Date(now - 30 * H),
      remindedAt: null,
      telegramMessageId: 50,
    })) as { id: string };
    expect((await bossDailyNudge(kit.deps)).reason).toBe("nothing");
    await kit.prisma.humanRequest.update({ where: { id: req.id }, data: { remindedAt: new Date(now - 6 * H) } });
    expect((await bossDailyNudge(kit.deps)).reason).toBe("nothing");
    await kit.prisma.humanRequest.update({ where: { id: req.id }, data: { remindedAt: new Date(now - 26 * H) } });
    const r = await bossDailyNudge(kit.deps);
    expect(r).toEqual({ sent: true, blockers: ["request"] });
    expect(kit.sent[0]!.html).toContain("Une question attend ta réponse depuis 1 jour");
    expect(kit.sent[1]!.html).toContain("⏰ <b>Rappel</b> — Ton prénom ?");
    expect(kit.sent[1]!.replyToMessageId).toBe(50);
    const after = kit.tables("humanRequest")[0]!;
    expect(after.telegramMessageId).toBe(kit.sent[1]!.messageId);
    expect((after.remindedAt as Date).getTime()).toBe(now);
  });

  it("plafond de l'IA de Kevin atteint ; sans messager : rien", async () => {
    const kit = createTestKit();
    await push(kit, "setting", { key: "boss.budget", value: { monthlyCents: 500 } });
    await push(kit, "agentUsage", { teamKey: "boss", provider: "llm", month: "2026-10", cents: 520 });
    expect(await bossDailyNudge({ ...kit.deps, admin: undefined })).toEqual({ sent: false, reason: "no-messenger" });
    expect((await bossDailyNudge(kit.deps)).blockers).toEqual(["boss-cap"]);
    expect(kit.sent[0]!.html).toContain("Mon plafond d'IA du mois est atteint (5,2 € pour 5 €)");
  });

  it("une erreur de base ne fait jamais échouer le balayage", async () => {
    const kit = createTestKit();
    const broken = { ...kit.deps, prisma: new Proxy({}, { get: () => { throw new Error("base"); } }) as never };
    expect(await bossDailyNudge(broken)).toEqual({ sent: false, reason: "error" });
  });
});
