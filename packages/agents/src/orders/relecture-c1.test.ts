/**
 * Phase 33, relecture adverse du 25 octobre (correcteur 1, cœur des ordres) : un test par défaut corrigé. Vrai registre
 * des capacités, faux prisma, faux fournisseur de cotes, aucun réseau.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createBossKit } from "../boss/testing";
import { createEngineKit } from "../testing/engine-kit";
import { createMarketListOddsProvider, MARKETS_WITH_OFFSIDES } from "../testing/odds-markets";
import { ensureTeamConfigs } from "../missions/settings";
import { planDay } from "../orchestrator/plan-day";
import { setBetCategoryActive } from "../control/bet-category";
import { createBetMission } from "../sports/missions";
import { replacedChannels } from "../sports/passage";
import { toCategory } from "../sports/data";
import { isInviteLink } from "./capabilities/inspiration";
import { estimatedOddsCalls } from "./capabilities/sports";
import { capability } from "./registry";
import type { OrderPlan } from "./contract";
import { setOrderEventHook } from "./events";
import { normalizePlannerOutput } from "./planner";
import { adminOnlyOrder, classifyOrder, effectiveOrderMode, orderQuickCancel, orderRecap, replayAlternative, submitOrder, ORDER_QUICK_CANCEL_SETTING } from "./recap";
import { friendlyReason } from "./reports";
import { extendOrder, modifyOrder, runOrder } from "./run";
import { acquireOrderLock, stepPending, STEP_MAX_ATTEMPTS } from "./store";
import { tickOrders } from "./tick";
import { findOverlap, pinStepsPeriod, validatePlan } from "./validate";

const START = new Date("2026-10-24T09:00:00Z"); // 11 h à Paris

afterEach(() => setOrderEventHook(null));

async function engine() {
  const kit = createEngineKit({ start: START, providers: { odds: createMarketListOddsProvider({ now: () => START, markets: MARKETS_WITH_OFFSIDES }) } });
  await ensureTeamConfigs(kit.prisma);
  kit.prisma._model("channel").rows.push({ id: "foot", title: "Foot Pro", vertical: "SPORTS", isTest: false, isActive: true, telegramChatId: -1003n, createdAt: new Date(), language: "fr", type: "CHANNEL" });
  kit.prisma._model("persona").rows.push({ id: "p1", name: "Léa", isActive: true, universe: "dating", createdAt: new Date() });
  kit.prisma._model("user").rows.push({ id: "admin1", email: "a@x", role: "ADMIN", telegramUserId: 4242n });
  return kit;
}
type Engine = Awaited<ReturnType<typeof engine>>;

let n = 100;
async function orderRow(kit: Engine, plan: OrderPlan, extra: Record<string, unknown> = {}): Promise<string> {
  const row = await kit.prisma.teamOrder.create({
    data: { number: n++, requestText: "demande", interpretation: JSON.parse(JSON.stringify(plan)), kind: plan.kind, teamKey: plan.teamKey, status: "WAITING_CONFIRM", createdById: "admin1", chatId: "42", progress: {}, ...extra } as never,
  });
  return (row as { id: string }).id;
}

const sportsOn = (canaux: string[], mode: OrderPlan["mode"], days = 3): OrderPlan => ({
  teamKey: "sports",
  scope: { channelIds: [] },
  kind: "PROGRAM",
  period: { start: "2026-10-24", days },
  mode,
  steps: [{ teamKey: "sports", capability: "programmer_paris", params: { canaux, jours: days, paris_par_jour: 2, theme: "corners", debut: "2026-10-24" } }],
  resolved: {},
  questions: [],
  impossible: [],
});

describe("1. classe de confirmation décidée sur ce que les étapes touchent", () => {
  it("« active la catégorie Buteurs à 10 paris par jour » sans portée → OUI, réservé à l'admin", async () => {
    const kit = await createBossKit();
    await kit.prisma.betCategory.create({ data: { key: "buteurs", name: "Buteurs", active: false, sortOrder: 3, picksPerDay: 2, channelIds: [] } as never });
    const raw = normalizePlannerOutput({ teamKey: "sports", kind: "ADJUST", mode: "simulation", steps: [{ teamKey: "sports", capability: "changer_categorie", params: { categorie: "Buteurs", actif: true, paris_par_jour: 10 } }] }, { startDay: "2026-10-23" })!;
    expect(raw.scope).toEqual({ channelIds: [] });
    const v = await validatePlan(kit.deps, raw);
    expect(v.steps).toHaveLength(1);
    const cls = await classifyOrder(kit.deps, v);
    expect(cls.cls).toBe("confirm");
    expect(cls.reasons.join(" ")).toMatch(/vrai canal/);
    expect(adminOnlyOrder(v)).toBe(true);
  });

  it("étape sans déclaration ni dérogation → confirmation ; test A/B compté sur sa durée réelle", async () => {
    const kit = await createBossKit();
    const base = { plan: { teamKey: "algo", kind: "ADJUST", mode: "simulation", scope: { channelIds: [] }, steps: [], resolved: {}, questions: [], impossible: [] } as OrderPlan, steps: [], channelIds: [], fromDay: null, toDay: null, costCents: 0 };
    const unknown = await classifyOrder(kit.deps, { ...base, plannedSteps: [{ stepKey: "x", capability: "x", teamKey: "algo", summary: "x", params: {} }] });
    expect(unknown.cls).toBe("confirm");
    const ab = await classifyOrder(kit.deps, { ...base, plannedSteps: [{ stepKey: "ab", capability: "lancer_test_ab", teamKey: "algo", summary: "test", params: {}, touches: { channelIds: [kit.ids.test], days: 14 } }] });
    expect(ab.cls).toBe("confirm");
    expect(ab.days).toBe(14);
    const read = await classifyOrder(kit.deps, { ...base, plannedSteps: [{ stepKey: "q", capability: "question", teamKey: "algo", summary: "q", params: {}, touches: { channelIds: [] } }] });
    expect(read.cls).toBe("immediate");
  });
});

describe("2. analyser_canal par un ordre : jamais d'entrée par un lien d'invitation", () => {
  it("lien t.me/+… ou joinchat → refus avec le repli « dis-le-moi directement »", async () => {
    for (const l of ["https://t.me/+AbCdEfGh123", "t.me/joinchat/AAAA", "tg://join?invite=xyz"]) expect(isInviteLink(l), l).toBe(true);
    expect(isInviteLink("https://t.me/parisfoot")).toBe(false);
    expect(isInviteLink("@parisfoot")).toBe(false);
    const kit = await createBossKit();
    const cap = capability("inspiration", "analyser_canal")!;
    const r = await cap.check(kit.deps, { canal: "https://t.me/+AbCdEfGh123", canal_cible: "Paris Foot" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dis-le-moi directement/);
  });
});

describe("3. « pour de faux » annoncé = rien ne part en vrai", () => {
  it("équipe Paris passée en vrai + ordre pour de faux sur un vrai canal : dérogation de test, missions de test, récap « pour de faux »", async () => {
    const kit = await engine();
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "sports" }, data: { simulation: false } });
    const plan = sportsOn(["Foot Pro"], "simulation");
    const v = await validatePlan(kit.deps as never, plan);
    expect(v.plannedSteps[0]!.overrides![0]).toMatchObject({ channelId: "foot", isTest: true });
    expect(await effectiveOrderMode(kit.deps as never, v)).toBe("simulation");
    const recap = await orderRecap(kit.deps as never, v);
    expect(recap.lines[0]).toMatch(/pour de faux/);
    expect(recap.lines.join(" ")).toMatch(/canal Test/);
    const id = await orderRow(kit, plan);
    expect((await runOrder(kit.deps, id)).ok).toBe(true);
    expect(kit.t("channelPlanOverride")[0]).toMatchObject({ channelId: "foot", isTest: true });
    await planDay(kit.deps);
    const missions = kit.t("agentMission").filter((m) => m.orderId === id);
    expect(missions.length).toBeGreaterThan(0);
    for (const m of missions) expect(m).toMatchObject({ isTest: true, channelId: "test" });
    expect((missions[0]!.payload as { targetChannelIds: string[] }).targetChannelIds).toEqual(["foot"]);
    // Le même ordre en vrai : le récapitulatif dit « en vrai ».
    const vReal = await validatePlan(kit.deps as never, { ...plan, mode: "real", steps: [{ ...plan.steps[0]!, params: { ...plan.steps[0]!.params, mode: "vrai" } }] }, {});
    expect(await effectiveOrderMode(kit.deps as never, vReal)).toBe("real");
  });

  it("un ordre pour de faux sur un vrai canal ne suspend pas son plan de base", async () => {
    const kit = await engine();
    kit.prisma._model("channelAgentPlan").rows.push({ channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 3, personaId: "p1", windowStart: "09:00", windowEnd: "22:00", mix: { video: 0, photo: 0, text: 1 }, themes: [], createdAt: new Date() });
    const id = await orderRow(kit, { teamKey: "dating", scope: { channelIds: [] }, kind: "PROGRAM", period: { start: "2026-10-24", days: 2 }, mode: "simulation", steps: [{ teamKey: "dating", capability: "programmer_posts", params: { canaux: ["Rencontres VIP"], jours: 2, posts_par_jour: 2, persona: "Léa", debut: "2026-10-24", format: "texte" } }], resolved: {}, questions: [], impossible: [] });
    await runOrder(kit.deps, id);
    await planDay(kit.deps);
    const day = kit.t("agentMission").filter((m) => m.planDay === "2026-10-24");
    expect(day.filter((m) => m.orderId === id).every((m) => m.isTest === true)).toBe(true);
    expect(day.filter((m) => !m.orderId && m.createdBy === "GRAND_CHEF")).toHaveLength(3);
  });
});

describe("4. durée de 30 jours et seuil des 7 jours jamais contournés", () => {
  it("modification : période d'origine gardée, nouvelle durée comptée depuis le premier jour, borne 30 jours", () => {
    const steps = [{ stepKey: "s", capability: "programmer_paris", teamKey: "sports" as const, summary: "", params: {}, clamped: ["début 20 octobre déjà passé → 24 octobre"], overrides: [{ channelId: "c", teamKey: "sports" as const, fromDay: "2026-10-24", toDay: "2026-10-26" }] }];
    const live = { fromDay: "2026-10-20", toDay: "2026-10-22", maxTo: "2026-11-18", days: 3 };
    const same = pinStepsPeriod(steps, live, 3);
    expect(same.steps[0]!.overrides![0]).toMatchObject({ fromDay: "2026-10-20", toDay: "2026-10-22" });
    expect(same.steps[0]!.clamped).toEqual([]);
    expect(pinStepsPeriod(steps, live, 10).toDay).toBe("2026-10-29");
    expect(pinStepsPeriod(steps, live, 60).toDay).toBe("2026-11-18");
  });

  it("prolonger : 30 jours au plus depuis le DÉBUT de l'ordre, interprétation (toDay) suivie", async () => {
    const kit = await engine();
    const plan = sportsOn(["Foot Pro"], "simulation", 3);
    const id = await orderRow(kit, plan, { status: "RUNNING", startsAt: new Date("2026-10-04T22:00:00Z") });
    // Dérogation reposée par une modification : commence aujourd'hui, mais l'ordre a commencé le 5 octobre.
    kit.prisma._model("channelPlanOverride").rows.push({ id: "o1", orderId: id, channelId: "foot", teamKey: "sports", fromDay: "2026-10-24", toDay: "2026-10-26", closedAt: null, isTest: true, createdAt: new Date() });
    const r = await extendOrder(kit.deps, id, 40);
    expect(r.ok).toBe(true);
    expect(r.toDay).toBe("2026-11-03");
    const interp = kit.t("teamOrder").find((o) => o.id === id)!.interpretation as { toDay: string; period: { days: number } };
    expect(interp.toDay).toBe("2026-11-03");
    expect(interp.period.days).toBe(30);
  });
});

describe("5. paris d'un ordre en vrai : ils remplacent ceux du client sur ce canal", () => {
  it("canal retiré des destinations du passage habituel ; quota = paris de l'ordre ; ordre pour de faux = rien de remplacé", async () => {
    const kit = await engine();
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "sports" }, data: { simulation: false } });
    const client = await kit.prisma.betCategory.create({ data: { key: "corners-client", name: "Corners", marketTypes: ["corners-all-game-ou-over"], active: true, sortOrder: 1, picksPerDay: 3, channelIds: ["foot"], leagues: [], bookmakers: [], minOdds: 1.5, maxOdds: 3.5 } as never });
    const real = sportsOn(["Foot Pro"], "real");
    real.steps[0]!.params.mode = "vrai";
    const v = await validatePlan(kit.deps as never, real);
    expect(v.clamped.join(" ")).toMatch(/remplacés par ceux de l'ordre/);
    const id = await orderRow(kit, real);
    await runOrder(kit.deps, id);
    expect([...(await replacedChannels(kit.deps, "2026-10-24"))]).toEqual(["foot"]);
    const r = await createBetMission(kit.deps, { category: toCategory(client as never), createdBy: "GRAND_CHEF", planDay: "2026-10-24" });
    expect(r.ok).toBe(false);
    // L'ordre a sa propre catégorie (jamais celle du client : ses paris ne réduisent pas le quota du client).
    const ov = kit.t("channelPlanOverride").find((o) => o.orderId === id)!;
    expect(ov.betCategoryId).not.toBe((client as { id: string }).id);
    const om = await createBetMission(kit.deps, { category: toCategory(client as never), createdBy: "HUMAN", orderId: id, channelIds: ["foot"], picksWanted: 2, planDay: "2026-10-24" });
    expect(om.ok).toBe(true);
  });
});

describe("6. chevauchement entre équipes", () => {
  it("deux équipes sur le même canal et la même période : la même question, jamais un échec", async () => {
    const kit = await createBossKit();
    await kit.prisma.teamOrder.create({ data: { number: 1, requestText: "x", interpretation: { steps: [], channelIds: [kit.ids.test], fromDay: "2026-10-23", toDay: "2026-10-25" }, kind: "PROGRAM", teamKey: "casino", status: "RUNNING" } as never });
    const o = await findOverlap(kit.deps, { teamKey: "sports", channelIds: [kit.ids.test], fromDay: "2026-10-24", toDay: "2026-10-24" });
    expect(o?.number).toBe(1);
  });
});

describe("7. étapes en échec et verrou par ordre", () => {
  it("rejouée seulement si rejouable, 3 essais au plus ; verrou exclusif", async () => {
    expect(stepPending(undefined)).toBe(true);
    expect(stepPending({ ok: false, message: "", at: "", retryable: false, attempts: 1 })).toBe(false);
    expect(stepPending({ ok: false, message: "", at: "", retryable: true, attempts: 1 })).toBe(true);
    expect(stepPending({ ok: false, message: "", at: "", retryable: true, attempts: STEP_MAX_ATTEMPTS })).toBe(false);
    const kit = await engine();
    expect(await acquireOrderLock(kit.deps, "o", "a")).toBe(true);
    expect(await acquireOrderLock(kit.deps, "o", "b")).toBe(false);
    // Étape refusée pour de bon : le suivi ne la rejoue pas toutes les 10 min.
    const id = await orderRow(kit, sportsOn(["Foot Pro"], "simulation"), { status: "RUNNING", progress: { plannedSteps: [{ stepKey: "k", capability: "inconnue", teamKey: "sports", summary: "", params: {} }], steps: { k: { ok: false, message: "non", at: "", retryable: false, attempts: 1 } } } });
    await tickOrders(kit.deps, START);
    const st = (kit.t("teamOrder").find((o) => o.id === id)!.progress as { steps: Record<string, { attempts: number }> }).steps.k!;
    expect(st.attempts).toBe(1);
  });
});

describe("8. modification : clés gardées, seules les étapes changées sont rejouées", () => {
  it("pari de test pas refait, quantité changée appliquée", async () => {
    const kit = await engine();
    kit.prisma._model("betCategory").rows.push({ id: "c1", key: "corners", name: "Corners", marketTypes: ["corners-all-game-ou-over"], active: true, sortOrder: 1, createdAt: new Date(), leagues: [], bookmakers: [], channelIds: [], picksPerDay: 2, minOdds: 1.5, maxOdds: 3.5 });
    const plan: OrderPlan = { ...sportsOn(["test"], "simulation"), steps: [{ teamKey: "sports", capability: "pari_unique", params: { categorie: "Corners" } }, ...sportsOn(["test"], "simulation").steps] };
    const id = await orderRow(kit, plan);
    await runOrder(kit.deps, id);
    const before = kit.t("agentMission").filter((m) => m.orderId === id).length;
    const keys = (kit.t("teamOrder").find((o) => o.id === id)!.progress as { plannedSteps: Array<{ stepKey: string }> }).plannedSteps.map((s) => s.stepKey);
    const changed = JSON.parse(JSON.stringify(plan)) as OrderPlan;
    changed.steps[1]!.params.paris_par_jour = 3;
    const r = await modifyOrder(kit.deps, id, changed);
    expect(r.ok).toBe(true);
    const after = kit.t("teamOrder").find((o) => o.id === id)!.progress as { plannedSteps: Array<{ stepKey: string }> };
    expect(after.plannedSteps.map((s) => s.stepKey)).toEqual(keys);
    expect(kit.t("agentMission").filter((m) => m.orderId === id).length).toBe(before);
    const open = kit.t("channelPlanOverride").filter((o) => o.orderId === id && !o.closedAt);
    expect(open).toHaveLength(1);
    expect(open[0]!.picksPerDay).toBe(3);
  });
});

describe("9. écritures calculées au moment d'agir", () => {
  it("mot interdit : la liste est relue au moment d'écrire (rien d'écrasé entre-temps)", async () => {
    const kit = await engine();
    kit.prisma._model("channel").rows.push({ id: "cas", title: "Roulette Pro", vertical: "CASINO", isTest: false, isActive: true, telegramChatId: -1004n, createdAt: new Date(), language: "fr", type: "CHANNEL" });
    const cap = capability("transverse", "mot_interdit_canal")!;
    const [step] = await cap.plan(kit.deps, { mot: "gratuit", canal: "Roulette Pro" }, { now: START, mode: "simulation", period: null });
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "casino" }, data: { forbiddenWords: ["bonus"] } });
    await cap.run(kit.deps, { id: "o", number: 1, teamKey: "transverse", kind: "ADJUST", status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: null, createdById: "admin1", progress: {} }, step!);
    expect(kit.t("agentTeamConfig").find((t) => t.teamKey === "casino")!.forbiddenWords).toEqual(["bonus", "gratuit"]);
  });

  it("changer_plan : mélange passé par une recommandation annulable, bornée", async () => {
    const kit = await engine();
    kit.prisma._model("channelAgentPlan").rows.push({ channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 3, personaId: "p1", windowStart: "09:00", windowEnd: "22:00", mix: { video: 1, photo: 2, text: 1 }, themes: [], createdAt: new Date() });
    const cap = capability("dating", "changer_plan")!;
    const [step] = await cap.plan(kit.deps, { canal: "Rencontres VIP", video: 0, photo: 0, texte: 1 }, { now: START, mode: "simulation", period: null });
    expect(step!.params).not.toHaveProperty("after");
    const r = await cap.run(kit.deps, { id: "o", number: 1, teamKey: "dating", kind: "ADJUST", status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: null, createdById: "admin1", progress: {} }, step!);
    expect(r.ok).toBe(true);
    const rec = kit.t("recommendation").find((x) => x.field === "mix")!;
    expect(rec.status).toBe("APPLIED");
    expect(rec.before).toEqual({ video: 1, photo: 2, text: 1 });
  });
});

describe("10. « annule » dans la minute", () => {
  it("ignoré en « Répondre » à un autre message ; production commencée → « déjà en route »", async () => {
    const kit = await engine();
    const id = await orderRow(kit, sportsOn(["test"], "simulation"), { status: "RUNNING" });
    await kit.prisma.setting.create({ data: { key: ORDER_QUICK_CANCEL_SETTING, value: { orderId: id, at: START.toISOString(), chatId: null } } });
    const deps = kit.deps as never;
    expect(await orderQuickCancel(deps, { replyToMessageId: 12 }, { word: "cancel", pendingOpen: false })).toBeNull();
    kit.prisma._model("agentMission").rows.push({ id: "m1", orderId: id, status: "RUNNING", steps: [{ status: "RUNNING", startedAt: START.toISOString() }], postId: null, createdAt: new Date() });
    const r = await orderQuickCancel(deps, {}, { word: "cancel", pendingOpen: false });
    expect(r?.reply.reply).toMatch(/déjà commencé|en route/);
    expect(kit.t("teamOrder").find((o) => o.id === id)!.status).toBe("RUNNING");
  });
});

describe("11, 12, 14. choix fermés, pas de OUI ambigu, textes de l'IA contrôlés", () => {
  it("un numéro au jeton périmé ne rejoue rien ; question de l'IA avec un chiffre inventé → question du code", async () => {
    const kit = await createBossKit();
    const order = await kit.prisma.teamOrder.create({ data: { number: 7, requestText: "x", interpretation: { steps: [], alternatives: [{ label: "a", capability: { teamKey: "sports", key: "pari_unique", params: {} } }], choice: { token: "abc", kind: "alt", at: "" } }, kind: "PROGRAM", teamKey: "sports", status: "RUNNING" } as never });
    const id = (order as { id: string }).id;
    const r = await replayAlternative(kit.deps, `${id}:0:abc`, { actor: { userId: null, via: "TELEGRAM" } });
    expect(r.reply).toMatch(/plus valable|expiré/);
    const v = await validatePlan(kit.deps, { teamKey: "sports", scope: { channelIds: [] }, kind: "PROGRAM", mode: "simulation", steps: [], resolved: {}, questions: ["Tu veux 47 paris par jour ?"], impossible: [] });
    const q = await submitOrder(kit.deps, v, { requestText: "programme des paris", actor: { userId: null, via: "TELEGRAM" } });
    expect(q.reply).not.toMatch(/47/);
  });

  it("une confirmation déjà ouverte : les replis se choisissent par numéro seulement (pas de nouvelle question en OUI)", async () => {
    const kit = await createBossKit();
    const { createBossPending, readBossPending } = await import("../boss/confirm");
    const first = await createBossPending(kit.deps, { actionKey: "pause_equipe", params: {}, summary: "Je mets Casino en pause ?" });
    const v = await validatePlan(kit.deps, { teamKey: "sports", scope: { channelIds: [] }, kind: "PROGRAM", mode: "simulation", steps: [], resolved: {}, questions: [], impossible: [{ part: "le basket", reason: "pas suivi", alternatives: [{ label: "les corners", capability: { teamKey: "sports", key: "pari_unique", params: {} } }] }] });
    const r = await submitOrder(kit.deps, v, { requestText: "du basket", actor: { userId: null, via: "TELEGRAM" } });
    expect(r.buttons).toBeUndefined();
    expect(r.reply).toMatch(/1\. les corners/);
    expect((await readBossPending(kit.deps))!.id).toBe(first.pendingId);
  });
});

describe("15, 16. messages simples, catégorie d'ordre, cotes, plan du jour protégé", () => {
  it("erreurs brutes jamais montrées ; catégorie d'ordre jamais activée à part ; appels de cotes estimés ; plan du jour sans dérogations lisibles", async () => {
    expect(friendlyReason("PrismaClientKnownRequestError: Unique constraint failed")).toBe("un souci technique");
    expect(friendlyReason("BLOCKED_BUDGET")).toBe("plafond de dépense atteint");
    expect(friendlyReason("aucune cote entre 1,5 et 3,5")).toBe("aucune cote entre 1,5 et 3,5");
    expect(estimatedOddsCalls({ days: 3, channels: 1, perDay: 2 })).toBe(12);
    const kit = await engine();
    kit.prisma._model("betCategory").rows.push({ id: "oc", key: "ordre-1-x", name: "X (ordre n°1)", active: false, createdByOrderId: "o1", createdAt: new Date() });
    const r = await setBetCategoryActive(kit.deps, "oc", true, { userId: null, via: "TELEGRAM" });
    expect(r.ok).toBe(false);
    expect((await setBetCategoryActive(kit.deps, "oc", true, { userId: null, via: "TELEGRAM" }, { orderId: "o1" })).ok).toBe(true);
    const broken = { ...kit.deps, prisma: new Proxy(kit.prisma, { get: (t, k) => (k === "channelPlanOverride" ? { findMany: async () => { throw new Error("boom"); } } : (t as never)[k]) }) };
    await expect(planDay(broken as never)).resolves.toMatchObject({ day: "2026-10-24" });
  });

  it("capacité inconnue : message en français, détail au journal", async () => {
    const kit = await engine();
    const id = await orderRow(kit, sportsOn(["test"], "simulation"), { progress: { plannedSteps: [{ stepKey: "k", capability: "programmer_rien", teamKey: "sports", summary: "", params: {} }] } });
    const r = await runOrder(kit.deps, id);
    expect(r.message).not.toMatch(/Capacité inconnue|programmer_rien/);
  });
});

describe("demandes de membres (raccords avec le correcteur 2)", () => {
  it("ordre annulé faute de OUI : jamais une demande mise de côté ; le membre est prévenu", async () => {
    const kit = await createBossKit();
    const { sweepStaleOrderConfirmations } = await import("./request");
    const { deferBossPending } = await import("../boss/confirm");
    const kept = (await kit.prisma.teamOrder.create({ data: { number: 21, requestText: "x", interpretation: { steps: [] }, kind: "PROGRAM", teamKey: "sports", status: "WAITING_CONFIRM" } as never })) as { id: string };
    await deferBossPending(kit.deps, { actionKey: "confirmer_ordre", params: { ordre: kept.id, op: "launch" }, summary: "s", text: "t", chatId: null, requestedBy: { telegramUserId: "777", firstName: "Léa" } });
    const gone = (await kit.prisma.teamOrder.create({ data: { number: 22, requestText: "x", interpretation: { steps: [], requestedBy: { telegramUserId: "777", firstName: "Léa" } }, kind: "PROGRAM", teamKey: "sports", status: "WAITING_CONFIRM" } as never })) as { id: string };
    const sentBefore = kit.sent.length;
    expect(await sweepStaleOrderConfirmations(kit.deps)).toBe(1);
    expect(kit.tables("teamOrder").find((o) => o.id === kept.id)!.status).toBe("WAITING_CONFIRM");
    expect(kit.tables("teamOrder").find((o) => o.id === gone.id)!.status).toBe("CANCELLED");
    expect(kit.sent.slice(sentBefore).some((m) => /Léa/.test(m.html))).toBe(true);
  });
});
