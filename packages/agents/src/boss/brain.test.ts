import { describe, expect, it, vi } from "vitest";
import { createBossKit } from "./testing";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import { recentBossTurns, writeBossTurn, memoryText } from "./memory";
import { answerQuestion, checkedAnswer } from "./answer";
import { bossBudgetState, bossLlmFromClient, loadBossLlm, recordBossUsage } from "./llm";
import { bossAiTurn, nearestActions, NO_AI_REPLIES } from "./execute";
import { ORDER_INTERNAL_KEYS } from "./catalog-orders";
import { editDistance, matchNames, resolveBookmaker, teamOf, checkQuota, checkCap, checkLevel } from "./resolve";
import type { AiClient } from "@linkaffipro/ai";

vi.mock("../missions/lifecycle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  continueMission: vi.fn(async () => undefined),
}));

describe("catalogue fermé", () => {
  it("chaque entrée a clé unique, description d'une ligne, thème, schéma strict, classe, parse, execute", () => {
    const keys = new Set<string>();
    for (const a of BOSS_CATALOG) {
      expect(keys.has(a.key), a.key).toBe(false);
      keys.add(a.key);
      // Phase 33 : entrées internes des ordres (OUI, numéros) sans description, jamais montrées à l'IA ni dans l'aide.
      if (ORDER_INTERNAL_KEYS.has(a.key)) continue;
      expect(a.description.length, a.key).toBeGreaterThan(10);
      expect(a.description, a.key).not.toContain("\n");
      expect(a.theme, a.key).toBeTruthy();
      expect(["immediate", "confirm"], a.key).toContain(a.cls);
      expect(a.params, a.key).toMatchObject({ type: "object", additionalProperties: false });
      expect(typeof a.parse, a.key).toBe("function");
      expect(typeof a.execute, a.key).toBe("function");
      if (a.cls === "confirm") expect(typeof a.summarize, a.key).toBe("function");
    }
    for (const k of ["etat_general", "etat_equipe", "etat_canal", "rapport_du_jour", "depenses_du_mois", "resultats", "demandes_ouvertes", "repondre_demande", "plus_tard", "valider_post", "refuser_post", "corriger_post", "pause", "reprise", "niveau", "simulation", "plafond", "quota_posts", "plan_canal", "persona_canal", "personas", "stock_medias", "banc_essai", "themes_casino", "offre_canal", "categories_paris", "categorie_paris", "test_bookmaker", "connexion_bookmaker", "mode_capture", "paris_du_jour", "bilan_paris", "reglages_semaine", "appliquer_reglage", "annuler_reglage", "tests_en_cours", "recommandations_ads", "ads_fait", "ads_refuser", "seuils_ads", "post_test", "pari_test", "aide", "commencer", "annule"])
      expect(keys.has(k), k).toBe(true);
  });

  it("classes selon les paramètres : baisse immédiate, hausse à confirmer", async () => {
    const kit = await createBossKit();
    const by = (k: string) => BOSS_CATALOG.find((a) => a.key === k)!;
    expect(await by("niveau").classify!(kit.deps, { equipe: "casino", niveau: 0 })).toBe("immediate");
    expect(await by("niveau").classify!(kit.deps, { equipe: "casino", niveau: 2 })).toBe("confirm");
    expect(await by("simulation").classify!(kit.deps, { equipe: "casino", mode: "simulation" })).toBe("immediate");
    expect(await by("simulation").classify!(kit.deps, { equipe: "casino", mode: "vrai" })).toBe("confirm");
    expect(await by("quota_posts").classify!(kit.deps, { cible: "Léa", posts_par_jour: 1 })).toBe("immediate");
    expect(await by("quota_posts").classify!(kit.deps, { cible: "Léa", posts_par_jour: 4 })).toBe("confirm");
    expect(await by("plan_canal").classify!(kit.deps, { canal: "emma", actif: true })).toBe("confirm");
    expect(await by("categorie_paris").classify!(kit.deps, { categorie: "corners", active: false })).toBe("immediate");
    await kit.prisma.agentTeamConfig.upsert({ where: { teamKey: "dating" }, create: { teamKey: "dating", monthlyBudgetCents: { video: 5000 } }, update: { monthlyBudgetCents: { video: 5000 } } } as never);
    expect(await by("plafond").classify!(kit.deps, { equipe: "dating", poste: "video", euros: 20 })).toBe("immediate");
    expect(await by("plafond").classify!(kit.deps, { equipe: "dating", poste: "video", euros: 80 })).toBe("confirm");
  });

  it("droits : l'admin peut tout ; un membre lit, mais ne passe rien en vrai (détail : team/team.test.ts)", () => {
    const by = (k: string) => BOSS_CATALOG.find((x) => x.key === k)!;
    const lea = { kind: "member", telegramUserId: 2n, memberId: "m", role: "MEMBER", firstName: "Léa" } as const;
    expect(bossActionAllowed(by("simulation"))).toBe(true);
    expect(bossActionAllowed(by("simulation"), { kind: "admin", telegramUserId: 1n, firstName: null })).toBe(true);
    expect(bossActionAllowed(by("etat_general"), lea)).toBe(true);
    expect(bossActionAllowed(by("simulation"), lea, { cls: "confirm", params: { equipe: "casino", mode: "vrai" }, teams: ["casino"] })).toBe(false);
  });

  it("actions proches d'une demande non couverte", () => {
    expect(nearestActions("je veux voir les dépenses de la vidéo").map((a) => a.key)).toContain("depenses_du_mois");
    expect(nearestActions("zzz").length).toBeGreaterThanOrEqual(2);
  });
});

