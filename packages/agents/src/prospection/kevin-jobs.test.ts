/**
 * Phase 31, chantier D — Kevin et la file `agents-prospection` : aiguillage des tâches, planification (heures de
 * Paris, lundi, idempotence, pause), questions des offres une seule fois, phrases du client (section 5) → entrées du
 * catalogue, boutons → Pipeline, montant → `answerPendingDeal`, capacités des ordres, voix. Base en mémoire, faux
 * chantiers A / B / C (port), fausse IA, aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bossAiTurn } from "../boss/execute";
import { bossFastPath } from "../boss/fast";
import { BOSS_CATALOG, bossActionAllowed } from "../boss/catalog";
import { PROSPECTION_ACTIONS, PROSPECTION_READ_ACTION_KEYS, filterFrom } from "../boss/catalog-prospection";
import { createBossKit, type BossKit } from "../boss/testing";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../boss/voice";
import { capability, isOrderableTeam } from "../orders/registry";
import { agentCard, findAgent, orderTeamLabel } from "../orders/agents-dict";
import type { ProspectionQueueJob } from "./contract";
import { prospectionSchedule, runProspectionJob } from "./jobs";
import { prospectButton } from "./kevin-buttons";
import type { ProspectionKevinDeps, ProspectionKevinPort } from "./kevin-port";
import { PROSPECTION_KEVIN_VARIANTS, channelRefIn, parseDeal, parseOfferText, statusWordOf, usernameOf } from "./kevin-texts";
import { ensureProspectionOfferQuestions, PROSPECTION_OFFER_KEYS } from "./kevin-offers";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });
const MEMBER = { kind: "member", telegramUserId: 7n, memberId: "m", role: "MEMBER", firstName: "Zoé" } as const;
const ADMIN_ID = "4242";

type Queued = { job: ProspectionQueueJob; opts?: { jobId?: string; delayMs?: number; priority?: number } };

function fakePort(over: Partial<ProspectionKevinPort> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const rec =
    <T>(name: string, out: T) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args.slice(1));
      return out;
    };
  const port: Partial<ProspectionKevinPort> = {
    planDiscoveryLots: rec("planDiscoveryLots", [
      { source: "directories", languages: ["fr"], vertical: "CASINO" },
      { source: "web_search", languages: ["fr"], vertical: "SPORTS" },
    ]) as never,
    runDiscovery: rec("runDiscovery", { found: 1 }) as never,
    requestDiscovery: rec("requestDiscovery", { lots: [], enqueued: 3 }) as never,
    enrichProspect: rec("enrichProspect", { status: "ENRICHING", reason: null, scoreQueued: true }) as never,
    scoreAndStore: rec("scoreAndStore", { score: 70 }) as never,
    buildDossier: rec("buildDossier", { ok: true }) as never,
    transitionProspect: rec("transitionProspect", { ok: true }) as never,
    snoozeProspect: rec("snoozeProspect", { ok: true }) as never,
    returnSkippedProspects: rec("returnSkippedProspects", 0) as never,
    addProspectNote: rec("addProspectNote", { ok: true }) as never,
    sendDailyTop: rec("sendDailyTop", { sent: 2, qaBlocked: false }) as never,
    handleProspectCallback: rec("handleProspectCallback", { handled: true, toast: "Noté", reply: "C'est noté : @pronos_fr passe en contacté." }) as never,
    answerPendingDeal: rec("answerPendingDeal", null) as never,
    runReminders: rec("runReminders", { sent: 1 }) as never,
    sendWeeklyReport: rec("sendWeeklyReport", { sent: true }) as never,
    addManualProspect: rec("addManualProspect", { prospectId: "p-new", created: true }) as never,
    ...over,
  };
  return { port, calls };
}

async function kitWith(table: Parameters<typeof createBossKit>[0] = [], over: Partial<ProspectionKevinPort> = {}, withQueue = true) {
  const kit = await createBossKit(table);
  const { port, calls } = fakePort(over);
  const queued: Queued[] = [];
  const deps = kit.deps as unknown as ProspectionKevinDeps;
  deps.prospectionKevin = port;
  deps.prospectionLlm = null;
  if (withQueue) deps.prospection = { enqueue: vi.fn(async (job, opts) => void queued.push({ job, opts })) };
  let now = new Date("2026-10-27T09:00:00Z");
  deps.now = () => now;
  const setNow = (iso: string) => (now = new Date(iso));
  return { kit, deps, calls, queued, setNow };
}

async function seedProspect(kit: BossKit, data: Record<string, unknown>) {
  return kit.prisma.prospect.create({
    data: {
      channelUrl: `https://t.me/${data.username ?? "x"}`,
      title: "Canal",
      kind: "CHANNEL",
      vertical: "SPORTS",
      region: "EU",
      countries: ["FR"],
      status: "QUALIFIED",
      contactConfidence: "HIGH",
      bestContact: "@admin_pub",
      competitiveState: "FREE",
      medianViews: 2100,
      subscribers: 17000,
      viewRate: 0.12,
      score: 74,
      tier: "A",
      tierReason: "2,1k vues par post, France, contact direct",
      sourceType: "DIRECTORY",
      discoveredAt: new Date("2026-10-20T10:00:00Z"),
      priority: 0,
      ...data,
    } as never,
  });
}

beforeEach(() => resetVoiceRotation());

// ------------------------------------------------------------------------------------------------ planification

describe("planification de la prospection (heure de Paris)", () => {
  it("nuit : découverte 02:00-06:00 une seule fois, lots étalés ; questions des offres une seule fois", async () => {
    const { deps, calls, queued, setNow, kit } = await kitWith();
    setNow("2026-10-27T01:30:00Z"); // 02:30 Paris (mardi)
    await prospectionSchedule(deps);
    const lots = queued.filter((q) => q.job.type === "prospection.discover");
    expect(lots.map((q) => q.opts?.jobId)).toEqual(["prospection.discover:2026-10-27:0", "prospection.discover:2026-10-27:1"]);
    expect(lots[1]!.opts!.delayMs).toBeGreaterThan(0);
    expect(calls.planDiscoveryLots).toHaveLength(1);
    // Questions des offres : rangées (une seule envoyée à la fois), jamais reposées.
    expect(kit.tables("humanRequest").map((r) => r.key)).toEqual([PROSPECTION_OFFER_KEYS.brand, PROSPECTION_OFFER_KEYS.countries, PROSPECTION_OFFER_KEYS.deal]);
    setNow("2026-10-27T02:30:00Z");
    await prospectionSchedule(deps);
    expect(calls.planDiscoveryLots).toHaveLength(1);
    expect(kit.tables("humanRequest")).toHaveLength(3);
    expect((await ensureProspectionOfferQuestions(deps)).queued).toBe(0);
    // Hors fenêtre : rien.
    setNow("2026-10-28T06:10:00Z");
    await prospectionSchedule(deps);
    expect(calls.planDiscoveryLots).toHaveLength(1);
  });

  it("une offre existe déjà : aucune question", async () => {
    const { deps, kit } = await kitWith();
    await kit.prisma.affiliateOffer.create({ data: { brand: "Winamax", vertical: "SPORTS", countries: ["FR"], dealTypes: { cpa: 100 }, isActive: true } as never });
    expect((await ensureProspectionOfferQuestions(deps)).queued).toBe(0);
    expect(kit.tables("humanRequest")).toHaveLength(0);
  });

  it("enrichissement continu : canaux ajoutés à la main d'abord, plafond du jour, jamais deux fois dans l'heure", async () => {
    const { deps, kit, queued, setNow } = await kitWith();
    setNow("2026-10-27T13:00:00Z");
    await kit.prisma.setting.create({ data: { key: "prospection.enrich_daily_cap", value: 2 } });
    await seedProspect(kit, { username: "vieux", status: "DISCOVERED", discoveredAt: new Date("2026-10-20T10:00:00Z") });
    const manual = await seedProspect(kit, { username: "manuel", status: "DISCOVERED", priority: 10, discoveredAt: new Date("2026-10-26T10:00:00Z") });
    await seedProspect(kit, { username: "recent", status: "DISCOVERED", discoveredAt: new Date("2026-10-25T10:00:00Z") });
    await prospectionSchedule(deps);
    const enr = queued.filter((q) => q.job.type === "prospection.enrich");
    expect(enr).toHaveLength(2);
    expect(enr[0]).toMatchObject({ job: { prospectId: manual.id }, opts: { priority: 1 } });
    expect(enr[1]!.opts!.priority).toBe(10);
    await prospectionSchedule(deps);
    expect(queued.filter((q) => q.job.type === "prospection.enrich")).toHaveLength(2);
  });

  it("9 h : Top du jour ; 9 h 05 : rappels ; une seule fois par jour même si la tâche est remise", async () => {
    const { deps, calls, queued, setNow } = await kitWith();
    setNow("2026-10-27T07:50:00Z"); // 08:50 Paris
    await prospectionSchedule(deps);
    expect(queued.filter((q) => q.job.type === "prospection.daily-top")).toHaveLength(0);
    setNow("2026-10-27T08:01:00Z"); // 09:01
    await prospectionSchedule(deps);
    const top = queued.filter((q) => q.job.type === "prospection.daily-top");
    expect(top.map((q) => q.opts?.jobId)).toEqual(["prospection.daily-top:2026-10-27"]);
    expect(queued.some((q) => q.job.type === "prospection.reminders")).toBe(false);
    await runProspectionJob(deps, top[0]!.job);
    await runProspectionJob(deps, top[0]!.job);
    expect(calls.sendDailyTop).toHaveLength(1);
    expect(calls.sendDailyTop![0]![0]).toMatchObject({ count: 10, scope: "morning" });
    // Plus remis en file une fois envoyé.
    setNow("2026-10-27T08:06:00Z"); // 09:06
    await prospectionSchedule(deps);
    expect(queued.filter((q) => q.job.type === "prospection.daily-top")).toHaveLength(1);
    const rem = queued.filter((q) => q.job.type === "prospection.reminders");
    expect(rem.map((q) => q.opts?.jobId)).toEqual(["prospection.reminders:2026-10-27"]);
    await runProspectionJob(deps, rem[0]!.job);
    await runProspectionJob(deps, rem[0]!.job);
    expect(calls.runReminders).toHaveLength(1);
  });

  it("sans offre : Kevin le dit sous la liste", async () => {
    const { deps, kit } = await kitWith();
    await runProspectionJob(deps, { type: "prospection.daily-top" });
    expect(kit.sent.map((s) => s.html)).toContain(PROSPECTION_KEVIN_VARIANTS.noOffer.find((t) => kit.sent.some((s) => s.html === t)));
  });

  it("lundi : le rapport de la semaine part avant le Top, une seule fois", async () => {
    const order: string[] = [];
    const { deps, queued, setNow } = await kitWith([], {
      sendWeeklyReport: async () => void order.push("weekly") as never,
      sendDailyTop: async () => (order.push("top"), { sent: 0, qaBlocked: false }),
    });
    setNow("2026-11-02T08:10:00Z"); // lundi 9 h 10 Paris
    await prospectionSchedule(deps);
    expect(queued.map((q) => q.opts?.jobId)).toEqual(expect.arrayContaining(["prospection.weekly-report:2026-11-02", "prospection.daily-top:2026-11-02"]));
    await runProspectionJob(deps, { type: "prospection.daily-top" });
    await runProspectionJob(deps, { type: "prospection.weekly-report" });
    expect(order).toEqual(["weekly", "top"]);
  });

  it("pause : aucune tâche ne tourne ; liste demandée → Kevin dit que c'est en pause", async () => {
    const { deps, calls, kit } = await kitWith();
    await kit.prisma.setting.create({ data: { key: "prospection.enabled", value: false } });
    for (const job of [{ type: "prospection.schedule" }, { type: "prospection.enrich", prospectId: "p" }, { type: "prospection.daily-top" }] as ProspectionQueueJob[])
      expect(await runProspectionJob(deps, job)).toEqual({ skipped: "disabled" });
    expect(Object.keys(calls)).toEqual([]);
    await runProspectionJob(deps, { type: "prospection.daily-top", requested: { chatId: ADMIN_ID, count: 10 } });
    expect(PROSPECTION_KEVIN_VARIANTS.disabled).toContain(kit.sent.at(-1)!.html);
  });

  it("aiguillage : chaque tâche va au bon chantier ; requalify = phase 32 ; canal ajouté à la main → Kevin prévient une fois", async () => {
    const { deps, calls, kit } = await kitWith([], {}, false);
    const p = await seedProspect(kit, { username: "pronos_fr", status: "ENRICHING" });
    await kit.prisma.setting.create({ data: { key: `prospection.watch.${p.id}`, value: { chatId: null, name: "@pronos_fr", at: "x" } } });
    // Sans file : lecture puis note enchaînées, puis Kevin prévient.
    await runProspectionJob(deps, { type: "prospection.enrich", prospectId: p.id });
    expect(calls.enrichProspect).toHaveLength(1);
    // L'Enrichisseur dit « score en file » : sans file réelle ici, rien d'autre.
    await runProspectionJob(deps, { type: "prospection.score", prospectId: p.id });
    expect(calls.scoreAndStore).toHaveLength(1);
    expect(kit.sent.at(-1)!.html).toMatch(/@pronos_fr.*74\/100|74\/100.*@pronos_fr/s);
    await runProspectionJob(deps, { type: "prospection.score", prospectId: p.id });
    expect(kit.sent.filter((s) => s.html.includes("74/100"))).toHaveLength(1);
    await runProspectionJob(deps, { type: "prospection.dossier", prospectId: p.id });
    expect(calls.buildDossier).toHaveLength(1);
    expect(await runProspectionJob(deps, { type: "prospection.requalify" })).toEqual({ skipped: "phase 32" });
  });
});

// ------------------------------------------------------------------------------------------------ Kevin

describe("catalogue de Kevin : prospection", () => {
  it("entrées uniques ; lectures permises à un membre, changements jamais", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of PROSPECTION_ACTIONS) {
      expect(keys).toContain(a.key);
      expect(bossActionAllowed(a, MEMBER), a.key).toBe((PROSPECTION_READ_ACTION_KEYS as readonly string[]).includes(a.key));
    }
  });

  it("phrases de la section 5 → bonne entrée et bonne réponse", async () => {
    const { kit, deps, calls, queued } = await kitWith([
      ["montre les prospects", call("prospects_top")],
      ["encore 10", call("prospects_top", { nombre: 10 })],
      ["prospects FR casino libres", call("prospects_filtre", { pays: "FR", verticale: "casino" })],
      ["les plus gros en Italie", call("prospects_filtre", { pays: "Italie", plus_gros: true })],
      ["détail @pronos_fr", call("prospect_detail", { canal: "@pronos_fr" })],
      ["j'ai contacté @pronos_fr", call("prospect_statut", { canal: "@pronos_fr", statut: "contacte" })],
      ["@pronos_fr a signé CPA 100", call("prospect_statut", { canal: "@pronos_fr" })],
      ["plus tard @pronos_fr", call("prospect_statut", { canal: "@pronos_fr", statut: "plus_tard" })],
      ["note @pronos_fr : veut des créatives mardi", call("prospect_note", { canal: "@pronos_fr", note: "veut des créatives mardi" })],
      ["ajoute t.me/nouveau_canal", call("prospect_ajout", { lien: "t.me/nouveau_canal" })],
      ["qui relancer ?", call("prospects_relances")],
      ["stats prospection", call("prospects_stats")],
      ["cherche des canaux casino en Pologne", call("prospection_cherche", { pays: "Pologne", verticale: "casino" })],
      ["ajoute une offre : Winamax, FR BE, CPA 120", call("prospection_offres", { action: "ajouter" })],
      ["mes offres", call("prospection_offres", { action: "voir" })],
      ["désactive l'offre Winamax", call("prospection_offres", { action: "desactiver", marque: "Winamax" })],
      ["pause la prospection", call("prospection_pause", { action: "pause" })],
      ["reprends la prospection", call("prospection_pause", { action: "reprise" })],
      ["export prospects", call("prospection_export")],
    ]);
    await seedProspect(kit, { username: "pronos_fr", vertical: "CASINO" });
    await seedProspect(kit, { username: "calcio_it", countries: ["IT"], medianViews: 9000, tier: "B", score: 55, competitiveState: "ROTATING" });
    await seedProspect(kit, { username: "bresil", countries: ["BR"], region: "NON_EU", medianViews: 90000 });
    const say = async (t: string) => (await bossAiTurn(deps, kit.input(t))).reply ?? "";

    expect(PROSPECTION_KEVIN_VARIANTS.topQueued).toContain(await say("montre les prospects"));
    await say("encore 10");
    expect(queued.filter((q) => q.job.type === "prospection.daily-top").map((q) => q.job)).toEqual([
      { type: "prospection.daily-top", requested: { chatId: ADMIN_ID, count: 10 } },
      { type: "prospection.daily-top", requested: { chatId: ADMIN_ID, count: 10 } },
    ]);
    const fr = await say("prospects FR casino libres");
    expect(fr).toContain("@pronos_fr");
    expect(fr).not.toContain("calcio_it");
    const it_ = await say("les plus gros en Italie");
    expect(it_).toContain("@calcio_it");
    expect(it_).not.toContain("bresil");
    const detail = await say("détail @pronos_fr");
    expect(detail).toContain("niveau A, 74/100");
    expect(detail).toContain("@admin_pub");

    expect(await say("j'ai contacté @pronos_fr")).toContain("@pronos_fr");
    expect(calls.transitionProspect!.at(-1)![1]).toBe("CONTACTED");
    await say("@pronos_fr a signé CPA 100");
    expect(calls.transitionProspect!.at(-1)!.slice(1)).toEqual(["SIGNED", { by: "client", dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" } }]);
    expect(await say("plus tard @pronos_fr")).toContain("7 jours");
    expect(calls.snoozeProspect!.at(-1)!.slice(1)).toEqual([7]);
    await say("note @pronos_fr : veut des créatives mardi");
    expect(calls.addProspectNote!.at(-1)!.slice(1)).toEqual(["veut des créatives mardi", "client"]);

    const add = await say("ajoute t.me/nouveau_canal");
    expect(add).toContain("@nouveau_canal");
    expect(calls.addManualProspect!.at(-1)).toEqual([{ url: "https://t.me/nouveau_canal" }, "client"]);
    expect(queued.at(-1)).toMatchObject({ job: { type: "prospection.enrich", prospectId: "p-new" }, opts: { priority: 1 } });
    expect(kit.tables("setting").some((s) => s.key === "prospection.watch.p-new")).toBe(true);

    expect(PROSPECTION_KEVIN_VARIANTS.relancesNone).toContain(await say("qui relancer ?"));
    const stats = await say("stats prospection");
    expect(stats).toContain("2 canaux à contacter (1 A, 1 B)");

    const search = await say("cherche des canaux casino en Pologne");
    expect(search).toContain("casino en Pologne");
    expect(calls.requestDiscovery!.at(-1)![0]).toMatchObject({ countries: ["PL"], vertical: "CASINO" });

    expect(await say("ajoute une offre : Winamax, FR BE, CPA 120")).toContain("Winamax");
    expect(kit.tables("affiliateOffer")[0]).toMatchObject({ brand: "Winamax", countries: ["FR", "BE"], dealTypes: { cpa: 120 }, isActive: true });
    expect(await say("mes offres")).toContain("CPA 120 €");
    expect(await say("désactive l'offre Winamax")).toContain("Winamax");
    expect(kit.tables("affiliateOffer")[0]!.isActive).toBe(false);

    expect(PROSPECTION_KEVIN_VARIANTS.paused).toContain(await say("pause la prospection"));
    expect(PROSPECTION_KEVIN_VARIANTS.resumed).toContain(await say("reprends la prospection"));
    expect(await say("export prospects")).toContain("/agents/prospection?export=csv");
  });

  it("blacklist : OUI de l'admin avant ; un membre ne change pas le pipeline", async () => {
    const { kit, deps, calls } = await kitWith([
      ["blacklist @pronos_fr", call("prospect_statut", { canal: "@pronos_fr", statut: "blacklist" })],
      ["j'ai contacté @pronos_fr", call("prospect_statut", { canal: "@pronos_fr", statut: "contacte" })],
    ]);
    await seedProspect(kit, { username: "pronos_fr" });
    const r = await bossAiTurn(deps, kit.input("blacklist @pronos_fr"));
    expect(r.pendingId).toBeTruthy();
    expect(calls.transitionProspect ?? []).toHaveLength(0);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 7n, firstName: "Zoé", role: "MEMBER" } as never });
    await bossAiTurn(deps, kit.input("j'ai contacté @pronos_fr", { speaker: MEMBER as never }));
    expect(calls.transitionProspect ?? []).toHaveLength(0);
  });

  it("question complexe sans IA : chiffres du code par pays", async () => {
    const { kit, deps } = await kitWith([["compare FR et IT en casino, lesquels d'abord ?", call("prospection_question", { question: "compare FR et IT en casino, lesquels d'abord ?" })]]);
    await seedProspect(kit, { username: "a_fr", vertical: "CASINO" });
    await seedProspect(kit, { username: "b_it", vertical: "CASINO", countries: ["IT"], tier: "B", score: 55 });
    const r = await bossAiTurn(deps, kit.input("compare FR et IT en casino, lesquels d'abord ?"));
    expect(r.reply).toContain("France (casino) : 1 à contacter, 1 A");
    expect(r.reply).toContain("Italie (casino) : 1 à contacter, 0 A, 1 B");
  });

  it("question complexe avec Opus : chiffre inventé → lignes du code ; réponse juste → QA Global puis envoi", async () => {
    const { kit, deps } = await kitWith();
    await seedProspect(kit, { username: "a_fr", vertical: "CASINO" });
    const { answerProspectionQuestion } = await import("./kevin-answer");
    deps.prospectionLlm = { complete: async () => ({ text: "Commence par la France : 999 canaux.", costCents: 3 }) };
    expect((await answerProspectionQuestion(deps, "compare FR et IT en casino")).checked).toBe("code");
    deps.prospectionLlm = { complete: async () => ({ text: "Commence par la France : 1 canal de niveau A avec un contact direct, l'Italie n'a rien encore.", costCents: 3 }) };
    const r = await answerProspectionQuestion(deps, "compare FR et IT en casino");
    expect(r).toMatchObject({ checked: "ia" });
    expect(kit.tables("qaCheck").length).toBeGreaterThan(0);
  });
});

describe("boutons et chemin rapide", () => {
  it("prospect:<id>:<action> → Pipeline pour l'admin ; un MEMBER a seulement un message au doigt", async () => {
    const { deps, calls, kit } = await kitWith();
    const r = await prospectButton(deps, { data: "prospect:p1:contacted", chatId: ADMIN_ID, fromTelegramId: ADMIN_ID });
    expect(r).toMatchObject({ handled: true, toast: "Noté" });
    expect(calls.handleProspectCallback![0]![0]).toEqual({ data: "prospect:p1:contacted", chatId: ADMIN_ID, actorTelegramId: ADMIN_ID });
    await kit.prisma.teamMember.create({ data: { telegramUserId: 7n, firstName: "Zoé", role: "MEMBER" } as never });
    const m = await prospectButton(deps, { data: "prospect:p1:contacted", chatId: "-100", fromTelegramId: 7n });
    expect(PROSPECTION_KEVIN_VARIANTS.buttonNotYours).toContain(m.toast);
    expect(calls.handleProspectCallback).toHaveLength(1);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 8n, firstName: "Max", role: "MANAGER" } as never });
    await prospectButton(deps, { data: "prospect:p1:no", chatId: "-100", fromTelegramId: 8n });
    expect(calls.handleProspectCallback).toHaveLength(2);
  });

  it("montant après « CPA » : `answerPendingDeal` avant l'IA ; « @nom » seul → fiche", async () => {
    const { deps, calls, kit } = await kitWith([], { answerPendingDeal: async (_d, _c, text) => (text === "100" ? "Signé avec @pronos_fr : CPA 100 €." : null) });
    void calls;
    const r = await bossFastPath(deps, kit.input("100"));
    expect(r).toMatchObject({ handled: true, reply: "Signé avec @pronos_fr : CPA 100 €." });
    await seedProspect(kit, { username: "pronos_fr" });
    const d = await bossFastPath(deps, kit.input("@pronos_fr"));
    expect(d.handled && "reply" in d && d.reply).toContain("74/100");
  });
});

describe("lectures pures", () => {
  it("noms, liens, statuts, deals, offres, filtres", () => {
    expect(usernameOf("https://t.me/s/Pronos_FR")).toBe("pronos_fr");
    expect(usernameOf("@calcio_it")).toBe("calcio_it");
    expect(channelRefIn("ajoute t.me/+AbCdEf123")).toMatchObject({ private: true });
    expect(channelRefIn("regarde t.me/joinchat/xyz")).toMatchObject({ private: true });
    expect(statusWordOf("@x a répondu")).toBe("repondu");
    expect(statusWordOf("on négocie avec @x")).toBe("negocie");
    expect(statusWordOf("@x a signé CPA 100")).toBe("signe");
    expect(statusWordOf("ignore @x")).toBe("ignore");
    expect(parseDeal("revshare 30 %")).toEqual({ dealType: "REVSHARE", cpa: null, revshare: 30 });
    expect(parseDeal("hybride 50 + 15 %")).toMatchObject({ dealType: "HYBRID", cpa: 50, revshare: 15 });
    expect(parseOfferText("ajoute une offre : Winamax, FR BE, CPA 120")).toEqual({ brand: "Winamax", countries: ["FR", "BE"], vertical: "BOTH", dealTypes: { cpa: 120 } });
    const f = filterFrom({}, "ceux qui vendent de la pub en Espagne");
    expect(f).toMatchObject({ countries: ["ES"], openness: ["ads"] });
    expect(filterFrom({}, "les A sans concurrent")).toMatchObject({ tiers: ["A"], competition: ["FREE"] });
    expect(filterFrom({}, "canaux crash/Aviator").subtypes).toEqual(["crash", "aviator"]);
  });
});

describe("ordres et annuaire des agents", () => {
  it("capacités : check (raisons et replis), plan sans écrire, run idempotent", async () => {
    const { deps, calls, kit, queued } = await kitWith();
    expect(isOrderableTeam("prospection")).toBe(true);
    const c = capability("prospection", "chercher_prospects")!;
    expect(c).not.toBeNull();
    const bad = await c.check(deps, { pays: ["Pologne"] });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? [] : bad.alternatives.map((a) => a.capability?.key)).toEqual(["chercher_prospects", "chercher_prospects"]);
    const p = c.parse({ pays: ["Pologne"], verticale: "casino" });
    expect(p.ok).toBe(true);
    const before = kit.tables("setting").length;
    const steps = await c.plan(deps, (p as unknown as { params: never }).params, { now: new Date(), mode: "simulation" });
    expect(kit.tables("setting").length).toBe(before);
    expect(steps[0]!.summary).toContain("casino en Pologne");
    const order = { id: "order1234567890", number: 1, teamKey: "prospection", kind: "PROGRAM", status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: ADMIN_ID, createdById: null, progress: {} } as never;
    expect((await c.run(deps, order, steps[0]!)).ok).toBe(true);
    await c.run(deps, order, steps[0]!);
    expect(calls.requestDiscovery).toHaveLength(1);
    for (const key of ["top_prospects", "pause_prospection", "offre_affilie"]) expect(capability("prospection", key)).not.toBeNull();
    const top = capability("prospection", "top_prospects")!;
    const ts = await top.plan(deps, {}, { now: new Date(), mode: "simulation" });
    await top.run(deps, order, ts[0]!);
    await top.run(deps, order, ts[0]!);
    expect(queued.filter((q) => q.job.type === "prospection.daily-top")).toHaveLength(1);
    const pause = capability("prospection", "pause_prospection")!;
    const ps = await pause.plan(deps, { action: "pause" }, { now: new Date(), mode: "simulation" });
    await pause.run(deps, order, ps[0]!);
    expect(kit.tables("setting").find((s) => s.key === "prospection.enabled")?.value).toBe(false);
    expect((await c.check(deps, { verticale: "casino" })).ok).toBe(false);
  });

  it("4 agents nommables, fiche « voir » en lecture seule, libellé de l'équipe", async () => {
    const { deps } = await kitWith();
    expect(orderTeamLabel("prospection")).toBe("Prospection");
    for (const [name, key] of [
      ["le sourceur", "sourceur"],
      ["l'enrichisseur", "enrichisseur"],
      ["celui qui note les canaux", "evaluateur"],
      ["le pipeline", "pipeline-prospection"],
      ["la prospection", "chef-prospection"],
    ] as const) {
      const r = findAgent(name);
      expect(r.status === "found" && r.agent.key, name).toBe(key);
    }
    const card = await agentCard(deps, "sourceur");
    expect(card.lines.join("\n")).toContain("Prochaine recherche");
    for (const l of card.lines) expect(voiceCheck(l).problems, l).toEqual([]);
  });
});

describe("voix de Kevin", () => {
  it("chaque texte fixe de la prospection passe voiceCheck", () => {
    const failures: string[] = [];
    for (const [key, entry] of Object.entries(PROSPECTION_KEVIN_VARIANTS as VoiceTable)) {
      const { texts, rules } = voiceEntryTexts(entry);
      for (const t of texts) {
        const r = voiceCheck(t, rules);
        if (!r.ok) failures.push(`${key} : ${r.problems.map((p) => p.code).join(", ")} « ${t} »`);
        // Espaces insécables à l'intérieur des guillemets français.
        if (/« | »/.test(t)) failures.push(`${key} : espace ordinaire dans « » : ${t}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
