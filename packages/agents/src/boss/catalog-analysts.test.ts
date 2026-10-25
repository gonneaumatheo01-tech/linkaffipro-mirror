/**
 * Phase 29, chantier C — Kevin et l'équipe Analystes : chaque entrée du catalogue avec les phrases du client (fausse
 * IA), phrase fixe des règles, sources visibles, ajout d'une source inactive puis OUI, droits, recommandations
 * numérotées sans aucune action externe, réponse différée par la file. Les fonctions des chantiers A / B passent par
 * `deps.analystsKevin` (faux) ; aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_DISCLAIMER, type AnalystsQueueJob } from "../analysts/contract";
import { runAnalystsJob } from "../analysts/kevin-jobs";
import type { AnalystsKevinDeps, AnalystsKevinPort } from "../analysts/kevin-port";
import { ANALYSTS_KEVIN_VARIANTS, countriesOf, marketOf, platformOf } from "../analysts/kevin-texts";
import { capabilitiesForAgent, capability, isOrderableTeam } from "../orders/registry";
import { agentCard, findAgent } from "../orders/agents-dict";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import { ANALYSTS_ACTIONS, ANALYSTS_ADMIN_ACTION_KEYS, ANALYSTS_READ_ACTION_KEYS, cleanNumbers } from "./catalog-analysts";
import { bossAiTurn } from "./execute";
import { bossFastPath } from "./fast";
import { createBossKit, type BossKit } from "./testing";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts } from "./voice";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });
const MEMBER = { kind: "member", telegramUserId: 7n, memberId: "m", role: "MEMBER", firstName: "Zoé" } as const;
const DAY = 86400_000;

type Fake = { port: Partial<AnalystsKevinPort>; jobs: AnalystsQueueJob[]; questions: Array<Record<string, unknown>>; briefings: Array<Record<string, unknown>> };

function fakePort(): Fake {
  const f: Fake = { port: {}, jobs: [], questions: [], briefings: [] };
  f.port = {
    answerMarketQuestion: vi.fn(async (_d, q) => {
      f.questions.push(q as Record<string, unknown>);
      return {
        text: `- Les vidéos de joueurs qui filment leur écran marchent fort (https://www.reddit.com/r/casinoonline/abc)\n- Les pubs avec bonus sont refusées par TikTok (https://ads.tiktok.com/help/article/gambling) (non vérifié)\n${LEGAL_DISCLAIMER}`,
        noData: false,
        suggestSearch: false,
        mentionsRules: true,
        sources: [{ url: "https://www.reddit.com/r/casinoonline/abc", date: "2026-10-20" }],
        usedEntryIds: [],
        usedRuleIds: [],
        removedUrls: [],
        removedLegal: [],
        costCents: 12,
        market: null,
        countries: [],
      };
    }) as AnalystsKevinPort["answerMarketQuestion"],
    buildBriefing: vi.fn(async (_d, input) => {
      f.briefings.push(input as Record<string, unknown>);
      return { reportId: "rep-b", text: "Briefing casino, Allemagne\n- Les streams de machines à sous montent (https://www.casino.org/news/de)", noData: false, suggestSearch: false, sources: [{ url: "https://www.casino.org/news/de", date: null }], costCents: 30 };
    }) as AnalystsKevinPort["buildBriefing"],
  };
  return f;
}

async function kitWith(table: Parameters<typeof createBossKit>[0], opts: { queue?: boolean } = {}): Promise<{ kit: BossKit; fake: Fake; deps: AnalystsKevinDeps }> {
  const kit = await createBossKit(table);
  const fake = fakePort();
  const deps = kit.deps as AnalystsKevinDeps;
  deps.analystsKevin = fake.port;
  if (opts.queue) deps.analysts = { enqueue: vi.fn(async (job: AnalystsQueueJob) => void fake.jobs.push(job)) };
  return { kit, fake, deps };
}

async function seed(kit: BossKit) {
  const p = kit.prisma;
  const now = kit.deps.now!();
  const forum = await p.trendSource.create({ data: { name: "BlackHatWorld", url: "https://www.blackhatworld.com", sourceType: "FORUM", market: "CASINO", countries: ["FR"], languages: ["en"], scrapeConfig: {}, isActive: true, errorCount: 0, lastScrapedAt: new Date(now.getTime() - DAY), nextScrapeAt: null } as never });
  await p.trendSource.create({ data: { name: "Reddit r/gambling", url: "https://www.reddit.com/r/gambling", sourceType: "REDDIT", market: "CASINO", countries: [], languages: ["en"], scrapeConfig: {}, isActive: true, errorCount: 0, lastScrapedAt: null, nextScrapeAt: null } as never });
  await p.trendEntry.create({ data: { sourceId: forum.id, market: "CASINO", countries: ["FR"], language: "en", title: "Streams", summary: "Les streams de machines à sous sur TikTok attirent beaucoup de joueurs en France", url: "https://www.blackhatworld.com/threads/1", urlHash: "h1", publishedAt: new Date(now.getTime() - 2 * DAY), category: "MARKET_TREND", tags: [], sentiment: "POSITIVE", relevanceScore: 8, verified: false, createdAt: new Date(now.getTime() - 2 * DAY) } as never });
  await p.trendEntry.create({ data: { sourceId: forum.id, market: "SPORTS", countries: ["DE"], language: "de", title: null, summary: "Hors sujet pour le casino", url: "https://www.blackhatworld.com/threads/2", urlHash: "h2", publishedAt: null, category: "OTHER", tags: [], sentiment: "NEUTRAL", relevanceScore: 6, verified: true, createdAt: new Date(now.getTime() - DAY) } as never });
  await p.complianceRule.create({ data: { platform: "META", market: "CASINO", country: "FR", rule: "Les pubs de casino exigent une autorisation écrite de Meta, sinon elles sont refusées.", riskLevel: "HIGH", evidence: [{ url: "https://transparency.meta.com/policies/ad-standards/gambling", date: "2026-10-01", description: "politique" }], verified: true, isActive: true, lastVerifiedAt: now, updatedAt: now, createdAt: now } as never });
  await p.complianceRule.create({ data: { platform: "TIKTOK", market: "CASINO", country: "ALL", rule: "TikTok bannit les comptes qui promettent un bonus de casino.", riskLevel: "BAN", evidence: [{ url: "https://ads.tiktok.com/help/article/gambling", date: "2026-10-10", description: "forum" }], verified: false, isActive: true, lastVerifiedAt: now, updatedAt: now, createdAt: now } as never });
  const r1 = await p.recommendation.create({ data: { teamKey: "analystes", source: "market_analysis", status: "PROPOSED", target: "MARKET", targetId: "DATING:ES", field: "ad_strategy", after: { title: "Vidéo façon témoignage, 15 secondes", market: "DATING", countries: ["ES"], risk: "LOW" }, evidence: { sources: [{ url: "https://www.reddit.com/r/Tinder/x" }] }, expectedGain: "Vidéo façon témoignage" } as never });
  const r2 = await p.recommendation.create({ data: { teamKey: "analystes", source: "market_analysis", status: "PROPOSED", target: "MARKET", targetId: "DATING:ES", field: "ad_strategy", after: { title: "Carrousel de profils, angle style de vie", market: "DATING", countries: ["ES"], risk: "MEDIUM" }, evidence: { sources: [{ url: "https://www.reddit.com/r/datingapps/y" }] }, expectedGain: "Carrousel" } as never });
  return { forum, r1, r2 };
}

/** Tout ce qui toucherait aux pubs ou aux canaux : doit rester identique. */
function externalSnapshot(kit: BossKit): string {
  return JSON.stringify(["post", "channel", "channelAgentPlan", "agentMission", "adAccountConnection", "campaign", "teamOrder"].map((t) => kit.tables(t)), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const last = (kit: BossKit) => kit.sent[kit.sent.length - 1]?.html ?? "";

beforeEach(() => resetVoiceRotation());

describe("catalogue de Kevin : analyse du marché", () => {
  it("entrées uniques, clés sans accent, lectures pour les membres, gestes réservés à l'admin", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["analyse_marche", "tendances", "compliance", "strategie_ads", "sources_veille", "rapport_marche", "alertes_marche", "activer_source", "appliquer_reco_marche"]) {
      expect(keys, k).toContain(k);
      expect(k).toMatch(/^[a-z_]+$/);
    }
    const by = (k: string) => ANALYSTS_ACTIONS.find((a) => a.key === k)!;
    for (const k of ANALYSTS_READ_ACTION_KEYS) expect(bossActionAllowed(by(k), MEMBER), k).toBe(true);
    for (const k of ANALYSTS_ADMIN_ACTION_KEYS) expect(bossActionAllowed(by(k), MEMBER), k).toBe(false);
    for (const a of ANALYSTS_ACTIONS) expect(a.theme).toBe("ads");
  });

  it("lecture des demandes : marché, pays, plateforme, numéros", () => {
    expect(marketOf("qu'est-ce qui marche en casino en France ?")).toBe("CASINO");
    expect(marketOf("pour le dating en Espagne")).toBe("DATING");
    expect(marketOf("les paris sportifs en Allemagne")).toBe("SPORTS");
    expect(countriesOf("compare la France et l'Allemagne en casino")).toEqual(["FR", "DE"]);
    expect(countriesOf("les Pays-Bas puis la Suède")).toEqual(["NL", "SE"]);
    expect(platformOf("les règles Meta")).toBe("META");
    expect(platformOf("sur TikTok en France")).toBe("TIKTOK");
    expect(cleanNumbers("applique la 2")).toBe("2");
    expect(cleanNumbers("garde 1 et 3")).toBe("1 et 3");
  });

  it("« qu'est-ce qui marche en casino en France ? » : réponse différée, puis réponse sourcée avec la phrase fixe", async () => {
    const phrase = "qu'est-ce qui marche en casino en France ?";
    const { kit, fake, deps } = await kitWith([[phrase, call("analyse_marche", { question: phrase, marche: "casino", pays: "France" })]], { queue: true });
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(ANALYSTS_KEVIN_VARIANTS.deferred).toContain(r.reply);
    expect(fake.jobs).toEqual([{ type: "analysts.strategy", kind: "on_demand", requestId: expect.any(String) }]);
    expect(fake.questions).toHaveLength(0);
    await runAnalystsJob(deps, fake.jobs[0]!);
    expect(fake.questions[0]).toMatchObject({ question: phrase, market: "CASINO", countries: ["FR"] });
    const sent = last(kit);
    expect(sent).toContain("https://www.reddit.com/r/casinoonline/abc");
    expect(sent).toContain(LEGAL_DISCLAIMER);
    expect(sent.split("\n").length).toBeLessThanOrEqual(20);
    // Une seule réponse : la tâche rejouée n'envoie rien de plus.
    const n = kit.sent.length;
    await runAnalystsJob(deps, fake.jobs[0]!);
    expect(kit.sent).toHaveLength(n);
  });

  it("« compare la France et l'Allemagne en casino » : les deux pays vont au Stratège", async () => {
    const phrase = "compare la France et l'Allemagne en casino";
    const { kit, fake, deps } = await kitWith([[phrase, call("analyse_marche", { question: phrase })]]);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(fake.questions[0]).toMatchObject({ market: "CASINO", countries: ["FR", "DE"] });
    expect(r.reply).toContain("https://www.reddit.com/r/casinoonline/abc");
  });

  it("« quelles tendances cette semaine ? » : tendances sourcées, « non vérifiée » quand une seule source", async () => {
    const phrase = "quelles tendances cette semaine ?";
    const { kit, deps } = await kitWith([[phrase, call("tendances", {})]]);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toContain("https://www.blackhatworld.com/threads/1");
    expect(r.reply).toMatch(/non vérifiée|pas encore vérifiée/);
    expect(r.reply).toContain("streams de machines à sous");
  });

  it("« quelles sont les règles Meta pour le casino en France ? » : règles, risque, preuve et phrase fixe", async () => {
    const phrase = "quelles sont les règles Meta pour le casino en France ?";
    const { kit, deps } = await kitWith([[phrase, call("compliance", { plateforme: "Meta", marche: "casino", pays: "France" })]]);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toContain("autorisation écrite");
    expect(r.reply).toContain("https://transparency.meta.com/policies/ad-standards/gambling");
    expect(r.reply).toMatch(/Risque : élevé/);
    expect(r.reply).toContain(LEGAL_DISCLAIMER);
    expect(r.reply).not.toContain("TikTok bannit");
  });

  it("« c'est risqué de faire des ads casino avec du bonus sur TikTok en France ? » : la règle du bonus, le risque, la phrase fixe", async () => {
    const phrase = "c'est risqué de faire des ads casino avec du bonus sur TikTok en France ?";
    const { kit, deps } = await kitWith([[phrase, call("compliance", { plateforme: "TikTok", marche: "casino", pays: "France", pratique: "bonus" })]]);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toContain("bonus");
    expect(r.reply).toMatch(/bannissement/);
    expect(r.reply).toContain("https://ads.tiktok.com/help/article/gambling");
    expect(r.reply).toMatch(/non vérifiée|pas encore vérifiée/);
    expect(r.reply).toContain(LEGAL_DISCLAIMER);
  });

  it("« quel type d'ad je devrais faire pour le dating en Espagne ? » : conseil + propositions numérotées ; « applique 2 » ne touche rien dehors", async () => {
    const phrase = "quel type d'ad je devrais faire pour le dating en Espagne ?";
    const { kit, deps } = await kitWith([[phrase, call("strategie_ads", { question: phrase, marche: "rencontres", pays: "Espagne" })]]);
    const { r1, r2 } = await seed(kit);
    const before = externalSnapshot(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toMatch(/1\. .+\n2\. /);
    expect(r.reply).toContain("Carrousel de profils");
    expect(r.reply).toContain(LEGAL_DISCLAIMER);
    expect(r.reply).toMatch(/applique/);
    expect(r.reply!.split("\n").length).toBeLessThanOrEqual(20);
    const choice = kit.tables("setting").find((x) => String(x.key).startsWith("analysts.choice."))!.value as { items: Array<{ n: number; recommendationId: string }> };
    const second = choice.items.find((i) => i.n === 2)!.recommendationId;
    const other = [r1.id, r2.id].find((id) => id !== second)!;
    const f = await bossFastPath(deps, kit.input("applique 2"));
    expect(f).toMatchObject({ handled: true });
    const reply = "reply" in f ? (f.reply ?? "") : "";
    expect(reply).toMatch(/Rien n'a bougé|Je n'ai rien changé/);
    const rows = kit.tables("recommendation");
    expect(rows.find((x) => x.id === second)!.status).toBe("APPLIED");
    expect(rows.find((x) => x.id === other)!.status).toBe("PROPOSED");
    expect(externalSnapshot(kit)).toBe(before);
    expect(kit.enqueue.orchestrator).not.toHaveBeenCalled();
    expect(kit.enqueue.step).not.toHaveBeenCalled();
    // Le choix est fermé : un deuxième « 1 » n'applique plus rien en silence.
    await bossFastPath(deps, kit.input("1"));
    expect(kit.tables("recommendation").find((x) => x.id === other)!.status).toBe("PROPOSED");
  });

  it("« quelles sources tu surveilles ? » : la liste avec les adresses", async () => {
    const phrase = "quelles sources tu surveilles ?";
    const { kit, deps } = await kitWith([[phrase, call("sources_veille", { action: "voir" })]]);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toContain("BlackHatWorld");
    expect(r.reply).toContain("https://www.reddit.com/r/gambling");
    expect(r.reply).toMatch(/2 sources/);
  });

  it("« ajoute ce forum <url> » : source notée INACTIVE, puis OUI l'active ; « retire » demande un OUI", async () => {
    const add = "ajoute ce forum https://forum.affiliation-example.fr/casino";
    const rm = "retire Reddit r/gambling";
    const { kit, deps } = await kitWith([
      [add, call("sources_veille", { action: "ajouter", adresse: "https://forum.affiliation-example.fr/casino" })],
      [rm, call("sources_veille", { action: "retirer", nom: "Reddit r/gambling" })],
    ]);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(add));
    const created = kit.tables("trendSource").find((s) => s.url === "https://forum.affiliation-example.fr/casino")!;
    expect(created).toMatchObject({ isActive: false, origin: "client", market: "CASINO" });
    expect(r.reply).toMatch(/Je l'ajoute à ma veille|Je la mets dans ma veille/);
    expect(r.buttons?.[0]?.map((b) => b.text)).toEqual(["✅ OUI", "❌ NON"]);
    const yes = await bossFastPath(deps, kit.input("OUI"));
    expect(yes).toMatchObject({ handled: true });
    expect(kit.tables("trendSource").find((s) => s.id === created.id)!.isActive).toBe(true);

    const r2 = await bossAiTurn(deps, kit.input(rm));
    expect(r2.reply).toMatch(/Retirer Reddit r\/gambling|ne surveille plus Reddit/);
    expect(kit.tables("trendSource").find((s) => s.name === "Reddit r/gambling")!.isActive).toBe(true);
    await bossFastPath(deps, kit.input("OUI"));
    expect(kit.tables("trendSource").find((s) => s.name === "Reddit r/gambling")!.isActive).toBe(false);
  });

  it("droits : un membre présenté lit et demande, mais n'ajoute pas de source et ne garde pas de proposition", async () => {
    const add = "ajoute https://forum.membre-example.fr";
    const ask = "quel type d'ad pour le dating en Espagne ?";
    const { kit, deps } = await kitWith([
      [add, call("sources_veille", { action: "ajouter", adresse: "https://forum.membre-example.fr" })],
      [ask, call("strategie_ads", { question: ask, marche: "rencontres", pays: "Espagne" })],
      ["applique 1", call("appliquer_reco_marche", { numeros: "1" })],
    ]);
    await seed(kit);
    await kit.prisma.teamMember.create({ data: { telegramUserId: 7n, firstName: "Zoé", role: "MEMBER", responsibilities: { teams: [], kinds: [] } } as never });
    const r = await bossAiTurn(deps, kit.input(add, { speaker: MEMBER }));
    expect(kit.tables("trendSource").some((s) => s.url === "https://forum.membre-example.fr")).toBe(false);
    expect(r.reply).not.toMatch(/est notée/);
    const a = await bossAiTurn(deps, kit.input(ask, { speaker: MEMBER }));
    expect(a.reply).toContain("https://www.reddit.com/r/casinoonline/abc");
    // Pas de choix numéroté pour un membre (seul l'admin garde une proposition).
    expect(a.reply).not.toMatch(/applique 2/);
    await bossAiTurn(deps, kit.input("applique 1", { speaker: MEMBER }));
    expect(kit.tables("recommendation").every((x) => x.status === "PROPOSED")).toBe(true);
  });

  it("« briefing casino Allemagne » : briefing du Rapporteur en différé", async () => {
    const phrase = "briefing casino Allemagne";
    const { kit, fake, deps } = await kitWith([[phrase, call("rapport_marche", { marche: "casino", pays: "Allemagne" })]], { queue: true });
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(ANALYSTS_KEVIN_VARIANTS.deferredBriefing).toContain(r.reply);
    await runAnalystsJob(deps, fake.jobs[0]!);
    expect(fake.briefings[0]).toMatchObject({ market: "CASINO", countries: ["DE"] });
    expect(last(kit)).toContain("https://www.casino.org/news/de");
  });

  it("« y a des alertes en ce moment ? » : règles à risque avec leurs sources et la phrase fixe ; rien → le dire", async () => {
    const phrase = "y a des alertes en ce moment ?";
    const { kit, deps } = await kitWith([[phrase, call("alertes_marche", {})]]);
    const empty = await bossAiTurn(deps, kit.input(phrase));
    expect(ANALYSTS_KEVIN_VARIANTS.noAlerts).toContain(empty.reply);
    await seed(kit);
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(r.reply).toContain("https://ads.tiktok.com/help/article/gambling");
    expect(r.reply).toContain(LEGAL_DISCLAIMER);
  });

  it("veille coupée (`analysts.enabled = false`) : Kevin le dit, rien n'est demandé au Stratège", async () => {
    const phrase = "qu'est-ce qui marche en casino en France ?";
    const { kit, fake, deps } = await kitWith([[phrase, call("analyse_marche", { question: phrase })]], { queue: true });
    await kit.prisma.setting.create({ data: { key: "analysts.enabled", value: false } as never });
    const r = await bossAiTurn(deps, kit.input(phrase));
    expect(ANALYSTS_KEVIN_VARIANTS.disabled).toContain(r.reply);
    expect(fake.jobs).toHaveLength(0);
    expect(fake.questions).toHaveLength(0);
  });

  it("chaque variante passe voiceCheck", () => {
    for (const [key, entry] of Object.entries(ANALYSTS_KEVIN_VARIANTS)) {
      const { texts, rules } = voiceEntryTexts(entry);
      for (const t of texts) expect(voiceCheck(t, rules).problems, `${key} : ${t}`).toEqual([]);
    }
  });
});

describe("ordres de Kevin : équipe Analystes", () => {
  it("capacités en lecture seule et agents nommables avec leur fiche", async () => {
    expect(isOrderableTeam("analystes")).toBe(true);
    for (const k of ["question", "tendances", "regles_pub", "alertes_marche", "sources_veille", "analyse_marche", "strategie_ads", "briefing_marche"]) expect(capability("analystes", k), k).toBeTruthy();
    expect(capabilitiesForAgent("veille").map((c) => c.key)).toContain("tendances");
    expect(capabilitiesForAgent("compliance").map((c) => c.key)).toContain("regles_pub");
    for (const [phrase, key] of [
      ["la veille", "veille"],
      ["l'agent compliance", "compliance"],
      ["le stratège", "stratege"],
      ["le rapporteur", "rapporteur"],
      ["les analystes", "chef-analystes"],
    ] as const) {
      const f = findAgent(phrase);
      expect(f.status === "found" && f.agent.key, phrase).toBe(key);
    }
    const kit = await createBossKit();
    await seed(kit);
    for (const key of ["veille", "compliance", "stratege", "rapporteur", "chef-analystes"]) {
      const card = await agentCard(kit.deps, key);
      expect(card.lines.length, key).toBeGreaterThanOrEqual(2);
      for (const l of card.lines) expect(voiceCheck(l).problems, `${key} : ${l}`).toEqual([]);
    }
    const plan = await capability("analystes", "regles_pub")!.plan(kit.deps, { marche: "casino", pays: "France" }, { now: new Date(), mode: "simulation" });
    expect(plan[0]!.touches).toEqual({ channelIds: [] });
  });
});
