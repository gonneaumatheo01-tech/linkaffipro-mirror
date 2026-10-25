/**
 * Phase 33, chantier A : registre des capacités, branches de `check`, `plan` sans écriture. Faux prisma, faux
 * fournisseur de cotes à liste de marchés, aucun réseau.
 */
import { describe, expect, it } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { createMarketListOddsProvider, MARKETS_WITH_OFFSIDES, MARKETS_WITHOUT_OFFSIDES } from "../testing/odds-markets";
import { ensureTeamConfigs } from "../missions/settings";
import { capabilitiesForAgent, capability, listCapabilities, registerCapabilities, isOrderableTeam } from "./registry";
import { clampMix, clampWindow, capParse, resolvePeriod } from "./capabilities/kit";
import { notesWith } from "./capabilities/redaction";
import type { CapabilityPlanContext } from "./contract";

const START = new Date("2026-10-24T08:00:00Z"); // 10 h à Paris

async function setup(markets: readonly string[] = MARKETS_WITH_OFFSIDES) {
  const kit = createEngineKit({ start: START, providers: { odds: createMarketListOddsProvider({ now: () => START, markets }) } });
  await ensureTeamConfigs(kit.prisma);
  const ch = kit.prisma._model("channel");
  ch.rows.push(
    { id: "foot", title: "Foot Pro", vertical: "SPORTS", isTest: false, isActive: true, telegramChatId: -1003n, createdAt: new Date(), language: "fr", type: "CHANNEL" },
    { id: "cas", title: "Roulette Pro", vertical: "CASINO", isTest: false, isActive: true, telegramChatId: -1004n, createdAt: new Date(), language: "fr", type: "CHANNEL" },
  );
  kit.prisma._model("persona").rows.push({ id: "p1", name: "Léa", isActive: true, universe: "dating", createdAt: new Date() });
  return kit;
}

const ctx = (): CapabilityPlanContext => ({ now: START, mode: "simulation", period: null });

/** Nombre de lignes par table (pour vérifier que `plan` n'écrit rien). */
function snapshot(kit: Awaited<ReturnType<typeof setup>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(kit.prisma._tables).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])));
}

async function checkOf(kit: Awaited<ReturnType<typeof setup>>, team: string, key: string, params: Record<string, unknown>) {
  const cap = capability(team, key)!;
  const parsed = cap.parse(params);
  if (!parsed.ok) throw new Error(parsed.error);
  return { cap, p: parsed.params, check: await cap.check(kit.deps, parsed.params) };
}

describe("registre des capacités", () => {
  it("toutes les capacités ont description, agents, schéma strict, parse, limits, check, plan, run, report", () => {
    const all = listCapabilities();
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const c of all) {
      expect(c.description.length, c.key).toBeGreaterThan(10);
      expect(Array.isArray(c.agents)).toBe(true);
      expect(c.params).toMatchObject({ type: "object", additionalProperties: false });
      expect(typeof c.parse).toBe("function");
      expect(c.limits.modes.length).toBeGreaterThan(0);
      for (const f of ["check", "plan", "run", "report"] as const) expect(typeof c[f], `${c.teamKey}.${c.key}.${f}`).toBe("function");
      // Paramètre inconnu refusé (schéma strict).
      expect(c.parse({ inconnu: 1 }).ok).toBe(false);
    }
  });

  it("capacités attendues par équipe", () => {
    const keys = listCapabilities().map((c) => `${c.teamKey}.${c.key}`);
    for (const k of [
      "sports.programmer_paris",
      "sports.pari_unique",
      "sports.changer_categorie",
      "sports.bilan",
      "sports.question",
      "dating.programmer_posts",
      "dating.post_unique",
      "dating.changer_plan",
      "dating.question",
      "casino.programmer_posts",
      "casino.post_unique",
      "casino.changer_plan",
      "casino.question",
      "algo.appliquer_reglage",
      "algo.annuler_reglage",
      "algo.lancer_test_ab",
      "algo.rapport",
      "algo.question",
      "ads.rapport",
      "ads.recommandations",
      "ads.seuils",
      "ads.question",
      "inspiration.analyser_canal",
      "inspiration.appliquer_inspiration",
      "inspiration.annuler_inspiration",
      "inspiration.question",
      "transverse.faire_comme_si",
      "transverse.pause_reprise",
      "transverse.mode",
      "transverse.consignes_canal",
      "transverse.mot_interdit_canal",
    ])
      expect(keys).toContain(k);
  });

  it("équipe absente → null ; une équipe future se branche par registerCapabilities", () => {
    expect(capability("montage", "programmer_shorts")).toBeNull();
    expect(isOrderableTeam("montage")).toBe(false);
    const fake = { ...capability("ads", "rapport")!, teamKey: "montage" as never, key: "programmer_shorts" };
    registerCapabilities([fake]);
    expect(capability("montage", "programmer_shorts")).not.toBeNull();
    expect(capabilitiesForAgent("redaction").some((c) => c.key === "consignes_canal")).toBe(true);
  });
});

