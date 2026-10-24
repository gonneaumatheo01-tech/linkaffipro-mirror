import { describe, expect, it, vi } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { autonomyDecision } from "./autonomy";
import { budgetAlertLevel, budgetState } from "./budgets";
import { collisionReason } from "./collisions";
import { missingMissions, planDay } from "./plan-day";
import { reportDue, reportLine, sendDailyReport, buildDailyReport } from "./reports";
import { askDailyReportOnce, runCycle } from "./cycle";
import { decideVerdict, mediaProblem, parseJudgement } from "../agents/controle/verdict";
import { chooseFormat, pickAsset } from "../agents/mediatheque/pick";
import { parseRedaction, buildRedactionUser } from "../agents/redaction/prompt";
import { simulationHeader } from "../agents/publication/header";

describe("niveaux d'autonomie", () => {
  it("niveau 0 : tout est validé", () => {
    expect(autonomyDecision(0, {}).validate).toBe(true);
    expect(autonomyDecision(0, { firstPostOfChannel: true }).reason).toContain("premier post");
  });
  it("niveau 1 : seules les nouveautés", () => {
    expect(autonomyDecision(1, {})).toEqual({ validate: false, reason: null });
    for (const k of ["firstPostOfChannel", "newPersona", "newTheme", "newCategory", "controlDoubt"] as const)
      expect(autonomyDecision(1, { [k]: true }).validate).toBe(true);
  });
  it("niveau 2 : rien, sauf ce que le plan impose toujours", () => {
    expect(autonomyDecision(2, { firstPostOfChannel: true, controlDoubt: true }).validate).toBe(false);
    expect(autonomyDecision(2, { alwaysValidate: "3 premières vidéos de la persona" })).toEqual({
      validate: true,
      reason: "3 premières vidéos de la persona",
    });
  });
});

describe("verdict du Contrôle qualité", () => {
  const base = { judgement: null, approved: false, redone: false, autonomyLevel: 2 as const, facts: {} };
  it("règle refusée : refaire une fois, puis valider", () => {
    expect(decideVerdict({ ...base, ruleProblems: ["IA"] }).verdict).toBe("redo");
    expect(decideVerdict({ ...base, ruleProblems: ["IA"], redone: true }).verdict).toBe("validate");
  });
  it("l'IA ne force jamais une publication qu'une règle refuse", () => {
    expect(decideVerdict({ ...base, ruleProblems: ["lien"], judgement: "oui", redone: true }).verdict).toBe("validate");
  });
  it("texte de l'admin : publié si les règles passent, sinon revalidé", () => {
    expect(decideVerdict({ ...base, ruleProblems: [], approved: true, autonomyLevel: 0 }).verdict).toBe("publish");
    expect(decideVerdict({ ...base, ruleProblems: ["long"], approved: true }).verdict).toBe("validate");
  });
  it("doute de l'IA : nouveauté au niveau 1", () => {
    expect(decideVerdict({ ...base, ruleProblems: [], judgement: "doute", autonomyLevel: 1 }).verdict).toBe("validate");
    expect(decideVerdict({ ...base, ruleProblems: [], judgement: "oui", autonomyLevel: 1 }).verdict).toBe("publish");
  });
  it("réponse de relecture stricte", () => {
    expect(parseJudgement('{"verdict":"non","reason":"plat"}')).toEqual({ judgement: "non", reason: "plat" });
    expect(parseJudgement("bof").judgement).toBe("doute");
    expect(parseJudgement('{"verdict":"peut-être"}').judgement).toBe("doute");
  });
  it("média valide", () => {
    expect(mediaProblem(null, "video")).toContain("introuvable");
    expect(mediaProblem({ mimeType: "video/mp4", size: 1000, duration: 30 }, "video")).toBeNull();
    expect(mediaProblem({ mimeType: "video/mp4", size: 60 * 1024 * 1024, duration: 30 }, "video")).toContain("lourde");
    expect(mediaProblem({ mimeType: "image/jpeg", size: 1000, duration: null }, "video")).toContain("vidéo était attendue");
    expect(mediaProblem({ mimeType: "application/pdf", size: 1000, duration: null }, "photo")).toContain("non accepté");
  });
});

