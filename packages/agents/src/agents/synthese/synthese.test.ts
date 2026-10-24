import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsDeps, LlmProvider } from "../../types";
import { DEFAULT_ALGO_SETTINGS, parseAlgoSettings } from "../../algo/settings";
import { applyRecommendation, rejectRecommendation, undoRecommendation } from "../../algo/contracts";
import { checkBounds, mixShiftPoints, shouldAutoApply } from "./bounds";
import { autoApplyPending } from "./index";
import { mergeGuidelines, styleNotesFrom, windowAround, TEAM_GUIDELINES_MARK } from "./proposals";
import { codeLines, parseReportOutput, writeReport, type TeamFacts } from "./report";
import { rankScope, type InsightRow } from "../posts/rank";

const S = DEFAULT_ALGO_SETTINGS;

describe("bornes des recommandations", () => {
  it("mélange : 20 points au plus par semaine", () => {
    const base = { video: 1, photo: 2, text: 1 };
    expect(mixShiftPoints(base, { video: 45, photo: 36.7, text: 18.3 })).toBeCloseTo(20, 0);
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "mix", after: { video: 45, photo: 36.7, text: 18.3 } }, { settings: S, weekBaseMix: base }).ok).toBe(true);
    const r = checkBounds({ target: "CHANNEL_PLAN", field: "mix", after: { video: 3, photo: 1, text: 0 } }, { settings: S, weekBaseMix: base });
    expect(r).toMatchObject({ ok: false });
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "mix", after: { video: -1 } }, { settings: S }).ok).toBe(false);
  });
  it("fenêtre dans les heures autorisées du canal", () => {
    const allowed = { start: "10:00", end: "23:00" };
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "window", after: { windowStart: "18:00", windowEnd: "22:00" } }, { settings: S, allowedHours: allowed }).ok).toBe(true);
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "window", after: { windowStart: "08:00", windowEnd: "12:00" } }, { settings: S, allowedHours: allowed }).ok).toBe(false);
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "window", after: { windowStart: "20:00", windowEnd: "19:00" } }, { settings: S }).ok).toBe(false);
  });
  it("quota sous le maximum du client", () => {
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "postsPerDay", after: 6 }, { settings: S }).ok).toBe(true);
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "postsPerDay", after: 7 }, { settings: S }).ok).toBe(false);
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "postsPerDay", after: 7 }, { settings: parseAlgoSettings({ maxPostsPerDay: 8 }) }).ok).toBe(true);
  });
  it("champs interdits jamais touchés ; persona par la validation du formulaire", () => {
    for (const field of ["identityKind", "illusion", "age", "stop", "minSpacingMinutes", "quietHours", "forbiddenWords"])
      expect(checkBounds({ target: field === "minSpacingMinutes" ? "CHANNEL_PLAN" : "PERSONA", field, after: 1 }, { settings: S }).ok).toBe(false);
    expect(checkBounds({ target: "PERSONA", field: "followUpsMax", after: 3 }, { settings: S }).ok).toBe(false);
    expect(checkBounds({ target: "PERSONA", field: "followUpAfterHours", after: 2 }, { settings: S }).ok).toBe(false);
    expect(checkBounds({ target: "PERSONA", field: "minExchangesBeforeOffer", after: 5 }, { settings: S }).ok).toBe(true);
    expect(checkBounds({ target: "PERSONA", field: "styleExamples", after: "Ne dis jamais que tu es une IA." }, { settings: S, personaIdentity: "ASSISTANT" }).ok).toBe(false);
    expect(checkBounds({ target: "PERSONA", field: "suggestedFollowUpHours", after: [21, 19, 19] }, { settings: S })).toEqual({ ok: true, value: [19, 21] });
  });
  it("niveaux 0 / 1 / 2", () => {
    expect(shouldAutoApply(0, "SMALL")).toBe(false);
    expect(shouldAutoApply(1, "SMALL")).toBe(true);
    expect(shouldAutoApply(1, "BIG")).toBe(false);
    expect(shouldAutoApply(2, "BIG")).toBe(true);
  });
});