describe("outils (règles pures)", () => {
  it("période : 30 jours au plus, jamais dans le passé, début par défaut", () => {
    expect(resolvePeriod({ jours: 45 }, { now: START, period: null })).toMatchObject({ start: "2026-10-24", days: 30, toDay: "2026-11-22" });
    expect(resolvePeriod({ jours: 3, debut: "2026-10-01" }, { now: START, period: null }).start).toBe("2026-10-24");
    expect(resolvePeriod({}, { now: new Date("2026-10-24T19:30:00Z"), period: null }).start).toBe("2026-10-25");
  });
  it("mélange : 20 points au plus ; fenêtre dans les heures autorisées", () => {
    const m = clampMix({ video: 1, photo: 0, text: 0 }, { video: 0, photo: 0, text: 1 }, 20);
    expect(m.mix.video).toBe(20);
    expect(m.note).toMatch(/20 points/);
    expect(clampWindow("06:00", "23:30", { start: "08:00", end: "23:00" })).toMatchObject({ start: "08:00", end: "23:00" });
  });
  it("listes de textes dans le schéma", () => {
    const r = capParse<{ canaux?: string[] }>({ canaux: { kind: "list", description: "x", optional: true } }, { canaux: "Test" });
    expect(r).toEqual({ ok: true, params: { canaux: ["Test"] } });
  });
  it("consignes du canal : ajout et retrait de la consigne de l'admin", () => {
    const a = notesWith("Légendes : questions", "écris plus court");
    expect(a).toContain("écris plus court");
    expect(notesWith(a, null)).toBe("Légendes : questions");
  });
});

describe("Paris sportifs : programmer_paris", () => {
  it("canal Test + hors-jeux chez le fournisseur → ok", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "sports", "programmer_paris", { test: true, jours: 3, theme: "hors-jeux" });
    expect(check).toEqual({ ok: true });
  });

  it("hors-jeux absent chez le fournisseur → raison précise + replis rejouables", async () => {
    const kit = await setup(MARKETS_WITHOUT_OFFSIDES);
    const { check } = await checkOf(kit, "sports", "programmer_paris", { test: true, jours: 3, theme: "hors-jeux" });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toMatch(/pas de marché « hors-jeux »/);
    expect(check.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(check.alternatives.length).toBeLessThanOrEqual(4);
    expect(check.alternatives[0]!.capability).toMatchObject({ teamKey: "sports", key: "programmer_paris" });
    expect(check.alternatives.map((a) => a.label).join(" ")).toMatch(/corners|cartons|tirs/);
  });

  it("thème inconnu → « je ne connais pas » + thèmes", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "sports", "programmer_paris", { test: true, theme: "pétanque" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Je ne connais pas/);
  });

  it("vrai canal d'un autre univers → refus + canal Test en repli", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "sports", "programmer_paris", { canaux: ["Roulette Pro"], theme: "corners" });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/garde son univers/);
      expect(check.alternatives.some((a) => a.capability?.params.test === true)).toBe(true);
    }
  });

  it("canal introuvable → raison + canaux de l'équipe", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "sports", "programmer_paris", { canaux: ["Inconnu Total"], theme: "corners" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.alternatives.map((a) => a.label).join(" ")).toContain("Foot Pro");
  });

  it("bookmaker non couvert → refus sans deviner de cote", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "sports", "programmer_paris", { test: true, theme: "corners", bookmaker: "celsius" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/ne couvre pas celsius/);
  });

  it("plan : rien d'écrit, quantité ramenée à la borne, dérogation datée sur le canal Test", async () => {
    const kit = await setup();
    const { cap, p } = await checkOf(kit, "sports", "programmer_paris", { test: true, jours: 45, theme: "hors-jeux", paris_par_jour: 50 });
    const before = snapshot(kit);
    const steps = await cap.plan(kit.deps, p, ctx());
    expect(snapshot(kit)).toBe(before);
    expect(steps).toHaveLength(1);
    const s = steps[0]!;
    expect(s.overrides).toEqual([expect.objectContaining({ channelId: "test", teamKey: "sports", fromDay: "2026-10-24", toDay: "2026-11-22", picksPerDay: 6, isTest: true, betCategoryId: null })]);
    expect(s.clamped!.join(" ")).toMatch(/50 paris par jour → 6/);
    expect(s.clamped!.join(" ")).toMatch(/45 jours → 30/);
    expect(s.params.newCategory).toMatchObject({ themeKey: "hors-jeux" });
  });
});

