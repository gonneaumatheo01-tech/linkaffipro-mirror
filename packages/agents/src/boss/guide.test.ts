import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { bossSetupProgress, bossSetupStateLines, bossSetupSteps, bossStartReply, firstMissingBossStep, type BossGuideStep } from "./guide";

type Kit = ReturnType<typeof createTestKit>;
const secret = (key: string) => ({ key: `agents.secret.${key}`, value: { enc: "x", last4: "abcd", updatedAt: "2026-10-23T08:00:00Z" } });
const push = (kit: Kit, table: string, row: Record<string, unknown>) =>
  (kit.prisma as unknown as Record<string, { create(a: unknown): Promise<unknown> }>)[table]!.create({ data: row });

async function bossAndReport(kit: Kit) {
  await push(kit, "bot", { role: "ADMIN", isActive: true, username: "kevin_bot", mode: "STANDARD" });
  await push(kit, "setting", { key: "agents.dailyReport", value: true });
}

/** Tout ce qu'il faut pour que chaque étape obligatoire soit faite (sans canal casino). */
async function everything(kit: Kit) {
  await bossAndReport(kit);
  await push(kit, "setting", secret("providers.fal.apiKey"));
  await push(kit, "persona", {
    name: "Léa",
    isActive: true,
    identityKind: "GIRL",
    campaignId: null,
    affiliateCampaignId: null,
    loraUrl: "https://x/lea.safetensors",
    loraTrigger: "lea",
    referenceImageIds: ["m1"],
  });
  await push(kit, "agentTeamConfig", { teamKey: "dating", simulation: true, autonomyLevel: 0, monthlyBudgetCents: { image: 1_500 } });
  await push(kit, "channelAgentPlan", { teamKey: "dating", enabled: true, channelId: "c1" });
  await push(kit, "setting", secret("providers.odds.apiKey"));
  await push(kit, "betCategory", { name: "Tirs cadrés", active: true, updatedById: "u1", sortOrder: 0 });
  await push(kit, "agentTeamConfig", { teamKey: "algo", simulation: true, autonomyLevel: 1, monthlyBudgetCents: {} });
  await push(kit, "setting", { key: "agents.ads.thresholds", value: {} });
  await push(kit, "adAccountConnection", { status: "ACTIVE" });
}

const keys = (steps: BossGuideStep[]) => steps.map((s) => s.key);

describe("Kevin : étapes de mise en route calculées depuis les données", () => {
  it("base vide : l'ordre de A-FAIRE-HUMAIN, rien de fait, le passage en vrai est facultatif", async () => {
    const kit = createTestKit();
    const steps = await bossSetupSteps(kit.deps);
    expect(keys(steps)).toEqual([
      "boss",
      "dailyReport",
      "dating.falKey",
      "dating.persona",
      "dating.plan",
      "sports.oddsKey",
      "sports.categories",
      "algo.level",
      "ads.thresholds",
      "ads.spend",
      "real",
    ]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps.find((s) => s.key === "real")?.optional).toBe(true);
    expect(bossSetupProgress(steps).label).toBe("0/10");
    expect(firstMissingBossStep(steps)?.key).toBe("boss");
    expect(steps[0]!.howTo).toContain("@BotFather");
    expect(steps[0]!.howTo).toContain("« Kevin »");
  });

  it("une persona Rencontres et un canal casino : une étape par persona, deux étapes casino, 3/12", async () => {
    const kit = createTestKit();
    await bossAndReport(kit);
    await push(kit, "setting", secret("providers.fal.apiKey"));
    await push(kit, "persona", { name: "Léa", isActive: true, identityKind: "GIRL", campaignId: null, affiliateCampaignId: null, loraUrl: null, loraTrigger: null, referenceImageIds: [] });
    await push(kit, "channel", { title: "La Zone Roulette", vertical: "CASINO", isActive: true, isTest: false });
    const steps = await bossSetupSteps(kit.deps);
    expect(keys(steps)).toContain("casino.videos");
    expect(keys(steps)).toContain("casino.plan");
    expect(keys(steps)).not.toContain("dating.persona");
    const persona = steps.find((s) => s.key.startsWith("persona."))!;
    expect(persona.label).toBe("les médias de Léa");
    expect(persona.asks?.map((a) => a.key.split(".").pop())).toEqual(["loraUrl", "loraTrigger", "referenceImages"]);
    expect(bossSetupProgress(steps).label).toBe("3/12");
    expect(firstMissingBossStep(steps)?.key).toBe(persona.key);
  });

  it("catégories : la catégorie active d'office ne suffit pas, il faut un choix", async () => {
    const kit = createTestKit();
    await push(kit, "betCategory", { name: "Tirs cadrés", active: true, updatedById: null, sortOrder: 0 });
    expect((await bossSetupSteps(kit.deps)).find((s) => s.key === "sports.categories")!.done).toBe(false);
    await push(kit, "humanRequest", { key: "sports.categories", kind: "TEXT", status: "ANSWERED", question: "?" });
    expect((await bossSetupSteps(kit.deps)).find((s) => s.key === "sports.categories")!.done).toBe(true);
  });

  it("lignes d'état : simulation, niveaux, ce qui manque par équipe", () => {
    const steps = [
      { key: "a", label: "", why: "", done: false, team: "dating", short: "clé" },
      { key: "b", label: "", why: "", done: false, team: "dating", short: "médias" },
      { key: "c", label: "", why: "", done: true, team: "casino", short: "vidéos" },
      { key: "d", label: "", why: "", done: false, team: "sports", short: "bookmaker" },
      { key: "e", label: "", why: "", done: false, team: null, short: "vrai", optional: true },
    ] as BossGuideStep[];
    const [l1, l2, l3] = bossSetupStateLines([{ teamKey: "casino", simulation: false, autonomyLevel: 1 }], steps);
    expect(l1).toBe("En vrai : Casino. Encore en test : Rencontres, Paris sportifs.");
    expect(l2).toBe("Niveaux : Rencontres 0 · Casino 1 · Paris sportifs 0 · Algorithme 0.");
    expect(l3).toBe("Il manque : Rencontres (clé, médias) · Paris sportifs (bookmaker).");
    expect(bossSetupStateLines([], [], true)[0]).toBe("Tout est en pause générale. Tout est encore en test : tout part sur le canal Test.");
  });
});