describe("résolution des noms", () => {
  it("équipes par nom, alias et fautes", () => {
    for (const [raw, t] of [["dating", "dating"], ["dateing", "dating"], ["Rencontres", "dating"], ["l'équipe casino", "casino"], ["cazino", "casino"], ["paris sportifs", "sports"], ["foot", "sports"], ["algorithme", "algo"], ["algoritme", "algo"]] as const)
      expect(teamOf(raw), raw).toBe(t);
    expect(teamOf("tout", { allowAll: true })).toBe("all");
    expect(teamOf("tout")).toBeNull();
    expect(teamOf("cuisine")).toBeNull();
  });

  it("canaux par titre avec accents et fautes ; ambiguïté = plusieurs candidats", () => {
    const items = [{ id: "1", name: "Léa en privé" }, { id: "2", name: "Casino VIP" }, { id: "3", name: "Casino Bonus" }];
    expect(matchNames("lea en prive", items).map((i) => i.id)).toEqual(["1"]);
    expect(matchNames("casino vipp", items).map((i) => i.id)).toEqual(["2"]);
    expect(matchNames("casino", items)).toHaveLength(2);
    expect(matchNames("id:3", items).map((i) => i.id)).toEqual(["3"]);
    expect(editDistance("sportaza", "sportasa")).toBe(1);
  });

  it("persona du canal par prénom, bookmaker avec faute, bornes", async () => {
    const kit = await createBossKit();
    const { resolveChannel } = await import("./resolve");
    const r = await resolveChannel(kit.deps, { actionKey: "etat_canal", params: {}, field: "canal" }, "Léa");
    expect(r.ok && r.value.id).toBe(kit.ids.chLea);
    expect(resolveBookmaker("sportasa")).toEqual({ ok: true, value: "sportaza" });
    expect(resolveBookmaker("unibet").ok).toBe(false);
    expect(checkQuota(7, 6)).toContain("maximum");
    expect(checkQuota(3, 6)).toBeNull();
    expect(checkCap(-1)).toBeTruthy();
    expect(checkLevel(3)).toBeTruthy();
  });

  it("quota au-dessus du maximum réglé : refusé avant toute confirmation", async () => {
    const kit = await createBossKit([["passe à 9 posts sur léa", { name: "quota_posts", input: { cible: "léa", posts_par_jour: 9 } }]]);
    const r = await bossAiTurn(kit.deps, kit.input("passe à 9 posts sur léa"));
    expect(r.reply).toContain("maximum réglé (6");
    expect(r.pendingId).toBeUndefined();
  });
});

