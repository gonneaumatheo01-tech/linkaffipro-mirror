/**
 * Phase 33, chantier A : Grand Chef (runOrder / stopOrder / extendOrder / modifyOrder), dérogations lues par le plan
 * du jour et éteintes après `toDay`, missions liées à l'ordre, reprise sans double, fin automatique, catégorie d'ordre
 * jamais active hors de l'ordre. Faux prisma, faux fournisseur de cotes, aucun réseau.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { createMarketListOddsProvider, MARKETS_WITH_OFFSIDES } from "../testing/odds-markets";
import { ensureTeamConfigs } from "../missions/settings";
import { planDay } from "../orchestrator/plan-day";
import { runSportsPassage } from "../sports/passage";
import type { OrderPlan } from "./contract";
import { setOrderEventHook, type OrderEvent } from "./events";
import { activeOverridesFor } from "./overrides";
import { extendOrder, modifyOrder, runOrder, stopOrder } from "./run";
import { tickOrders } from "./tick";

const DAY1 = new Date("2026-10-24T09:00:00Z"); // 11 h à Paris
const at = (day: string, hourUtc = 9) => new Date(`${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`);

async function setup() {
  const kit = createEngineKit({ start: DAY1, providers: { odds: createMarketListOddsProvider({ now: () => DAY1, markets: MARKETS_WITH_OFFSIDES }) } });
  await ensureTeamConfigs(kit.prisma);
  kit.prisma._model("persona").rows.push({ id: "p1", name: "Léa", isActive: true, universe: "dating", createdAt: new Date() });
  kit.prisma._model("user").rows.push({ id: "admin1", email: "a@x", role: "ADMIN" });
  return kit;
}

type Kit = Awaited<ReturnType<typeof setup>>;

let nextNumber = 1;
async function order(kit: Kit, plan: OrderPlan, kind: OrderPlan["kind"] = plan.kind): Promise<string> {
  const row = await kit.prisma.teamOrder.create({
    data: { number: nextNumber++, requestText: "demande", interpretation: JSON.parse(JSON.stringify(plan)), kind, teamKey: plan.teamKey, status: "WAITING_CONFIRM", createdById: "admin1", chatId: "42", progress: {} } as never,
  });
  return (row as { id: string }).id;
}

/** La phrase du client du 24 octobre, telle que planifiée : canal Test comme un canal paris, 3 jours, hors-jeux. */
const ASIF_SPORTS: OrderPlan = {
  teamKey: "transverse",
  asIfTeamKey: "sports",
  scope: { test: true },
  kind: "WHAT_IF",
  period: { start: "2026-10-24", days: 3 },
  perDay: 2,
  theme: "hors-jeux",
  mode: "simulation",
  steps: [{ capability: "faire_comme_si", teamKey: "transverse", params: { equipe: "paris sportifs", test: true, jours: 3, theme: "hors-jeux", par_jour: 2, debut: "2026-10-24" } }],
  resolved: {},
  questions: [],
  impossible: [],
};

const DATING_REAL: OrderPlan = {
  teamKey: "dating",
  scope: { channelIds: ["real"] },
  kind: "PROGRAM",
  period: { start: "2026-10-24", days: 2 },
  mode: "real",
  steps: [{ capability: "programmer_posts", teamKey: "dating", params: { canaux: ["Rencontres VIP"], jours: 2, posts_par_jour: 2, persona: "Léa", debut: "2026-10-24", themes: ["café", "voyage"] } }],
  resolved: {},
  questions: [],
  impossible: [],
};

afterEach(() => setOrderEventHook(null));