describe("Médiathèque", () => {
  it("format : celui qui manque le plus par rapport au mélange", () => {
    expect(chooseFormat({ video: 1, photo: 1, text: 0 }, [])).toBe("video");
    expect(chooseFormat({ video: 1, photo: 1, text: 0 }, ["video"])).toBe("photo");
    expect(chooseFormat({ video: 0, photo: 0, text: 0 }, [])).toBe("text");
    expect(chooseFormat({ video: 2, photo: 0, text: 1 }, ["video", "video"])).toBe("text");
  });
  it("média : jamais deux fois en 30 jours sur le même canal, le moins récemment utilisé d'abord", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const cands = [
      { id: "a", createdAt: d(100) },
      { id: "b", createdAt: d(90) },
      { id: "c", createdAt: d(80) },
    ];
    const usages = [
      { assetId: "a", channelId: "ch", usedAt: d(10) },
      { assetId: "b", channelId: "autre", usedAt: d(2) },
    ];
    expect(pickAsset(cands, usages, "ch", now)).toBe("c");
    expect(pickAsset(cands.slice(0, 2), usages, "ch", now)).toBe("b");
    expect(pickAsset(cands.slice(0, 1), usages, "ch", now)).toBeNull();
    expect(pickAsset(cands.slice(0, 1), [{ assetId: "a", channelId: "ch", usedAt: d(31) }], "ch", now)).toBe("a");
  });
});

describe("Rédaction : sortie stricte et prompt", () => {
  it("JSON valide, HTML Telegram, longueur", () => {
    expect(parseRedaction('```json\n{"text":"<b>Salut</b>","hook":"Salut","topic":"soirée"}\n```', 900)).toEqual({
      text: "<b>Salut</b>",
      hook: "Salut",
      topic: "soirée",
    });
    expect(() => parseRedaction("pas de json", 900)).toThrow();
    expect(() => parseRedaction('{"text":""}', 900)).toThrow(/vide/);
    expect(() => parseRedaction('{"text":"<div>x</div>"}', 900)).toThrow();
    expect(() => parseRedaction(`{"text":"${"a".repeat(50)}"}`, 20)).toThrow(/trop longue/);
  });
  it("le prompt contient les derniers posts, les consignes et le motif d'un refus", () => {
    const u = buildRedactionUser({
      vertical: "DATING",
      channelTitle: "VIP",
      language: "fr",
      format: "text",
      maxLength: 300,
      styleGuidelines: "tutoiement",
      recentPosts: ["[SIMULATION équipe Dating → VIP]\n<b>Ancien post</b>"],
      redoReason: "trop long",
    });
    expect(u).toContain("Tâche : redaction");
    expect(u).toContain("- Ancien post");
    expect(u).toContain("tutoiement");
    expect(u).toContain("trop long");
  });
  it("en-tête de simulation", () => {
    expect(simulationHeader("dating", "Rencontres <VIP>")).toBe("[SIMULATION équipe Rencontres → Rencontres &lt;VIP&gt;]");
  });
});

describe("collisions et plafonds (règles pures)", () => {
  it("collisions", () => {
    expect(collisionReason({ channel: null, teamKey: "dating", activeOnChannel: [], postsPerDay: 3 })).toContain("introuvable");
    expect(collisionReason({ channel: { isActive: false }, teamKey: "dating", activeOnChannel: [], postsPerDay: 3 })).toContain("inactif");
    expect(collisionReason({ channel: { isActive: true }, teamKey: "dating", activeOnChannel: [{ teamKey: "casino" }], postsPerDay: 3 })).toContain("casino");
    expect(collisionReason({ channel: { isActive: true }, teamKey: "dating", activeOnChannel: [{ teamKey: "dating" }], postsPerDay: 1 })).toContain("quota");
    expect(collisionReason({ channel: { isActive: true }, teamKey: "dating", activeOnChannel: [{ teamKey: "dating" }], postsPerDay: 2 })).toBeNull();
    expect(collisionReason({ channel: { isActive: true }, teamKey: "dating", activeOnChannel: [{ teamKey: "casino" }], postsPerDay: 1, isTest: true })).toBeNull();
  });
  it("plafond : absent = libre, 0 = aucun appel, atteint = refus clair", () => {
    expect(budgetState("dating", "llm", 500, undefined).allowed).toBe(true);
    expect(budgetState("dating", "llm", 0, 0).allowed).toBe(false);
    const s = budgetState("casino", "video", 3000, 3000);
    expect(s.allowed).toBe(false);
    expect(s.reason).toContain("Casino");
    expect(s.reason).toContain("30,00 €");
  });
  it("alertes 80 / 100 % : une fois chacune", () => {
    const none = { alerted80: false, alerted100: false };
    expect(budgetAlertLevel(79, 100, none)).toBeNull();
    expect(budgetAlertLevel(80, 100, none)).toBe(80);
    expect(budgetAlertLevel(85, 100, { alerted80: true, alerted100: false })).toBeNull();
    expect(budgetAlertLevel(100, 100, { alerted80: true, alerted100: false })).toBe(100);
    expect(budgetAlertLevel(120, 100, { alerted80: true, alerted100: true })).toBeNull();
    expect(budgetAlertLevel(120, undefined, none)).toBeNull();
  });
});