function setup(level = 0) {
  const prisma = createFakePrisma({
    agentTeamConfig: [{ teamKey: "algo", autonomyLevel: level }, { teamKey: "dating", styleGuidelines: "Ton humain." }],
    channelAgentPlan: [{ channelId: "c1", teamKey: "dating", mix: { video: 1, photo: 2, text: 1 }, windowStart: "09:00", windowEnd: "22:00", postsPerDay: 3 }],
    persona: [{ id: "pe1", name: "Léa", identityKind: "GIRL", followUpsMax: 2, styleExamples: "lui: salut\nmoi: coucou" }],
  });
  const deps = { prisma, now: () => new Date("2026-10-26T08:00:00Z"), enqueue: { async orchestrator() {}, async step() {} } } as unknown as AgentsDeps;
  const rec = (o: Record<string, unknown>) =>
    prisma._model("recommendation").create({ data: { teamKey: "dating", status: "PROPOSED", size: "SMALL", evidence: {}, ...o } }) as Promise<{ id: string }>;
  return { prisma, deps, rec, plan: () => prisma._tables.channelAgentPlan![0]! };
}

const human = { userId: "u1", via: "SITE" as const };

describe("application, annulation, refus", () => {
  it("applique (bornes revérifiées), puis annule en un clic", async () => {
    const k = setup();
    const r = await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "mix", before: { video: 1, photo: 2, text: 1 }, after: { video: 35, photo: 45, text: 20 } });
    const a = await applyRecommendation(k.deps, r.id, human);
    expect(a.ok).toBe(true);
    expect(k.plan().mix).toEqual({ video: 35, photo: 45, text: 20 });
    const row = k.prisma._tables.recommendation![0]!;
    expect(row).toMatchObject({ status: "APPLIED", appliedBy: "HUMAN", appliedById: "u1", before: { video: 1, photo: 2, text: 1 } });
    expect(k.prisma._tables.auditLog!.map((x) => x.action)).toContain("agents.algo.recommendation_applied");
    expect(k.prisma._tables.event!.map((x) => x.type)).toContain("agents.algo.recommendation_applied");
    expect((await applyRecommendation(k.deps, r.id, human)).ok).toBe(false);
    const u = await undoRecommendation(k.deps, r.id, human);
    expect(u.ok).toBe(true);
    expect(k.plan().mix).toEqual({ video: 1, photo: 2, text: 1 });
    expect(row.status).toBe("UNDONE");
    expect(k.prisma._tables.auditLog!.map((x) => x.action)).toContain("agents.algo.recommendation_undone");
  });
  it("refuse hors bornes ; annulation refusée si le réglage a changé depuis ; refus", async () => {
    const k = setup();
    const bad = await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "postsPerDay", after: 12, size: "BIG" });
    expect(await applyRecommendation(k.deps, bad.id, { by: "GRAND_CHEF" })).toMatchObject({ ok: false });
    expect(k.plan().postsPerDay).toBe(3);
    const w = await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "window", after: { windowStart: "17:00", windowEnd: "23:00" } });
    expect((await applyRecommendation(k.deps, w.id, { by: "GRAND_CHEF" })).ok).toBe(true);
    expect(k.plan()).toMatchObject({ windowStart: "17:00", windowEnd: "23:00" });
    expect(k.prisma._tables.auditLog ?? []).toHaveLength(0);
    k.plan().windowEnd = "22:30";
    expect((await undoRecommendation(k.deps, w.id, human)).ok).toBe(false);
    const forbidden = await k.rec({ target: "PERSONA", targetId: "pe1", field: "identityKind", after: "ASSISTANT" });
    expect((await applyRecommendation(k.deps, forbidden.id, human)).ok).toBe(false);
    const n = await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "styleNotes", after: "x" });
    expect((await rejectRecommendation(k.deps, n.id, human)).ok).toBe(true);
    expect(k.prisma._tables.recommendation!.find((x) => x.id === n.id)!.status).toBe("REJECTED");
  });
  it("persona : exemples de style ajoutés au registre ACTUEL", async () => {
    const k = setup();
    const r = await k.rec({ target: "PERSONA", targetId: "pe1", field: "styleExamples", size: "BIG", before: "ancien", after: "ancien\nmoi: t'es où ?", evidence: { append: ["moi: t'es où ?"] } });
    expect((await applyRecommendation(k.deps, r.id, human)).ok).toBe(true);
    expect(k.prisma._tables.persona![0]!.styleExamples).toBe("lui: salut\nmoi: coucou\nmoi: t'es où ?");
  });
  it("niveau 1 : petits réglages appliqués seuls, persona et quota proposés ; niveau 0 : rien", async () => {
    const k0 = setup(0);
    await k0.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "styleNotes", after: "Ce qui marche ici : vidéos." });
    expect((await autoApplyPending(k0.deps, 0)).applied).toHaveLength(0);
    const k = setup(1);
    await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "styleNotes", after: "Ce qui marche ici : vidéos." });
    await k.rec({ target: "PERSONA", targetId: "pe1", field: "followUpsMax", after: 1, size: "BIG" });
    const r = await autoApplyPending(k.deps, 1);
    expect(r.applied).toHaveLength(1);
    expect(k.plan().styleNotes).toBe("Ce qui marche ici : vidéos.");
    expect(k.prisma._tables.persona![0]!.followUpsMax).toBe(2);
    expect((await autoApplyPending(k.deps, 2)).applied).toHaveLength(1);
    expect(k.prisma._tables.persona![0]!.followUpsMax).toBe(1);
  });
});