describe("Grand Chef : ordre « comme si » Paris sportifs sur le canal Test", () => {
  it("lancement : dérogation datée, catégorie créée pour l'ordre (inactive), ordre en cours, événement « started »", async () => {
    const kit = await setup();
    const events: OrderEvent[] = [];
    setOrderEventHook((_d, e) => void events.push(e));
    const id = await order(kit, ASIF_SPORTS);
    const r = await runOrder(kit.deps, id);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("RUNNING");
    const ov = kit.t("channelPlanOverride");
    expect(ov).toHaveLength(1);
    expect(ov[0]).toMatchObject({ channelId: "test", teamKey: "sports", fromDay: "2026-10-24", toDay: "2026-10-26", picksPerDay: 2, isTest: true, orderId: id });
    const cat = kit.t("betCategory").find((c) => c.createdByOrderId === id)!;
    expect(cat).toMatchObject({ active: false, key: "ordre-1-hors-jeux" });
    expect(ov[0]!.betCategoryId).toBe(cat.id);
    expect((cat.expiresAt as Date).toISOString()).toBe(new Date("2026-10-26T23:00:00Z").toISOString() /* minuit à Paris (heure d'hiver) */);
    expect(events.map((e) => e.type)).toEqual(["started"]);
    expect(events[0]!.order?.id).toBe(id);
    // Relancé (reprise après redémarrage) : rien en double.
    await runOrder(kit.deps, id);
    expect(kit.t("channelPlanOverride")).toHaveLength(1);
    expect(kit.t("betCategory").filter((c) => c.createdByOrderId === id)).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("plan du jour × 3 : une sélection par jour sur Test, liée à l'ordre (HUMAN, admin, isTest) ; rien après toDay", async () => {
    const kit = await setup();
    const id = await order(kit, ASIF_SPORTS);
    await runOrder(kit.deps, id);
    for (const day of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
      kit.setNow(at(day));
      await planDay(kit.deps);
      await planDay(kit.deps); // deux passages le même jour : pas de doublon
    }
    const missions = kit.t("agentMission").filter((m) => m.orderId === id);
    expect(missions.map((m) => m.planDay)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    for (const m of missions) {
      expect(m).toMatchObject({ kind: "BET", channelId: "test", isTest: true, createdBy: "HUMAN", createdById: "admin1" });
      expect(m.payload).toMatchObject({ orderId: id, picksWanted: 2, targetChannelIds: ["test"] });
    }
    // Le passage habituel de l'équipe ne voit jamais la catégorie de l'ordre.
    kit.setNow(at("2026-10-26", 8));
    const passage = await runSportsPassage(kit.deps as never);
    expect(passage.created).toBe(0);
    kit.setNow(at("2026-10-27"));
    expect(await activeOverridesFor(kit.deps, "test", "2026-10-27")).toHaveLength(0);
    await planDay(kit.deps);
    expect(kit.t("agentMission").filter((m) => m.orderId === id)).toHaveLength(3);
  });

  it("suivi : jours terminés, fin automatique (DONE + bilan), catégorie d'ordre inactive après expiration", async () => {
    const kit = await setup();
    const events: OrderEvent[] = [];
    setOrderEventHook((_d, e) => void events.push(e));
    const id = await order(kit, ASIF_SPORTS);
    await runOrder(kit.deps, id);
    for (const day of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
      kit.setNow(at(day));
      await planDay(kit.deps);
    }
    for (const m of kit.t("agentMission")) m.status = "DONE";
    // Quelqu'un active la catégorie de l'ordre à la main : le suivi la remet inactive après l'expiration.
    kit.t("betCategory").find((c) => c.createdByOrderId === id)!.active = true;
    const r = await tickOrders(kit.deps, at("2026-10-27", 10));
    expect(r.finished).toBe(1);
    expect(kit.t("teamOrder").find((o) => o.id === id)!.status).toBe("DONE");
    expect(kit.t("betCategory").find((c) => c.createdByOrderId === id)!.active).toBe(false);
    expect(events.filter((e) => e.type === "day_done").map((e) => e.day)).toEqual(["2026-10-24", "2026-10-25"]);
    expect(events.at(-1)!.type).toBe("finished");
    expect(events.at(-1)!.facts).toMatchObject({ missions: 3, done: 3 });
    const progress = kit.t("teamOrder").find((o) => o.id === id)!.progress as Record<string, unknown>;
    expect(progress).toMatchObject({ missionsDone: 3, missionsFailed: 0, missionsPlanned: 6 });
  });

  it("échecs au-delà de 2 → événement ; BLOCKED_BUDGET → ordre bloqué", async () => {
    const kit = await setup();
    const events: OrderEvent[] = [];
    setOrderEventHook((_d, e) => void events.push(e));
    const id = await order(kit, ASIF_SPORTS);
    await runOrder(kit.deps, id);
    for (let i = 0; i < 3; i++) kit.prisma._model("agentMission").rows.push({ id: `f${i}`, orderId: id, teamKey: "sports", status: "FAILED", planDay: "2026-10-24", steps: [], payload: {}, lastError: "cote disparue", createdAt: new Date(), postId: null });
    await tickOrders(kit.deps, at("2026-10-24", 10));
    expect(events.some((e) => e.type === "failures" && e.failures === 3)).toBe(true);
    kit.prisma._model("agentMission").rows.push({ id: "b1", orderId: id, teamKey: "sports", status: "BLOCKED_BUDGET", planDay: "2026-10-24", steps: [], payload: {}, lastError: "Plafond atteint", createdAt: new Date(), postId: null });
    await tickOrders(kit.deps, at("2026-10-24", 11));
    expect(kit.t("teamOrder").find((o) => o.id === id)!.status).toBe("BLOCKED");
    expect(events.some((e) => e.type === "blocked")).toBe(true);
  });
});

describe("Grand Chef : ordre Rencontres sur un vrai canal", () => {
  it("la dérogation remplace le plan pendant la période, le plan de base reprend après (jamais modifié)", async () => {
    const kit = await setup();
    kit.prisma._model("channelAgentPlan").rows.push({ channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 3, personaId: "p1", windowStart: "09:00", windowEnd: "22:00", mix: { video: 0, photo: 0, text: 1 }, themes: [], createdAt: new Date() });
    const basePlan = JSON.stringify(kit.t("channelAgentPlan")[0]);
    const id = await order(kit, DATING_REAL);
    const r = await runOrder(kit.deps, id);
    expect(r.status).toBe("RUNNING");
    await planDay(kit.deps);
    const day1 = kit.t("agentMission").filter((m) => m.planDay === "2026-10-24");
    expect(day1).toHaveLength(2);
    expect(day1.every((m) => m.orderId === id && m.createdBy === "HUMAN" && m.isTest === false)).toBe(true);
    expect(day1.map((m) => (m.payload as { theme?: string }).theme)).toEqual(["café", "voyage"]);
    expect((day1[0]!.payload as { orderPlan?: unknown }).orderPlan).toMatchObject({ personaId: "p1", themes: ["café", "voyage"], postsPerDay: 2 });
    kit.setNow(at("2026-10-26"));
    for (const m of kit.t("agentMission")) m.status = "DONE";
    await planDay(kit.deps);
    const day3 = kit.t("agentMission").filter((m) => m.planDay === "2026-10-26");
    expect(day3).toHaveLength(3);
    expect(day3.every((m) => !m.orderId && m.createdBy === "GRAND_CHEF")).toBe(true);
    expect(JSON.stringify(kit.t("channelAgentPlan")[0])).toBe(basePlan);
  });

  it("deux ordres sur le même canal et la même période → question (aucune dérogation empilée)", async () => {
    const kit = await setup();
    const a = await order(kit, DATING_REAL);
    await runOrder(kit.deps, a);
    const b = await order(kit, DATING_REAL);
    const r = await runOrder(kit.deps, b);
    expect(r.ok).toBe(false);
    expect(r.conflicts?.[0]?.orderId).toBe(a);
    expect(r.message).toMatch(/lequel garder/);
    expect(kit.t("channelPlanOverride").filter((o) => o.orderId === b)).toHaveLength(0);
  });

  it("arrêt : missions non commencées annulées, celle en cours finit, dérogation fermée", async () => {
    const kit = await setup();
    const id = await order(kit, DATING_REAL);
    await runOrder(kit.deps, id);
    await planDay(kit.deps);
    const [m1, m2] = kit.t("agentMission").filter((m) => m.orderId === id);
    m1!.status = "RUNNING";
    const r = await stopOrder(kit.deps, id, { userId: "admin1", via: "TELEGRAM" });
    expect(r).toMatchObject({ ok: true, cancelled: 1, running: 1 });
    expect(m2!.status).toBe("CANCELLED");
    expect(m1!.status).toBe("RUNNING");
    expect(kit.t("channelPlanOverride").every((o) => o.closedAt)).toBe(true);
    expect(kit.t("teamOrder").find((o) => o.id === id)!.status).toBe("CANCELLED");
    expect(await activeOverridesFor(kit.deps, "real", "2026-10-24")).toHaveLength(0);
  });

  it("prolongation bornée à 30 jours ; modification = dérogations remplacées", async () => {
    const kit = await setup();
    const id = await order(kit, DATING_REAL);
    await runOrder(kit.deps, id);
    const e = await extendOrder(kit.deps, id, 2);
    expect(e).toMatchObject({ ok: true, toDay: "2026-10-27" });
    const big = await extendOrder(kit.deps, id, 90);
    expect(big.toDay).toBe("2026-11-22");
    const m = await modifyOrder(kit.deps, id, { ...DATING_REAL, steps: [{ ...DATING_REAL.steps[0]!, params: { ...DATING_REAL.steps[0]!.params, posts_par_jour: 3 } }] });
    expect(m.ok).toBe(true);
    const ovs = kit.t("channelPlanOverride").filter((o) => o.orderId === id);
    expect(ovs.filter((o) => !o.closedAt)).toHaveLength(1);
    expect(ovs.find((o) => !o.closedAt)!.postsPerDay).toBe(3);
    await planDay(kit.deps);
    expect(kit.t("agentMission").filter((x) => x.orderId === id && x.planDay === "2026-10-24")).toHaveLength(3);
  });

  it("reprise après arrêt du worker : l'étape non faite est rejouée par le suivi, sans doublon", async () => {
    const kit = await setup();
    const id = await order(kit, ASIF_SPORTS);
    await runOrder(kit.deps, id);
    // Simule un arrêt après la pose de la dérogation mais avant l'enregistrement de l'étape.
    const row = kit.t("teamOrder").find((o) => o.id === id)!;
    row.progress = { ...(row.progress as object), steps: {} };
    await tickOrders(kit.deps, at("2026-10-24", 10));
    expect(kit.t("channelPlanOverride")).toHaveLength(1);
    expect(kit.t("betCategory").filter((c) => c.createdByOrderId === id)).toHaveLength(1);
    expect(Object.values((row.progress as { steps: Record<string, { ok: boolean }> }).steps).every((s) => s.ok)).toBe(true);
  });

  it("équipe en pause → ordre bloqué, reprend quand l'équipe repart", async () => {
    const kit = await setup();
    kit.t("agentTeamConfig").find((t) => t.teamKey === "dating")!.paused = true;
    const id = await order(kit, DATING_REAL);
    const r = await runOrder(kit.deps, id);
    expect(r.status).toBe("BLOCKED");
    kit.t("agentTeamConfig").find((t) => t.teamKey === "dating")!.paused = false;
    await tickOrders(kit.deps, at("2026-10-24", 10));
    expect(kit.t("teamOrder").find((o) => o.id === id)!.status).toBe("RUNNING");
  });

  it("ordre ponctuel : pari de test lié à l'ordre ; réglage : DONE tout de suite", async () => {
    const kit = await setup();
    kit.prisma._model("betCategory").rows.push({ id: "c1", key: "corners", name: "Corners", marketTypes: ["corners-all-game-ou-over"], active: true, sortOrder: 1, createdAt: new Date(), leagues: [], bookmakers: [], channelIds: [], picksPerDay: 2, minOdds: 1.5, maxOdds: 3.5 });
    const one = await order(kit, { ...ASIF_SPORTS, teamKey: "sports", asIfTeamKey: null, kind: "ONE_SHOT", steps: [{ capability: "pari_unique", teamKey: "sports", params: { categorie: "Corners" } }] });
    const r = await runOrder(kit.deps, one);
    expect(r.status).toBe("RUNNING");
    expect(kit.t("agentMission").filter((m) => m.orderId === one)).toHaveLength(1);
    await runOrder(kit.deps, one);
    expect(kit.t("agentMission").filter((m) => m.orderId === one)).toHaveLength(1);
    const adj = await order(kit, { ...DATING_REAL, teamKey: "transverse", kind: "ADJUST", steps: [{ capability: "mot_interdit_canal", teamKey: "transverse", params: { mot: "gratuit", canal: "Rencontres VIP" } }] });
    expect((await runOrder(kit.deps, adj)).status).toBe("DONE");
    expect(kit.t("agentTeamConfig").find((t) => t.teamKey === "dating")!.forbiddenWords).toEqual(["gratuit"]);
  });
});
