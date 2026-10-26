/**
 * Phase 30, chantier C — Kevin et le contrôle qualité global : phrases du client (fausse IA), chiffres justes, motifs
 * en français courant, corrections, tentative, état « en pause », droits des membres, aucun secret ni contenu vérifié
 * affiché, capacités en lecture seule et fiche de l'agent. Base en mémoire, aucun réseau.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { capability, isOrderableTeam } from "../orders/registry";
import { agentCard, findAgent } from "../orders/agents-dict";
import { maskQaText, qaModelState, QA_KEVIN_VARIANTS, reasonsOf, topReasons, windowStats } from "../qa/kevin-view";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import { QA_ACTIONS, QA_READ_ACTION_KEYS } from "./catalog-qa";
import { bossAiTurn } from "./execute";
import { createBossKit, type BossKit } from "./testing";
import { resetVoiceRotation, voiceCheck } from "./voice";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });
const MEMBER = { kind: "member", telegramUserId: 7n, memberId: "m", role: "MEMBER", firstName: "Zoé" } as const;
const MIN = 60_000;
const SECRET = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";
const CONTENT_TEXT = "Gagne 500 euros garantis ce soir sur Casino VIP";

type Seed = { verdict: "APPROVED" | "REJECTED" | "TIMEOUT" | "ERROR"; ago: number; type?: string; contentId?: string; team?: string; reasons?: unknown[]; corrections?: unknown[]; attempt?: number; ms?: number };

async function seedCheck(kit: BossKit, s: Seed) {
  const now = kit.deps.now!();
  return kit.prisma.qaCheck.create({
    data: {
      contentType: s.type ?? "POST",
      contentId: s.contentId ?? `c-${Math.random()}`,
      teamKey: s.team ?? "casino",
      contentHash: "h",
      verdict: s.verdict,
      reasons: s.reasons ?? [],
      corrections: s.corrections ?? null,
      content: { text: CONTENT_TEXT, token: SECRET },
      modelUsed: "claude-fable-5-1",
      durationMs: s.ms ?? 2000,
      attempt: s.attempt ?? 1,
      createdAt: new Date(now.getTime() - s.ago),
    } as never,
  });
}

/** Un post casino refusé deux fois (validation 42), un short 3 refusé, des acceptations. */
async function seed(kit: BossKit) {
  const p = kit.prisma;
  const post = await p.post.create({ data: { code: "AB12CD34", channelId: kit.ids.casino, botId: "b1", text: CONTENT_TEXT } as never });
  const mission = await p.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, status: "WAITING_VALIDATION", postId: post.id } as never });
  await p.agentValidation.create({ data: { number: 42, missionId: mission.id, teamKey: "casino", previewText: CONTENT_TEXT, reason: "x" } as never });
  const job = await p.montageJob.create({ data: { status: "PREVIEW" } as never });
  const clip = await p.shortClip.create({ data: { montageJobId: job.id, index: 3, startMs: 0, endMs: 15000, durationMs: 15000, createdAt: kit.deps.now!() } as never });
  const gain = { code: "GAIN_PROMISE", message: `« 500 euros garantis » est une promesse de gain ; jeton vu : ${SECRET}`, severity: "critical" };
  await seedCheck(kit, { verdict: "REJECTED", ago: 3 * 60 * MIN, contentId: post.id, reasons: [gain], attempt: 1, ms: 3000 });
  await seedCheck(kit, {
    verdict: "REJECTED",
    ago: 30 * MIN,
    contentId: post.id,
    reasons: [gain, { code: "LANGUAGE", message: "virgule manquante", severity: "warning" }],
    corrections: [{ field: "texte", expected: "aucune promesse", got: CONTENT_TEXT, suggestion: "Retire « garantis » et le montant." }],
    attempt: 2,
    ms: 4000,
  });
  await seedCheck(kit, { verdict: "REJECTED", ago: 20 * MIN, type: "SHORT", team: "montage", contentId: clip.id, reasons: [{ code: "SUBTITLE_ERROR", message: "« sa marche » au lieu de « ça marche » à 0:04", severity: "critical" }], ms: 5000 });
  for (let i = 0; i < 7; i++) await seedCheck(kit, { verdict: "APPROVED", ago: (i + 1) * 5 * MIN, ms: 1000 });
  await seedCheck(kit, { verdict: "APPROVED", ago: 3 * 24 * 60 * MIN, team: "dating", ms: 1000 });
  return { post, clip };
}

function noLeak(text: string) {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(CONTENT_TEXT);
  expect(text).not.toMatch(/\b(APPROVED|REJECTED|TIMEOUT|ERROR|GAIN_PROMISE|SUBTITLE_ERROR)\b/);
}