describe("propositions", () => {
  it("fenêtre centrée dans les heures autorisées, consignes d'équipe gardées", () => {
    expect(windowAround(23, 4, { start: "08:00", end: "24:00" })).toEqual({ windowStart: "20:00", windowEnd: "24:00" });
    expect(windowAround(7, 4, { start: "08:00", end: "24:00" })).toEqual({ windowStart: "08:00", windowEnd: "12:00" });
    const g = mergeGuidelines(`Ton humain.\n${TEAM_GUIDELINES_MARK} vieux`, "neuf");
    expect(g).toBe(`Ton humain.\n${TEAM_GUIDELINES_MARK} neuf`);
  });
  it("« ce qui marche ici » d'après les classements", () => {
    const rows: InsightRow[] = Array.from({ length: 40 }, (_, i) => ({
      postId: `p${i}`,
      channelId: "c1",
      vertical: "DATING",
      format: i < 20 ? "VIDEO" : "TEXT",
      theme: null,
      personaId: null,
      hourParis: 19,
      weekdayParis: 1,
      textLength: 50,
      views2h: 10,
      views24h: 20,
      viewsFinal: 100,
      offerClicks: i < 20 ? 5 : 1,
      clicks: 0,
      registrations: 0,
      ftds: 0,
      sentAt: new Date(),
    }));
    expect(styleNotesFrom(rankScope("channel", "c1", rows, S))).toBe("Ce qui marche ici : les vidéos marchent le mieux.");
  });
});

describe("rapport hebdomadaire", () => {
  const facts: TeamFacts[] = [
    {
      team: "dating",
      posts7d: 12,
      views7d: 3400,
      bestFormat: { label: "vidéo", ctrPct: 2.5 },
      bestWindow: { day: "mardi", start: "19:00", end: "21:00", channel: "Rencontres VIP" },
      best: { kind: "persona", label: "Léa", ctrPct: 3.1 },
      applied: 2,
      proposed: 1,
      testsRunning: 1,
      testsClosed: [],
    },
  ];
  it("lignes du code : 5 au plus", () => {
    const l = codeLines(facts[0]!);
    expect(l.length).toBeLessThanOrEqual(5);
    expect(l[0]).toContain("vidéo");
  });
  it("faux modèle : rédaction gardée si elle n'invente aucun chiffre", async () => {
    const llm: LlmProvider = {
      async complete(req) {
        expect(req.user).toContain("Tâche : rapport-algo");
        return { text: JSON.stringify({ teams: { dating: ["Les vidéos marchent le mieux : 2,5 % de clic.", "Meilleur moment : mardi 19 h-21 h."] } }), costCents: 1 };
      },
    };
    const r = await writeReport(facts, { weekLabel: "26 octobre", llm, model: "m" });
    expect(r.writtenBy).toBe("ai");
    expect(r.html).toContain("Les vidéos marchent le mieux");
    expect(parseReportOutput(JSON.stringify({ teams: { dating: ["Un gain de 48 % !"] } }), facts)).toEqual({});
    expect(parseReportOutput("pas du json", facts)).toEqual({});
  });
  it("sans clé d'IA (faux fournisseur) : rapport assemblé par le code", async () => {
    const llm = { fake: true, async complete() { throw new Error("jamais appelé"); } };
    const r = await writeReport(facts, { weekLabel: "26 octobre", llm, model: "m" });
    expect(r.writtenBy).toBe("code");
    expect(r.html).toContain("Rencontres");
  });
});