describe("Paris sportifs : autres capacités", () => {
  it("pari_unique : catégorie absente → replis ; présente → ok", async () => {
    const kit = await setup();
    const r1 = await checkOf(kit, "sports", "pari_unique", { theme: "corners" });
    expect(r1.check.ok).toBe(false);
    kit.prisma._model("betCategory").rows.push({ id: "c1", key: "corners", name: "Corners", marketTypes: ["corners-all-game-ou-over"], active: true, sortOrder: 1, createdAt: new Date(), leagues: [], bookmakers: [], channelIds: [], picksPerDay: 2, minOdds: 1.5, maxOdds: 3.5 });
    expect((await checkOf(kit, "sports", "pari_unique", { theme: "corners" })).check).toEqual({ ok: true });
  });
  it("changer_categorie : catégorie inconnue → liste ; plan ramené à la borne", async () => {
    const kit = await setup();
    kit.prisma._model("betCategory").rows.push({ id: "c1", key: "corners", name: "Corners", marketTypes: ["corners-all-game-ou-over"], active: false, sortOrder: 1, createdAt: new Date(), leagues: [], bookmakers: [], channelIds: [], picksPerDay: 2, minOdds: 1.5, maxOdds: 3.5 });
    expect((await checkOf(kit, "sports", "changer_categorie", { categorie: "Zzz" })).check.ok).toBe(false);
    const { cap, p } = await checkOf(kit, "sports", "changer_categorie", { categorie: "corners", paris_par_jour: 40 });
    const steps = await cap.plan(kit.deps, p, ctx());
    expect(steps[0]!.params.changes).toMatchObject({ picksPerDay: 6 });
  });
});

describe("Rencontres et Casino", () => {
  it("Rencontres : persona inexistante → raison + replis (autres personas, texte)", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "dating", "programmer_posts", { test: true, jours: 3, persona: "Zoé" });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/persona « Zoé »/);
      expect(check.alternatives.map((a) => a.label)).toEqual(expect.arrayContaining(["avec Léa"]));
    }
    expect((await checkOf(kit, "dating", "programmer_posts", { test: true, jours: 3, persona: "Léa" })).check).toEqual({ ok: true });
  });

  it("Rencontres : plan sans écriture, persona résolue, 50 posts → 6", async () => {
    const kit = await setup();
    const { cap, p } = await checkOf(kit, "dating", "programmer_posts", { canaux: ["Rencontres VIP"], jours: 2, posts_par_jour: 50, persona: "Léa" });
    const before = snapshot(kit);
    const steps = await cap.plan(kit.deps, p, ctx());
    expect(snapshot(kit)).toBe(before);
    // Pour de faux (mode de l'ordre) : dérogation de test, publiée sur le canal Test ; en vrai : dérogation réelle.
    expect(steps[0]!.overrides![0]).toMatchObject({ channelId: "real", postsPerDay: 6, personaId: "p1", isTest: true });
    expect(steps[0]!.touches).toMatchObject({ channelIds: ["real"], testOnly: false });
    const real = await cap.plan(kit.deps, { ...p, mode: "vrai" }, { ...ctx(), mode: "real" });
    expect(real[0]!.overrides![0]).toMatchObject({ isTest: false });
    expect(steps[0]!.clamped!.join(" ")).toMatch(/50 posts par jour → 6, le maximum du canal/);
    expect(steps[0]!.costCents).toBeGreaterThan(0);
  });

  it("Casino : stock insuffisant pour 7 jours → raison + replis (demande de médias, texte)", async () => {
    const kit = await setup();
    kit.prisma._model("mediaAsset").rows.push(
      { id: "v1", teamKey: "casino", origin: "HUMAN", mimeType: "video/mp4", theme: "roulette", tags: ["theme:roulette"], createdAt: new Date() },
      { id: "v2", teamKey: "casino", origin: "HUMAN", mimeType: "video/mp4", theme: "roulette", tags: ["theme:roulette"], createdAt: new Date() },
    );
    const { check } = await checkOf(kit, "casino", "programmer_posts", { canaux: ["Roulette Pro"], jours: 7, posts_par_jour: 5, themes: ["roulette"] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toMatch(/Pas assez de médias/);
    expect(check.alternatives.map((a) => a.capability?.key)).toEqual(expect.arrayContaining(["demander_medias", "programmer_posts"]));
    // Repli « moins de posts par jour » rejouable quand le stock couvre au moins 1 post par jour.
    for (let i = 0; i < 6; i++) kit.prisma._model("mediaAsset").rows.push({ id: `x${i}`, teamKey: "casino", origin: "HUMAN", mimeType: "image/jpeg", theme: "roulette", tags: [], createdAt: new Date() });
    const again = await checkOf(kit, "casino", "programmer_posts", { canaux: ["Roulette Pro"], jours: 7, posts_par_jour: 5, themes: ["roulette"] });
    expect(again.check.ok).toBe(false);
    if (!again.check.ok) expect(again.check.alternatives[0]!.capability?.params.posts_par_jour).toBe(1);
  });

  it("Casino : thème inconnu → thèmes de la médiathèque ; médias IA jamais (médias fournis seulement)", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "casino", "programmer_posts", { canaux: ["Roulette Pro"], themes: ["martingale"] });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/ne publie que tes médias/);
  });
});