describe("plan du jour", () => {
  it("règle pure : quota − missions déjà créées, équipes actives seulement", () => {
    const plans = [
      { channelId: "a", teamKey: "dating", postsPerDay: 3 },
      { channelId: "b", teamKey: "casino", postsPerDay: 2 },
      { channelId: "c", teamKey: "sports", postsPerDay: 2 },
    ];
    expect(missingMissions(plans, [{ channelId: "a" }, { channelId: "b" }, { channelId: "b" }, { channelId: "b" }], ["dating", "casino"])).toEqual([
      { channelId: "a", teamKey: "dating", count: 2 },
    ]);
  });

  it("crée les missions manquantes une seule fois par jour ; rien pour une équipe en pause", async () => {
    const kit = createEngineKit();
    await kit.prisma.channelAgentPlan.create({ data: { channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 2 } });
    expect((await planDay(kit.deps)).created).toBe(2);
    expect((await planDay(kit.deps)).created).toBe(0);
    expect(kit.t("agentMission").every((m) => m.planDay === "2026-10-23" && m.createdBy === "GRAND_CHEF")).toBe(true);
    expect(kit.steps).toHaveLength(2);
    // Lendemain, équipe en pause : rien.
    kit.advance(86_400_000);
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "dating" }, data: { paused: true } });
    expect((await planDay(kit.deps)).created).toBe(0);
  });

  it("plan désactivé : aucune mission", async () => {
    const kit = createEngineKit();
    await kit.prisma.channelAgentPlan.create({ data: { channelId: "real", teamKey: "dating", enabled: false } });
    expect((await planDay(kit.deps)).created).toBe(0);
  });
});

describe("rapport quotidien", () => {
  it("ligne par équipe", () => {
    expect(
      reportLine({ label: "Dating", published: 2, waiting: 1, refused: 0, failed: 0, spentCents: 123, capCents: 2000, simulation: true, paused: false }),
    ).toBe("Dating : 2 publiés, 1 en attente, 0 refusé ; 1,23 € / 20,00 € ce mois (simulation)");
  });
  it("à 9 h Paris, une fois par jour", () => {
    expect(reportDue(new Date("2026-10-23T06:59:00Z"), null)).toBe(false); // 8 h 59
    expect(reportDue(new Date("2026-10-23T07:00:00Z"), null)).toBe(true);
    expect(reportDue(new Date("2026-10-23T07:00:00Z"), "2026-10-23")).toBe(false);
  });
  it("enregistré (Event) et envoyé ; pas deux fois ; pas envoyé si le client a dit non", async () => {
    const kit = createEngineKit({ start: new Date("2026-10-23T07:30:00Z") });
    const r = await sendDailyReport(kit.deps);
    expect(r).toMatchObject({ sent: true, recorded: true, day: "2026-10-23" });
    const ev = kit.t("event").find((e) => e.type === "agents.report.daily")!;
    expect((ev.payload as { lines: string[] }).lines).toHaveLength(4);
    expect(kit.sent[0]!.html).toContain("Rapport des agents");
    expect((await sendDailyReport(kit.deps)).recorded).toBe(false);
    kit.advance(86_400_000);
    await kit.prisma.setting.create({ data: { key: "agents.dailyReport", value: false } });
    expect(await sendDailyReport(kit.deps)).toMatchObject({ sent: false, recorded: true });
    expect((await buildDailyReport(kit.deps)).lines[0]).toMatch(/^Rencontres : /);
  });
});

describe("cycle du Grand Chef", () => {
  it("question du rapport posée une seule fois, plan, reprise, rapport", async () => {
    const kit = createEngineKit({ start: new Date("2026-10-23T07:30:00Z") });
    await kit.prisma.setting.create({ data: { key: "admin.telegramUserId", value: "4242" } });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 1 } });
    const out = await runCycle(kit.deps);
    expect(out.plan).toMatchObject({ created: 1 });
    expect(out.report).toMatchObject({ recorded: true });
    expect(kit.t("humanRequest").filter((r) => r.key === "agents.dailyReport")).toHaveLength(1);
    expect(await askDailyReportOnce(kit.deps)).toBe(false);
    await runCycle(kit.deps);
    expect(kit.t("humanRequest").filter((r) => r.key === "agents.dailyReport")).toHaveLength(1);
    expect(kit.t("agentMission")).toHaveLength(1);
  });

  it("pause générale : pas de plan", async () => {
    const kit = createEngineKit();
    await kit.prisma.setting.create({ data: { key: "agents.pausedAll", value: true } });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: "real", teamKey: "dating", enabled: true } });
    const spy = vi.fn();
    kit.deps.logger = { info: spy, warn: spy, error: spy };
    const out = await runCycle(kit.deps);
    expect(out.plan).toEqual({ skipped: "pause générale" });
    expect(kit.t("agentMission")).toHaveLength(0);
  });
});