describe("Kevin : « commencer »", () => {
  it("première chose manquante : état, avancement, puis LA question, posée après la réponse", async () => {
    const kit = createTestKit();
    await bossAndReport(kit);
    const r = await bossStartReply(kit.deps);
    expect(r.reply).toContain("Tout est encore en test");
    expect(r.reply).toMatch(/2\/10/);
    expect(r.reply).toMatch(/(On commence par|On s'attaque à) la clé fal\.ai \?/);
    expect(kit.sent).toHaveLength(0);
    await r.followUp!();
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("https://fal.ai");
    const req = kit.tables("humanRequest");
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ key: "providers.fal.apiKey", kind: "SECRET", status: "PENDING" });
    expect(r.reply!.split("\n").length).toBeLessThanOrEqual(7);
  });

  it("question déjà posée : jamais doublée, rappelée dans la réponse", async () => {
    const kit = createTestKit();
    await bossAndReport(kit);
    await (await bossStartReply(kit.deps)).followUp!();
    const again = await bossStartReply(kit.deps);
    expect(again.followUp).toBeUndefined();
    expect(again.reply).toMatch(/Je te l'ai déjà demandé|Je t'ai déjà posé la question/);
    expect(again.reply).toContain("https://fal.ai");
    expect(kit.tables("humanRequest")).toHaveLength(1);
  });

  it("une autre question en cours : elle d'abord, la nouvelle attend dans la file", async () => {
    const kit = createTestKit();
    await bossAndReport(kit);
    await push(kit, "humanRequest", { key: "autre", kind: "TEXT", status: "PENDING", question: "Quel est le nom ?", askedAt: new Date("2026-10-23T07:00:00Z") });
    const r = await bossStartReply(kit.deps);
    expect(r.reply).toMatch(/D'abord, la question en cours|Finissons d'abord celle-ci/);
    expect(r.reply).toContain("Quel est le nom ?");
    await r.followUp!();
    expect(kit.sent).toHaveLength(0);
    expect(kit.tables("humanRequest").find((x) => x.key === "providers.fal.apiKey")?.status).toBe("QUEUED");
  });

  it("pas encore de Kevin : les clics exacts, et en attendant la prochaine question par Telegram", async () => {
    const kit = createTestKit();
    const r = await bossStartReply(kit.deps);
    expect(r.reply).toMatch(/(On commence par|On s'attaque à) créer Kevin, ton bot \?/);
    expect(r.reply).toContain("@BotFather → /newbot");
    expect(r.reply).toMatch(/(En attendant, on peut régler|Pendant ce temps, voyons) le rapport du matin\./);
    await r.followUp!();
    expect(kit.tables("humanRequest")[0]).toMatchObject({ key: "agents.dailyReport", kind: "CONFIRM" });
  });

  it("« plus tard » depuis moins de 24 h : l'étape suivante passe devant", async () => {
    const kit = createTestKit();
    await bossAndReport(kit);
    await push(kit, "humanRequest", { key: "providers.fal.apiKey", kind: "SECRET", status: "SKIPPED", question: "?", answeredAt: new Date("2026-10-23T07:30:00Z") });
    const r = await bossStartReply(kit.deps);
    expect(r.reply).toMatch(/(On commence par|On s'attaque à) une persona Rencontres \?/);
    expect(r.reply).toContain("Conversations → Personas");
    expect(r.reply).toMatch(/(En attendant, on peut régler|Pendant ce temps, voyons) la clé des cotes\./);
  });

  it("tout est fait : « Tout est prêt 👍 » et la suite (passer une équipe en vrai)", async () => {
    const kit = createTestKit();
    await everything(kit);
    const steps = await bossSetupSteps(kit.deps);
    expect(steps.filter((s) => !s.done).map((s) => s.key)).toEqual(["real"]);
    const r = await bossStartReply(kit.deps);
    expect(r.reply).toMatch(/\(10\/10\) ✅/);
    expect(r.reply).toContain("passe le casino en vrai");
    expect(r.followUp).toBeUndefined();
  });
});