describe("transverse", () => {
  it("faire_comme_si sur un vrai canal → refus + repli canal Test / créer un canal", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "transverse", "faire_comme_si", { equipe: "paris sportifs", canaux: ["Roulette Pro"], jours: 3, theme: "corners" });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toMatch(/vrai canal/);
    expect(check.alternatives[0]!.capability).toMatchObject({ key: "faire_comme_si", params: { test: true } });
    expect(check.alternatives.some((a) => /créer un canal/.test(a.label))).toBe(true);
  });

  it("faire_comme_si sur Test : étapes de l'équipe Paris, simulation forcée, rien d'écrit", async () => {
    const kit = await setup();
    const { cap, p, check } = await checkOf(kit, "transverse", "faire_comme_si", { equipe: "paris sportifs", test: true, jours: 3, theme: "hors-jeux", par_jour: 2 });
    expect(check).toEqual({ ok: true });
    const before = snapshot(kit);
    const steps = await cap.plan(kit.deps, p, ctx());
    expect(snapshot(kit)).toBe(before);
    expect(steps[0]).toMatchObject({ capability: "programmer_paris", teamKey: "sports" });
    expect(steps[0]!.overrides![0]).toMatchObject({ channelId: "test", teamKey: "sports", isTest: true, picksPerDay: 2, toDay: "2026-10-26" });
  });

  it("faire_comme_si : replis de l'équipe ramenés à « comme si »", async () => {
    const kit = await setup(MARKETS_WITHOUT_OFFSIDES);
    const { check } = await checkOf(kit, "transverse", "faire_comme_si", { equipe: "paris", test: true, jours: 3, theme: "hors-jeux" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.alternatives[0]!.capability).toMatchObject({ teamKey: "transverse", key: "faire_comme_si" });
  });

  it("mot interdit : liste de l'équipe du canal, plan sans écriture", async () => {
    const kit = await setup();
    const { cap, p, check } = await checkOf(kit, "transverse", "mot_interdit_canal", { mot: "gratuit", canal: "Rencontres VIP" });
    expect(check).toEqual({ ok: true });
    const steps = await cap.plan(kit.deps, p, ctx());
    // Seulement le mot : la liste est relue au moment d'écrire ; réglage de toute l'équipe (OUI, admin).
    expect(steps[0]!.params).toMatchObject({ team: "dating", word: "gratuit", remove: false });
    expect(steps[0]!.touches).toMatchObject({ teamWide: true, setting: true });
    expect((await checkOf(kit, "transverse", "mot_interdit_canal", { mot: "gratuit", canal: "Nulle Part" })).check.ok).toBe(false);
  });

  it("consignes canal : canal sans plan → repli « activer »", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "transverse", "consignes_canal", { canal: "Rencontres VIP", consigne: "écris plus court" });
    expect(check.ok).toBe(false);
  });

  it("algo : rien à appliquer → replis", async () => {
    const kit = await setup();
    const { check } = await checkOf(kit, "algo", "appliquer_reglage", {});
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.alternatives.length).toBeGreaterThanOrEqual(2);
  });
});

describe("question à l'équipe Paris : « pourquoi pas de pari hier ? » (intégration phase 33)", () => {
  it("les faits et les lignes donnent les chiffres d'hier (retenus, publiés), sans jargon", async () => {
    const kit = await setup();
    const y = new Date(START.getTime() - 20 * 3600_000); // hier, 14 h à Paris
    const picks = kit.prisma._model("bettingPick");
    picks.rows.push({ id: "b1", status: "PUBLISHED", createdAt: y, updatedAt: y }, { id: "b2", status: "SKIPPED", skipReason: "odds_moved", createdAt: y, updatedAt: y });
    const cap = capability("sports", "question")!;
    const order = { id: "o1", number: 1, teamKey: "sports", kind: "ASK" as const, status: "RUNNING", interpretation: {}, startsAt: null, endsAt: null, chatId: null, createdById: null, progress: {} };
    const [step] = await cap.plan(kit.deps, {}, { now: START, mode: "simulation" });
    const r = await cap.run(kit.deps, order, step!);
    expect(r.message).toContain("Hier : 2 paris retenus, 1 publié.");
    expect(r.message).not.toMatch(/mission/i);
    expect(await cap.report(kit.deps, order)).toMatchObject({ hier: { parisRetenus: 2, parisPublies: 1 } });
  });
});