describe("mémoire", () => {
  it("20 tours au plus, 24 heures au plus, secret masqué", async () => {
    const kit = await createBossKit();
    await writeBossTurn(kit.deps, { role: "ADMIN", text: "vieux message" });
    kit.advance(25 * 3600_000);
    for (let i = 0; i < 25; i++) {
      kit.advance(1000);
      await writeBossTurn(kit.deps, { role: i % 2 ? "BOSS" : "ADMIN", text: `tour ${i}` });
    }
    kit.advance(1000);
    await writeBossTurn(kit.deps, { role: "ADMIN", text: "sk-123", secret: true });
    const turns = await recentBossTurns(kit.deps);
    expect(turns).toHaveLength(20);
    expect(turns.map((t) => t.text)).not.toContain("vieux message");
    expect(turns.at(-1)!.text).toBe("[secret]");
    expect(memoryText("<b>Gras</b> &amp; co")).toBe("Gras & co");
  });
});

describe("réponses chiffrées : aucun chiffre inventé", () => {
  it("contrôle pur : chiffre absent → refusé ; 6 lignes au plus", () => {
    const facts = { totalEuros: 12.5, equipes: [{ equipe: "Casino", euros: 4 }] };
    expect(checkedAnswer("Tu as dépensé 12,5 € ce mois, dont 4 € pour le casino.", facts)).not.toBeNull();
    expect(checkedAnswer("Tu as dépensé 13,7 € ce mois.", facts)).toBeNull();
    expect(checkedAnswer("Le double du mois dernier.", facts)).toBeNull();
    expect(checkedAnswer("a\nb\nc\nd\ne\nf\ng", facts)).toBeNull();
  });

  it("rédaction IA acceptée si juste, sinon chiffres mis en forme par le code ; égaux à la vue d'ensemble", async () => {
    const kit = await createBossKit([], { writer: () => "Ce mois tu as dépensé 999 €." });
    await kit.prisma.agentUsage.create({ data: { teamKey: "casino", provider: "llm", month: "2026-10", cents: 1234 } as never });
    const bad = await answerQuestion(kit.deps, { topic: "depenses", question: "combien ce mois" });
    expect(bad.checked).toBe("code");
    expect(bad.reply).toContain("12,34 €");
    const good = await answerQuestion(
      { ...kit.deps, llm: (await createBossKit([], { writer: () => "Ce mois : 12.34 € dépensés." })).llm },
      { topic: "depenses", question: "combien ce mois" },
    );
    expect(good.checked).toBe("ia");
    const none = await answerQuestion({ ...kit.deps, llm: null }, { topic: "paris", question: "les paris ?" });
    expect(none.reply).toContain("Aucun pari");
  });
});

describe("coût borné", () => {
  const client = (): AiClient => ({
    createMessage: vi.fn(async () => ({ text: "", usage: { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", toolUses: [{ name: "etat_general", input: {} }] })),
  });

  it("plafond atteint : IA absente, le Boss garde les commandes exactes et le dit", async () => {
    const kit = await createBossKit();
    await kit.prisma.setting.create({ data: { key: "boss.budget", value: { monthlyCents: 10 } } as never });
    await kit.prisma.agentUsage.create({ data: { teamKey: "boss", provider: "llm", month: "2026-10", cents: 10 } as never });
    expect(await loadBossLlm(kit.prisma, { client: client(), now: () => new Date("2026-10-23T08:00:00Z") })).toBeNull();
    const llm = bossLlmFromClient(kit.prisma, client(), { now: () => new Date("2026-10-23T08:00:00Z") });
    const r = await bossAiTurn({ ...kit.deps, llm }, kit.input("où en est tout le monde"));
    expect(NO_AI_REPLIES).toContain(r.reply);
  });

  it("dépense comptée (équipe boss, poste llm), alerte à 80 % une fois", async () => {
    const kit = await createBossKit();
    const now = new Date("2026-10-23T08:00:00Z");
    // Phase 33 : plafond par défaut relevé à 3 000 centimes (30 €).
    await recordBossUsage(kit.prisma, 2450, { now, admin: kit.deps.admin });
    await recordBossUsage(kit.prisma, 10, { now, admin: kit.deps.admin });
    expect(kit.sent.filter((m) => m.html.includes("80 %"))).toHaveLength(1);
    expect(await bossBudgetState(kit.prisma, now)).toMatchObject({ allowed: true, spentCents: 2460, capCents: 3000 });
    const llm = bossLlmFromClient(kit.prisma, client(), { now: () => now });
    const out = await llm.interpret({ system: "s", user: "u", tools: [] });
    expect(out.costCents).toBeGreaterThan(0);
    expect(out.toolUse?.name).toBe("etat_general");
  });
});
