/**
 * Phase 32, chantier C — Kevin pour la prospection avancée : phrases du catalogue → bonne entrée, droits (membre,
 * responsable, admin), recherche par compte réel (OUI obligatoire, proposée une fois, coupée d'un mot), boutons
 * `pra:`, chemin rapide (« @x = affilié 1234 »), capacités des ordres et annuaire des agents, voix. Base en mémoire,
 * faux chantiers A / B (ports), fausse IA, aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bossAiTurn } from "../boss/execute";
import { bossFastPath } from "../boss/fast";
import { BOSS_CATALOG, bossActionAllowed } from "../boss/catalog";
import { PROSPECTION_ADVANCED_ACTIONS, PROSPECTION_ADVANCED_ADMIN_ACTION_KEYS, PROSPECTION_ADVANCED_READ_ACTION_KEYS } from "../boss/catalog-prospection-advanced";
import { createBossKit } from "../boss/testing";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../boss/voice";
import { capability } from "../orders/registry";
import { agentCard, findAgent } from "../orders/agents-dict";
import { ACCOUNT_SEARCH } from "./contract-advanced";
import type { ProspectionAdvancedPort } from "./advanced-port";
import { alertKindsOf, offerAccountSearchOnce, parseAffiliateLink, parseChoices, prospectAlertButton } from "./kevin-advanced";
import type { ProspectionAdvancedKevinDeps, ProspectionAdvancedKevinPort } from "./kevin-advanced-port";
import { PROSPECTION_ADVANCED_KEVIN_VARIANTS as A } from "./kevin-advanced-texts";
import { PROSPECTION_KEVIN_VARIANTS } from "./kevin-texts";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });
const MEMBER = { kind: "member", telegramUserId: 7n, memberId: "m", role: "MEMBER", firstName: "Zoé" } as const;
const MANAGER = { kind: "member", telegramUserId: 8n, memberId: "m2", role: "MANAGER", firstName: "Max" } as const;
const ADMIN_ID = "4242";

async function kitWith(table: Parameters<typeof createBossKit>[0] = []) {
  const kit = await createBossKit(table);
  const deps = kit.deps as unknown as ProspectionAdvancedKevinDeps;
  deps.prospectionLlm = null;
  const calls: Record<string, unknown[][]> = {};
  const rec =
    <T>(name: string, out: T) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args.slice(1));
      return out;
    };
  deps.prospectionAdvanced = {
    handleAlertCallback: rec("handleAlertCallback", { handled: true, toast: "Vu" }) as never,
    mergeProspects: rec("mergeProspects", { ok: true, networkId: "n1" }) as never,
    splitProspect: rec("splitProspect", { ok: true }) as never,
    linkAffiliate: rec("linkAffiliate", { ok: true, message: null }) as never,
    estimateProspectValue: rec("estimateProspectValue", null) as never,
  } satisfies Partial<ProspectionAdvancedPort>;
  const kport: Partial<ProspectionAdvancedKevinPort> = {
    listAlerts: async (_d, o) =>
      [
        { id: "a1", prospectId: "p?", kind: "AFFILIATE_DROPPED", family: "opportunity", strength: 80, data: { brand: "1xBet", days: 21 }, evidence: null, status: "SENT", createdAt: new Date("2026-10-27T08:10:00Z"), sentAt: new Date("2026-10-27T08:10:00Z") },
        { id: "a2", prospectId: "p?", kind: "GROWTH_SPIKE", family: "opportunity", strength: 70, data: { before: 4000, after: 9000 }, evidence: null, status: "SENT", createdAt: new Date("2026-10-27T08:10:00Z"), sentAt: new Date("2026-10-27T08:09:00Z") },
      ].filter((a) => !o.kinds?.length || o.kinds.includes(a.kind)),
    muteAlertKind: rec("muteAlertKind", { ok: true }) as never,
    unmuteAlertKind: rec("unmuteAlertKind", { ok: true }) as never,
    pipelineValue: async () => ({ byStatus: [{ status: "NEGOTIATING", count: 2, low: 2100, base: 5000, high: 11000 }], total: { count: 2, low: 2100, base: 5000, high: 11000 }, calibrated: false }),
    listCalibrationChoices: async () => [
      { n: 1, text: "Taux de clic paris FR : 1,5 % → 2 %" },
      { n: 2, text: "Poids de l'ouverture : 15 → 18" },
      { n: 3, text: "Recherche web : 30 % → 35 %" },
    ],
    applyCalibration: rec("applyCalibration", { ok: true }) as never,
    undoCalibration: rec("undoCalibration", { ok: true }) as never,
  };
  deps.prospectionAdvancedKevin = kport;
  let now = new Date("2026-10-27T09:30:00Z");
  deps.now = () => now;
  return { kit, deps, calls, setNow: (iso: string) => (now = new Date(iso)) };
}

async function seed(kit: Awaited<ReturnType<typeof createBossKit>>, data: Record<string, unknown>) {
  return (await kit.prisma.prospect.create({
    data: { channelUrl: `https://t.me/${data.username}`, title: "Canal", kind: "CHANNEL", vertical: "SPORTS", region: "EU", countries: ["FR"], status: "QUALIFIED", sourceType: "DIRECTORY", priority: 0, medianViews: 2100, ...data } as never,
  })) as { id: string };
}

beforeEach(() => resetVoiceRotation());

describe("catalogue de Kevin : prospection avancée", () => {
  it("entrées uniques ; lectures aux membres ; calibrage et compte réel à l'admin ; le reste aux responsables", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of PROSPECTION_ADVANCED_ACTIONS) {
      expect(keys).toContain(a.key);
      const read = (PROSPECTION_ADVANCED_READ_ACTION_KEYS as readonly string[]).includes(a.key);
      const adminOnly = (PROSPECTION_ADVANCED_ADMIN_ACTION_KEYS as readonly string[]).includes(a.key);
      expect(bossActionAllowed(a, MEMBER), a.key).toBe(read);
      expect(bossActionAllowed(a, MANAGER), a.key).toBe(!adminOnly);
      expect(bossActionAllowed(a, null), a.key).toBe(true);
    }
    expect(bossActionAllowed(PROSPECTION_ADVANCED_ACTIONS.find((a) => a.key === "prospection_recherche_compte")!, MANAGER, { cls: "confirm" })).toBe(false);
  });

  it("phrases de la section 6 → bonne entrée et bonne réponse", async () => {
    const { kit, deps, calls } = await kitWith([
      ["qui a lâché son bookmaker ?", call("prospection_alertes", { filtre: "lache" })],
      ["canaux en hausse", call("prospection_alertes", { filtre: "hausse" })],
      ["alertes du jour", call("prospection_alertes", { filtre: "jour" })],
      ["plus d'alertes de ce type", call("prospection_alertes_couper", {})],
      ["réseau de @pronos_fr", call("prospection_reseau", { canal: "@pronos_fr" })],
      ["@pronos_fr et @pronos_be c'est la même personne", call("prospection_fusion", { canaux: "@pronos_fr et @pronos_be" })],
      ["sépare @pronos_be", call("prospection_separer", { canal: "@pronos_be" })],
      ["combien vaut @pronos_fr ?", call("prospection_valeur", { canal: "@pronos_fr" })],
      ["valeur du pipeline", call("prospection_valeur_pipeline")],
      ["mes affiliés", call("prospection_affilies")],
      ["performance de @signe_fr", call("prospection_performance", { canal: "@signe_fr" })],
      ["@signe_fr = affilié 1234", call("prospection_rattacher", { canal: "@signe_fr", affilie: "1234" })],
      ["estimé vs réel", call("prospection_estime_reel")],
      ["calibrage", call("prospection_calibrage")],
      ["applique 1 et 3", call("prospection_calibrage_appliquer", { choix: "1 et 3" })],
      ["annule le calibrage", call("prospection_calibrage_annuler")],
      ["coupe la recherche par compte", call("prospection_recherche_compte", { action: "couper" })],
    ]);
    const fr = await seed(kit, { username: "pronos_fr" });
    const be = await seed(kit, { username: "pronos_be" });
    const signed = await seed(kit, { username: "signe_fr", status: "SIGNED" });
    void be;
    const say = async (t: string) => (await bossAiTurn(deps, kit.input(t))).reply ?? "";

    expect(await say("qui a lâché son bookmaker ?")).toMatch(/a lâché sa marque, 1xBet, depuis 21 jours/);
    const up = await say("canaux en hausse");
    expect(up).toMatch(/forte hausse.*4k → 9k/);
    expect(up).not.toContain("1xBet");
    expect(await say("alertes du jour")).toContain("2 alertes du jour");
    await say("plus d'alertes de ce type");
    expect(calls.muteAlertKind![0]).toEqual(["AFFILIATE_DROPPED", "client"]);
    expect(A.networkNone({ name: "@pronos_fr" })).toContain(await say("réseau de @pronos_fr"));
    await say("@pronos_fr et @pronos_be c'est la même personne");
    expect((calls.mergeProspects![0]![0] as string[]).length).toBe(2);
    await say("sépare @pronos_be");
    expect(calls.splitProspect).toHaveLength(1);
    expect(A.valueNone({ name: "@pronos_fr" })).toContain(await say("combien vaut @pronos_fr ?"));
    const pipe = await say("valeur du pipeline");
    expect(pipe).toMatch(/2.100 – 11.000 €\/mois/);
    expect(pipe).toMatch(/non calibrée/);
    expect(await say("mes affiliés")).toMatch(/@signe_fr \(signé, pas rattaché\)/);
    expect(A.notLinked({ name: "@signe_fr" })).toContain(await say("performance de @signe_fr"));
    await say("@signe_fr = affilié 1234");
    expect(calls.linkAffiliate![0]).toEqual([signed.id, "1234", "client"]);
    expect(A.evrNone).toContain(await say("estimé vs réel"));
    expect(await say("calibrage")).toContain("1. Taux de clic paris FR");
    await say("applique 1 et 3");
    expect(calls.applyCalibration![0]).toEqual([[1, 3], "client"]);
    expect(A.calibrationUndone).toContain(await say("annule le calibrage"));
    expect(A.accountAlreadyOff).toContain(await say("coupe la recherche par compte"));
    void fr;
  });
});

describe("recherche par compte réel : activation par OUI seulement", () => {
  it("« active la recherche par compte » → récapitulatif et OUI ; sans OUI rien ne change ; « coupe » la coupe", async () => {
    const { kit, deps } = await kitWith([
      ["active la recherche par compte", call("prospection_recherche_compte", { action: "activer" })],
      ["coupe la recherche par compte", call("prospection_recherche_compte", { action: "couper" })],
    ]);
    const enabled = async () => (await kit.prisma.setting.findUnique({ where: { key: ACCOUNT_SEARCH.enabled.key } }))?.value ?? false;
    const r = await bossAiTurn(deps, kit.input("active la recherche par compte"));
    expect(r.pendingId).toBeTruthy();
    expect(r.reply).toMatch(/lecture seule/);
    expect(await enabled()).toBe(false);
    const yes = await bossFastPath(deps, kit.input("OUI"));
    expect(yes.handled).toBe(true);
    expect(await enabled()).toBe(true);
    expect(A.accountDisabled).toContain((await bossAiTurn(deps, kit.input("coupe la recherche par compte"))).reply);
    expect(await enabled()).toBe(false);
  });

  it("un membre ou un responsable ne l'active jamais lui-même", async () => {
    const { kit, deps } = await kitWith([["active la recherche par compte", call("prospection_recherche_compte", { action: "activer" })]]);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 8n, firstName: "Max", role: "MANAGER" } as never });
    await bossAiTurn(deps, kit.input("active la recherche par compte", { speaker: MANAGER as never }));
    expect((await kit.prisma.setting.findUnique({ where: { key: ACCOUNT_SEARCH.enabled.key } }))?.value ?? false).toBe(false);
  });

  it("proposée une seule fois, avec le texte du prompt et OUI / NON", async () => {
    const { kit, deps } = await kitWith();
    expect(await offerAccountSearchOnce(deps)).toBe(true);
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("sans rien rejoindre ni écrire");
    expect(kit.sent[0]!.buttons?.[0]?.map((b) => b.text)).toEqual(["✅ OUI", "❌ NON"]);
    expect(await offerAccountSearchOnce(deps)).toBe(false);
    expect(kit.sent).toHaveLength(1);
    await bossFastPath(deps, kit.input("OUI"));
    expect((await kit.prisma.setting.findUnique({ where: { key: ACCOUNT_SEARCH.enabled.key } }))?.value).toBe(true);
  });
});

describe("boutons `pra:` et chemin rapide", () => {
  it("bouton d'alerte → Veilleur pour l'admin et un responsable ; un membre a seulement un message au doigt", async () => {
    const { kit, deps, calls } = await kitWith();
    const r = await prospectAlertButton(deps, { data: "pra:a1:seen", chatId: ADMIN_ID, fromTelegramId: ADMIN_ID });
    expect(r).toMatchObject({ handled: true, toast: "Vu" });
    expect(calls.handleAlertCallback![0]![0]).toEqual({ data: "pra:a1:seen", chatId: ADMIN_ID, actorTelegramId: ADMIN_ID });
    await kit.prisma.teamMember.create({ data: { telegramUserId: 7n, firstName: "Zoé", role: "MEMBER" } as never });
    const m = await prospectAlertButton(deps, { data: "pra:a1:mute", chatId: "-100", fromTelegramId: 7n });
    expect(PROSPECTION_KEVIN_VARIANTS.buttonNotYours).toContain(m.toast);
    expect(calls.handleAlertCallback).toHaveLength(1);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 8n, firstName: "Max", role: "MANAGER" } as never });
    await prospectAlertButton(deps, { data: "pra:a1:note", chatId: "-100", fromTelegramId: 8n });
    expect(calls.handleAlertCallback).toHaveLength(2);
  });

  it("le Veilleur en échec : jamais d'exception, un petit message", async () => {
    const { deps } = await kitWith();
    deps.prospectionAdvanced = { handleAlertCallback: vi.fn(async () => Promise.reject(new Error("boom"))) };
    expect(await prospectAlertButton(deps, { data: "pra:a1:seen", chatId: ADMIN_ID, fromTelegramId: ADMIN_ID })).toMatchObject({ handled: true, toast: expect.any(String) });
  });

  it("« @x = affilié 1234 » par le chemin rapide (sans IA) ; un membre ne rattache rien", async () => {
    const { kit, deps, calls } = await kitWith();
    const p = await seed(kit, { username: "signe_fr", status: "SIGNED" });
    const r = await bossFastPath(deps, kit.input("@signe_fr = affilié 1234"));
    expect(r.handled).toBe(true);
    expect(calls.linkAffiliate![0]).toEqual([p.id, "1234", "client"]);
    await bossFastPath(deps, kit.input("@signe_fr = affilié 999", { speaker: MEMBER as never }));
    expect(calls.linkAffiliate).toHaveLength(1);
  });
});

describe("ordres et annuaire", () => {
  it("capacités enregistrées ; activer la recherche par compte touche toute l'équipe (OUI), couper non", async () => {
    const rc = capability("prospection", "recherche_compte_prospection")!;
    expect(rc).toBeTruthy();
    const ctx = { now: new Date(), mode: "simulation" as const };
    expect((await rc.plan({} as never, { action: "activer" }, ctx))[0]!.touches).toMatchObject({ teamWide: true, setting: true });
    expect((await rc.plan({} as never, { action: "couper" }, ctx))[0]!.touches?.teamWide).toBeUndefined();
    for (const k of ["alertes_prospection", "reseau_prospect", "valeur_prospection", "affilies_prospection", "calibrage_prospection", "recalculer_reseaux"]) expect(capability("prospection", k), k).toBeTruthy();
  });

  it("Veilleur et Valorisateur nommables, avec leur fiche ; 6 agents dans l'équipe", async () => {
    const { deps } = await kitWith();
    expect(findAgent("le veilleur")).toMatchObject({ kind: "found", agent: { key: "veilleur" } });
    expect(findAgent("valorisateur")).toMatchObject({ kind: "found", agent: { key: "valorisateur" } });
    const card = await agentCard(deps, "veilleur");
    expect(card?.lines.join("\n")).toMatch(/Prochain message d'alertes/);
    const { AGENT_DIRECTORY } = await import("../orders/agents-dict");
    expect(AGENT_DIRECTORY.filter((a) => a.teams.includes("prospection") && a.kind === "agent")).toHaveLength(6);
  });
});

describe("lectures pures et voix", () => {
  it("types d'alerte, choix numérotés, rattachement", () => {
    expect(alertKindsOf("plus d'alertes de hausse")).toEqual(["GROWTH_SPIKE"]);
    expect(alertKindsOf("ceux qui ont lâché leur bookmaker")).toEqual(["AFFILIATE_DROPPED"]);
    expect(alertKindsOf("de ce type")).toEqual([]);
    expect(parseChoices("applique 1 et 3", 3)).toEqual([1, 3]);
    expect(parseChoices("tout", 2)).toEqual([1, 2]);
    expect(parseChoices("applique 9", 3)).toEqual([]);
    expect(parseAffiliateLink("@Pronos_FR = affilié 1234")).toEqual({ username: "pronos_fr", affiliateId: "1234" });
    expect(parseAffiliateLink("@pronos_fr est l'affilié n° 77")).toEqual({ username: "pronos_fr", affiliateId: "77" });
    expect(parseAffiliateLink("@pronos_fr a signé")).toBeNull();
  });

  it("chaque variante passe voiceCheck ; aucune estimation présentée comme une certitude", () => {
    const failures: string[] = [];
    for (const [key, entry] of Object.entries(A as VoiceTable)) {
      const { texts, rules } = voiceEntryTexts(entry);
      for (const t of texts) {
        const r = voiceCheck(t, rules);
        if (!r.ok) failures.push(`${key} : ${r.problems.map((p) => p.code).join(", ")} « ${t} »`);
        if (/rapportera/i.test(t)) failures.push(`${key} : « rapportera »`);
      }
    }
    expect(failures).toEqual([]);
    expect(A.accountOffer[0]).toBe(
      "Je peux chercher des canaux directement dans Telegram avec un compte réel, en lecture seule, sans rien rejoindre ni écrire. Ça trouve des canaux absents des annuaires. Tu confirmes ?",
    );
  });
});