beforeEach(() => resetVoiceRotation());

describe("catalogue de Kevin : contrôle qualité global", () => {
  it("trois entrées immédiates, lisibles par tout membre présenté", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(QA_READ_ACTION_KEYS).toEqual(["qa_status", "qa_history", "qa_detail"]);
    for (const a of QA_ACTIONS) {
      expect(keys).toContain(a.key);
      expect(a.cls).toBe("immediate");
      expect(a.theme).toBe("etat");
      expect(bossActionAllowed(a, MEMBER), a.key).toBe(true);
    }
  });

  it("« comment va le contrôle qualité ? » : aujourd'hui, 7 jours, temps moyen, derniers refus", async () => {
    const phrase = "comment va le contrôle qualité ?";
    const kit = await createBossKit([[phrase, call("qa_status", {})]]);
    await seed(kit);
    const r = await bossAiTurn(kit.deps, kit.input(phrase));
    const text = r.reply ?? "";
    expect(text).toContain("Aujourd'hui : 10 contenus vérifiés, 70 % acceptés, 3 refus.");
    expect(text).toContain("Sur 7 jours : 11 contenus vérifiés, 73 % acceptés, 3 refus.");
    expect(text).toContain("Temps moyen d'une vérification : 1,8 s.");
    expect(text).toContain("Derniers refus : le short 3 (erreur dans les sous-titres), le post 42 sur Casino VIP (promesse de gain).");
    expect(QA_KEVIN_VARIANTS.running).toContain(text.split("\n").at(-1));
    expect(voiceCheck(text).problems, text).toEqual([]);
    noLeak(text);
  });

  it("modèle indisponible : « Le contrôle qualité est en pause, je reprends dès que possible. »", async () => {
    const kit = await createBossKit([["et le contrôle qualité ?", call("qa_status", {})]]);
    await seed(kit);
    await seedCheck(kit, { verdict: "ERROR", ago: 2 * MIN, reasons: [{ code: "QA_MODEL_UNAVAILABLE", message: "529 overloaded", severity: "critical" }] });
    const r = await bossAiTurn(kit.deps, kit.input("et le contrôle qualité ?"));
    expect(QA_KEVIN_VARIANTS.paused).toContain((r.reply ?? "").split("\n")[0]);
    expect(r.reply).toContain("1 bloqué faute de contrôle");
  });

  it("« montre-moi les refus de cette semaine » : liste numérotée, motifs ; puis « pourquoi le 2 ? »", async () => {
    const kit = await createBossKit([
      ["montre-moi les refus de cette semaine", call("qa_history", { jours: 7 })],
      ["pourquoi le 2 ?", call("qa_detail", { rang: 2 })],
    ]);
    await seed(kit);
    const r = await bossAiTurn(kit.deps, kit.input("montre-moi les refus de cette semaine"));
    const text = r.reply ?? "";
    expect(text).toMatch(/^Sur 7 jours : 3 refus sur 11 contenus vérifiés\./);
    expect(text).toContain("Motifs les plus fréquents : promesse de gain (2), erreur dans les sous-titres (1).");
    expect(text).toMatch(/\n1\. le short 3, aujourd'hui à \d{2} h \d{2} : erreur dans les sous-titres/);
    expect(text).toMatch(/\n2\. le post 42 sur Casino VIP, aujourd'hui à .+ : promesse de gain/);
    expect(text.split("\n").length).toBeLessThanOrEqual(8);
    expect(voiceCheck(text, { allowList: true }).problems, text).toEqual([]);
    noLeak(text);
    const d = await bossAiTurn(kit.deps, kit.input("pourquoi le 2 ?"));
    // Le 2e de la liste (refus de 30 min) est déjà le dernier contrôle de ce post : tentative 2.
    expect(d.reply).toMatch(/^Le post 42 sur Casino VIP : refusé aujourd'hui à .+, tentative 2 sur 3/);
  });

  it("« combien de refus cette semaine ? » sans refus : réponse courte, blocages signalés", async () => {
    const kit = await createBossKit([["combien de refus cette semaine ?", call("qa_history", {})]]);
    await seedCheck(kit, { verdict: "APPROVED", ago: MIN });
    await seedCheck(kit, { verdict: "TIMEOUT", ago: 2 * MIN });
    const r = await bossAiTurn(kit.deps, kit.input("combien de refus cette semaine ?"));
    expect(QA_KEVIN_VARIANTS.noRefusal({ days: 7 })).toContain((r.reply ?? "").split("\n")[0]);
    expect(r.reply).toContain("1 contenu bloqué faute de contrôle, il repasse tout seul.");
  });

  it("« les shorts refusés » : filtre par type", async () => {
    const kit = await createBossKit([["les shorts refusés cette semaine", call("qa_history", { type: "short" })]]);
    await seed(kit);
    const r = await bossAiTurn(kit.deps, kit.input("les shorts refusés cette semaine"));
    expect(r.reply).toMatch(/^Sur 7 jours \(shorts\) : 1 refus sur 1 contenu vérifié\./);
    expect(r.reply).not.toContain("post 42");
  });

  it("« pourquoi le post 42 a été refusé ? » : dernier contrôle, motifs masqués, corrections, tentative", async () => {
    const phrase = "pourquoi le post 42 a été refusé ?";
    const kit = await createBossKit([[phrase, call("qa_detail", { type: "post", numero: 42 })]]);
    await seed(kit);
    const r = await bossAiTurn(kit.deps, kit.input(phrase));
    const text = r.reply ?? "";
    expect(text).toMatch(/^Le post 42 sur Casino VIP : refusé aujourd'hui à \d{2} h \d{2}, tentative 2 sur 3, contrôle de 4 s\./);
    expect(text).toContain("❌ promesse de gain : « 500 euros garantis » est une promesse de gain ; jeton vu : [jeton masqué]");
    expect(text).not.toContain("virgule manquante");
    expect(text).toContain("À corriger : texte, Retire « garantis » et le montant.");
    expect(QA_KEVIN_VARIANTS.backToTeam).toContain(text.split("\n").at(-1));
    expect(voiceCheck(text).problems, text).toEqual([]);
    noLeak(text);
  });

  it("« pourquoi le short 3 a été bloqué ? » ; 3e refus : le client tranche ; inconnu : réponse claire", async () => {
    const kit = await createBossKit([
      ["pourquoi le short 3 a été bloqué ?", call("qa_detail", { type: "short", numero: 3 })],
      ["pourquoi le post 99 a été refusé ?", call("qa_detail", { type: "post", numero: 99 })],
    ]);
    const { post } = await seed(kit);
    const r = await bossAiTurn(kit.deps, kit.input("pourquoi le short 3 a été bloqué ?"));
    expect(r.reply).toMatch(/^Le short 3 : refusé .+, tentative 1 sur 3/);
    expect(r.reply).toContain("❌ erreur dans les sous-titres : « sa marche » au lieu de « ça marche » à 0:04");
    const u = await bossAiTurn(kit.deps, kit.input("pourquoi le post 99 a été refusé ?"));
    expect(QA_KEVIN_VARIANTS.notFound).toContain(u.reply);
    await seedCheck(kit, { verdict: "REJECTED", ago: MIN, contentId: post.id, reasons: [{ code: "GAIN_PROMISE", message: "toujours une promesse", severity: "critical" }], attempt: 3 });
    const third = await qaDetailOf(kit, { type: "post", numero: 42 });
    expect(QA_KEVIN_VARIANTS.thirdRefusal).toContain(third.split("\n").at(-1));
  });
});

async function qaDetailOf(kit: BossKit, p: Record<string, unknown>): Promise<string> {
  const a = QA_ACTIONS.find((x) => x.key === "qa_detail")!;
  const parsed = a.parse(p);
  if (!parsed.ok) throw new Error(parsed.error);
  return (await a.execute(kit.deps, parsed.params, { userId: null, via: "TELEGRAM" })).reply ?? "";
}

describe("lectures pures du contrôle qualité", () => {
  it("masquage : jetons, clés, courriels, téléphones, identifiants, codes, longueur", () => {
    expect(maskQaText(`bot ${SECRET}`)).toBe("bot [jeton masqué]");
    expect(maskQaText("clé sk-ant-api03-abcdefghijklmnop")).toBe("clé [clé masquée]");
    expect(maskQaText("password: hunter2 ici")).toBe("password : [masqué] ici");
    expect(maskQaText("écris à jean.dupont@mail.fr")).toBe("écris à [courriel masqué]");
    expect(maskQaText("appelle le 06 12 34 56 78")).toBe("appelle le [téléphone masqué]");
    expect(maskQaText("appelle le +33 6 12 34 56 78")).toBe("appelle le [téléphone masqué]");
    expect(maskQaText("mission clx9a8b7c6d5e4f3g2h1i0j9k8")).toBe("mission [identifiant masqué]");
    expect(maskQaText("source https://site.fr/a?token=abc mort")).toBe("source https://site.fr/a mort");
    expect(maskQaText("code GAIN_PROMISE vu")).toBe("code vu");
    expect(maskQaText("x".repeat(300)).length).toBe(180);
    expect(maskQaText(42)).toBe("");
  });

  it("chiffres, motifs, état", () => {
    const now = new Date("2026-10-23T08:00:00Z");
    const rows = [
      { verdict: "ERROR" as const, createdAt: new Date(now.getTime() - MIN), reasons: [] },
      { verdict: "REJECTED" as const, createdAt: new Date(now.getTime() - 2 * MIN), reasons: [{ code: "COPY", severity: "critical" }, { code: "LANGUAGE", severity: "warning" }] },
      { verdict: "APPROVED" as const, createdAt: new Date(now.getTime() - 3 * MIN), reasons: [] },
      { verdict: "TIMEOUT" as const, createdAt: new Date(now.getTime() - 4 * MIN), reasons: [] },
    ];
    expect(windowStats(rows)).toEqual({ total: 4, approved: 1, rejected: 1, timeout: 1, error: 1, rate: 0.25 });
    expect(topReasons(rows)).toEqual([{ word: "texte copié sur une source", count: 1 }]);
    expect(reasonsOf([{ code: "INCONNU", message: "m" }])[0]).toMatchObject({ word: "autre motif", critical: true });
    expect(qaModelState(rows, true, now)).toBe("paused");
    expect(qaModelState(rows.slice(1), true, now)).toBe("ok");
    expect(qaModelState(rows, false, now)).toBe("off");
    expect(qaModelState([], true, now)).toBe("idle");
    expect(qaModelState(rows, true, new Date(now.getTime() + 2 * 60 * MIN))).toBe("ok");
  });
});

describe("capacités et annuaire : contrôle qualité global", () => {
  it("équipe « qa » ordonnable, capacités en lecture seule, rien d'écrit", async () => {
    expect(isOrderableTeam("qa")).toBe(true);
    for (const k of ["etat", "refus", "pourquoi"]) expect(capability("qa", k), k).toBeTruthy();
    // Jamais « accepter à la place du contrôle ».
    expect(capability("qa", "approuver")).toBeNull();
    expect(capability("qa", "accepter")).toBeNull();
    const kit = await createBossKit();
    await seed(kit);
    const before = JSON.stringify(Object.fromEntries(Object.entries(kit.prisma._tables).map(([k, v]) => [k, v.length])));
    const cap = capability("qa", "refus")!;
    const parsed = cap.parse({ jours: 7 });
    expect(parsed.ok).toBe(true);
    const steps = await cap.plan(kit.deps, parsed.ok ? parsed.params : {}, { now: kit.deps.now!(), mode: "simulation" });
    expect(steps[0]!.touches).toEqual({ channelIds: [] });
    const order = { id: "o1", number: 1, teamKey: "qa", kind: "ASK", status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: "4242", createdById: null, progress: {} } as const;
    const res = await cap.run(kit.deps, order as never, steps[0]!);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("3 refus sur 11 contenus vérifiés");
    noLeak(res.message);
    const after = JSON.stringify(Object.fromEntries(Object.entries(kit.prisma._tables).map(([k, v]) => [k, v.length])));
    // Seul le relevé numéroté de la conversation peut s'ajouter (un réglage).
    expect(JSON.parse(after).qaCheck).toBe(JSON.parse(before).qaCheck);
    expect(JSON.parse(after).post).toBe(JSON.parse(before).post);
    const report = await cap.report(kit.deps, order as never);
    expect(report).toMatchObject({ semaine: { total: 11, rejected: 3 } });
  });

  it("« le QA Global » est nommable ; sa fiche dit ce qu'il a vérifié et refusé", async () => {
    for (const t of ["le QA Global", "le qa", "le contrôle qualité global", "le dernier verrou"]) {
      const f = findAgent(t);
      expect(f.status === "found" && f.agent.key === "qa", t).toBe(true);
    }
    const kit = await createBossKit();
    await seed(kit);
    const card = await agentCard(kit.deps, "qa");
    const text = card.lines.join("\n");
    expect(text).toContain("QA Global (sous le Grand Chef)");
    expect(text).toContain("Aujourd'hui : 10 contenus vérifiés, 3 refus.");
    expect(text).toMatch(/Sur 7 jours : 11 contenus vérifiés, 73 % acceptés, surtout refusés pour promesse de gain et erreur dans les sous-titres\./);
    expect(voiceCheck(text, { allowLong: true }).problems, text).toEqual([]);
    noLeak(text);
  });
});