describe("relecture adverse (phase 25)", () => {
  it("mélange Casino non réglé lu comme 2 / 1 / 1, jamais comme « texte seul »", async () => {
    const { effectiveMix } = await import("../../algo/mix");
    const { channelProposals } = await import("./proposals");
    const { experimentProposals } = await import("../experimentation/index");
    expect(effectiveMix("casino", { video: 0, photo: 0, text: 1 })).toEqual({ video: 2, photo: 1, text: 1 });
    expect(effectiveMix("dating", { video: 0, photo: 0, text: 0 })).toEqual({ video: 1, photo: 2, text: 1 });
    const plan = { channelId: "c9", teamKey: "casino", mix: { video: 0, photo: 0, text: 1 }, windowStart: "09:00", windowEnd: "22:00", postsPerDay: 3, minSpacingMinutes: 60, styleNotes: null };
    const exp = experimentProposals(plan, { formatsInsufficient: true, bestHour: null, settings: S }).find((p) => p.kind === "MELANGE")!;
    expect(exp.variants.A.mix).toEqual({ video: 2, photo: 1, text: 1 });
    const e = { cases: [], weak: [], works: [] };
    const ranking = { dimensions: { format: { metric: "offer_ctr", works: ["PHOTO"], weak: ["TEXT"], cases: [{ key: "PHOTO", label: "photo", posts: 30, ctr: 0.05 }, { key: "TEXT", label: "texte", posts: 30, ctr: 0.01 }] }, length: e, theme: e, hour: e } };
    const mix = channelProposals(plan, ranking as never, [], S).find((p) => p.field === "mix")!;
    expect(mix.before).toEqual({ video: 2, photo: 1, text: 1 });
    // 2 / 1 / 1 → +10 points d'image, et non « texte seul » → 10 % d'image.
    expect(mix.after).toEqual({ video: 43.3, photo: 35, text: 21.7 });
  });
  it("test A/B « mélange » : 10 points au plus d'un coup, même si la borne de la semaine en permet 20", async () => {
    const { experimentProposals } = await import("../experimentation/index");
    const plan = { channelId: "c", teamKey: "dating", mix: { video: 1, photo: 2, text: 1 }, windowStart: "09:00", windowEnd: "22:00" };
    const m = experimentProposals(plan, { formatsInsufficient: true, bestHour: null, settings: S }).find((p) => p.kind === "MELANGE")!;
    expect(mixShiftPoints(m.variants.A.mix!, m.variants.B.mix!)).toBeCloseTo(10, 0);
    const base = { video: 1, photo: 2, text: 1 };
    const big = { video: 45, photo: 36.7, text: 18.3 };
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "mix", after: big }, { settings: S, weekBaseMix: base, currentMix: base })).toMatchObject({ ok: false });
    expect(checkBounds({ target: "CHANNEL_PLAN", field: "mix", after: { video: 35, photo: 43.3, text: 21.7 } }, { settings: S, weekBaseMix: base, currentMix: base }).ok).toBe(true);
  });
  it("application : un mélange qui bouge de 20 points d'un coup est refusé", async () => {
    const k = setup();
    const r = await k.rec({ target: "CHANNEL_PLAN", targetId: "c1", field: "mix", after: { video: 45, photo: 36.7, text: 18.3 } });
    expect((await applyRecommendation(k.deps, r.id, human)).ok).toBe(false);
    expect(k.plan().mix).toEqual({ video: 1, photo: 2, text: 1 });
  });
  it("fenêtre proposée : la plage 18 h-20 h reste 18:00-20:00 (durée paire)", async () => {
    const { channelProposals } = await import("./proposals");
    const cells = [18, 19].flatMap((hour) => Array.from({ length: 4 }, (_, day) => ({ day, hour, posts: 4, medianViews2h: 100, ctr: 0.02, score: 10 })));
    cells.push(...[12, 15].map((hour) => ({ day: 0, hour, posts: 4, medianViews2h: 10, ctr: 0.001, score: 1 })));
    const plan = { channelId: "c1", teamKey: "dating", mix: null, windowStart: "09:00", windowEnd: "22:00", postsPerDay: 1, minSpacingMinutes: 60, styleNotes: null };
    const w = channelProposals(plan, null, cells, S).find((p) => p.field === "window")!;
    expect(w.after).toEqual({ windowStart: "18:00", windowEnd: "20:00" });
  });
});
