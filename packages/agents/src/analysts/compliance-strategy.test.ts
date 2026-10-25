/**
 * Phase 29, chantier B — Compliance, Stratège et Rapporteur sur données connues (fausse IA scriptée, faux web, faux
 * Prisma ; aucun réseau).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PLANNER_MODEL, QUALITY_MODEL } from "@linkaffipro/ai";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts } from "../boss/voice";
import { createFakePrisma, type FakePrisma } from "../testing/fake-prisma";
import { ALERT_VARIANTS, alertFor } from "./alert-texts";
import { createFakeAnalystsLlm, createFakeAnalystsWeb } from "./analysis-testing";
import { hasLegalAdvice, honestWorkaround, LEGAL_REWRITE_SENTENCE, sanitizeLegal, stripUnknownUrls, knownUrlSet } from "./citations";
import {
  buildInitialRules,
  checkEntryCompliance,
  COMPLIANCE_SYSTEM,
  ENTRY_COMPLIANCE_SYSTEM,
  evidenceOf,
  isRuleVerified,
  OFFICIAL_POLICY_PAGES,
  REVERIFY_SYSTEM,
  reverifyRules,
} from "./compliance";
import { ANALYSTS_TEAM_KEY, LEGAL_DISCLAIMER, MARKET_ANALYSIS_SOURCE } from "./contract";
import { AnalystsAiError, callAnalystsTask, type AnalystsBrainDeps } from "./reasoning";
import { buildBriefing, buildWeeklyReport, isoWeekOf, REPORTER_WEEKLY_SYSTEM, WEEKLY_REPORT_MAX_CHARS } from "./reporter";
import { answerMarketQuestion, STRATEGIST_ANSWER_SYSTEM, STRATEGIST_WEEKLY_SYSTEM, weeklySynthesis } from "./strategist";
import type { LlmRequest } from "../types";

// Lundi 26 octobre 2026, 9 h à Paris.
const NOW = new Date("2026-10-26T08:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const BHW = "https://www.blackhatworld.com/seo/tiktok-casino-ads-banned-france.1500001/";
const REDDIT = "https://www.reddit.com/r/casinoonline/comments/xyz123/tiktok_ban_bonus/";
const NEWS = "https://www.igamingbusiness.com/marketing/tiktok-gambling-ads-france/";
const UGC = "https://www.reddit.com/r/affiliatemarketing/comments/ugc456/screen_recording_casino_france/";
const DATING_DE = "https://www.blackhatworld.com/seo/dating-ads-germany-testimonials.1500002/";
const META_PAGE = OFFICIAL_POLICY_PAGES.find((p) => p.platform === "META" && p.markets.includes("CASINO"))!.url;
const INVENTED = "https://www.casino-secrets-inventes.example/ban";

function entry(over: Record<string, unknown>) {
  return {
    sourceId: "src1",
    market: "CASINO",
    countries: ["FR"],
    language: "fr",
    title: null,
    summary: "Résumé.",
    url: BHW,
    urlHash: String(Math.random()),
    author: null,
    publishedAt: days(2),
    category: "AD_STRATEGY",
    tags: [],
    sentiment: "NEUTRAL",
    relevanceScore: 7,
    verified: false,
    createdAt: days(2),
    ...over,
  };
}

function deps(prisma: FakePrisma, script: (req: LlmRequest) => string | Error, extra: Partial<AnalystsBrainDeps> = {}) {
  const llm = createFakeAnalystsLlm(script, 3);
  const d: AnalystsBrainDeps = {
    prisma,
    now: () => NOW,
    enqueue: { orchestrator: async () => {}, step: async () => {} },
    analystsLlm: llm,
    internalFigures: async () => null,
    ...extra,
  };
  return { d, llm };
}

const plain = (html: string) => html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

beforeEach(() => resetVoiceRotation());

describe("Compliance : règles depuis les entrées", () => {
  it("crée une règle depuis une entrée connue (une seule source → non vérifiée) et rend l'alerte HIGH", async () => {
    const prisma = createFakePrisma({
      trendEntry: [entry({ id: "e1", category: "AD_BAN", url: BHW, summary: "Plusieurs affiliés disent que TikTok bannit les comptes qui montrent un bonus casino en France.", tags: ["tiktok_ban"] })],
    });
    const { d, llm } = deps(prisma, (req) => {
      expect(req.system).toBe(ENTRY_COMPLIANCE_SYSTEM);
      return JSON.stringify({ items: [{ action: "new", platform: "TIKTOK", country: "FR", rule: "TikTok bannit les comptes publicitaires qui montrent un bonus de casino en France.", riskLevel: "HIGH", workaround: null, evidenceDescription: "Retours de plusieurs affiliés bannis." }] });
    });
    const r = await checkEntryCompliance(d, "e1");
    expect("created" in r && r.created).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe(PLANNER_MODEL);
    const rule = prisma._tables.complianceRule![0]!;
    expect(rule).toMatchObject({ platform: "TIKTOK", market: "CASINO", country: "FR", riskLevel: "HIGH", verified: false, sourceEntryId: "e1", isActive: true });
    expect(evidenceOf(rule.evidence).map((e) => e.url)).toEqual([BHW]);
    const alerts = "alerts" in r ? r.alerts : [];
    expect(alerts).toHaveLength(1);
    const text = plain(alerts[0]!.text);
    expect(text).toContain("⚠️ Alerte compliance");
    expect(text).toContain("Risque : élevé");
    expect(text).toContain(`Source : ${BHW}`);
    expect(text).toContain("Une seule source pour l'instant");
    expect(text).toContain(LEGAL_DISCLAIMER);
    expect(voiceCheck(alerts[0]!.text).problems).toEqual([]);
  });

  it("met à jour une règle existante avec une nouvelle preuve d'une autre source → vérifiée", async () => {
    const prisma = createFakePrisma({
      complianceRule: [{ id: "r1", platform: "TIKTOK", market: "CASINO", country: "FR", rule: "TikTok bannit les comptes qui montrent un bonus de casino en France.", riskLevel: "HIGH", evidence: [{ url: BHW, date: "2026-10-20", description: "Forum" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(6), sourceEntryId: null }],
      trendEntry: [entry({ id: "e2", category: "PLATFORM_CHANGE", url: NEWS, summary: "TikTok confirme le refus des pubs de bonus casino en France." })],
    });
    const { d } = deps(prisma, () => JSON.stringify({ items: [{ action: "update", ruleId: "r1", contradicts: false, riskLevel: "HIGH", evidenceDescription: "Article qui confirme." }] }));
    const r = await checkEntryCompliance(d, "e2");
    expect("updated" in r && r.updated).toEqual(["r1"]);
    const rule = prisma._tables.complianceRule![0]!;
    expect(evidenceOf(rule.evidence).map((e) => e.url)).toEqual([BHW, NEWS]);
    expect(rule.verified).toBe(true);
    expect(prisma._tables.complianceRule).toHaveLength(1);
    // Risque inchangé : pas de nouvelle alerte.
    expect("alerts" in r && r.alerts).toEqual([]);
  });

  it("contradiction : preuves gardées des deux côtés, risque le plus prudent, non vérifiée", async () => {
    const prisma = createFakePrisma({
      complianceRule: [{ id: "r1", platform: "TIKTOK", market: "CASINO", country: "FR", rule: "TikTok bannit les comptes qui montrent un bonus de casino en France.", riskLevel: "HIGH", evidence: [{ url: BHW, date: "2026-10-20", description: "Forum" }, { url: NEWS, date: "2026-10-21", description: "Article" }], verified: true, workaround: null, isActive: true, lastVerifiedAt: days(6), sourceEntryId: null }],
      trendEntry: [entry({ id: "e3", category: "AD_BAN", url: REDDIT, summary: "Un affilié dit que ses pubs bonus passent sans souci sur TikTok en France." })],
    });
    const { d } = deps(prisma, () => JSON.stringify({ items: [{ action: "update", ruleId: "r1", contradicts: true, riskLevel: "LOW", rule: "TikTok accepte les pubs bonus casino.", evidenceDescription: "Témoignage contraire." }] }));
    const r = await checkEntryCompliance(d, "e3");
    expect("contradicted" in r && r.contradicted).toEqual(["r1"]);
    const rule = prisma._tables.complianceRule![0]!;
    expect(rule.riskLevel).toBe("HIGH");
    expect(rule.rule).toBe("TikTok bannit les comptes qui montrent un bonus de casino en France.");
    const ev = evidenceOf(rule.evidence);
    expect(ev.map((e) => [e.url, e.stance])).toEqual([
      [BHW, "supports"],
      [NEWS, "supports"],
      [REDDIT, "contradicts"],
    ]);
    expect(rule.verified).toBe(false);
  });

  it("vérification croisée : deux domaines différents → vérifiée ; deux posts du même forum → non", () => {
    expect(isRuleVerified([{ url: BHW, date: null, description: "" }, { url: META_PAGE, date: null, description: "" }])).toBe(true);
    expect(isRuleVerified([{ url: BHW, date: null, description: "" }, { url: DATING_DE, date: null, description: "" }])).toBe(false);
    expect(isRuleVerified([{ url: BHW, date: null, description: "" }])).toBe(false);
  });

  it("une entrée hors catégorie n'appelle pas l'IA", async () => {
    const prisma = createFakePrisma({ trendEntry: [entry({ id: "e9", category: "OFFER" })] });
    const { d, llm } = deps(prisma, () => "{}");
    expect(await checkEntryCompliance(d, "e9")).toEqual({ entryId: "e9", skipped: "category" });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("Compliance : base initiale par les pages officielles", () => {
  it("lit Meta et TikTok (adresse introuvable → recherche sur le domaine officiel), refuse les preuves inventées et l'avis juridique", async () => {
    const tiktokFound = "https://ads.tiktok.com/help/article/gambling-policy-2026";
    const web = createFakeAnalystsWeb(
      {
        [META_PAGE]: `<html><body><h1>Online gambling and games</h1><p>${"Ads that promote online gambling require prior written permission. ".repeat(4)}</p><script>alert(1)</script></body></html>`,
        [tiktokFound]: `<html><body><p>${"Gambling ads are prohibited except in approved markets. ".repeat(4)}</p></body></html>`,
      },
      [{ match: /TikTok ads policy gambling/i, results: [{ url: tiktokFound, title: "Gambling", snippet: "", date: null }] }],
    );
    const prisma = createFakePrisma({ trendEntry: [entry({ id: "e1", category: "AD_BAN", url: BHW, summary: "Ban TikTok pour des pubs casino.", tags: ["tiktok_ban"] })] });
    const { d, llm } = deps(
      prisma,
      (req) => {
        expect(req.system).toBe(COMPLIANCE_SYSTEM);
        expect(req.user).not.toContain("alert(1)");
        if (req.user.includes("Plateforme : META"))
          return JSON.stringify({
            rules: [
              { market: "CASINO", country: "ALL", rule: "Meta refuse les pubs de jeux d'argent sans autorisation écrite préalable.", riskLevel: "HIGH", workaround: "Demander l'autorisation écrite de Meta avant de lancer.", evidence: [{ url: META_PAGE, date: "2026-10-01", description: "Page officielle" }] },
              { market: "CASINO", country: "FR", rule: "Meta laisse passer les pubs de casino en France. C'est légal en France avec une licence ANJ.", riskLevel: "MEDIUM", workaround: "Utiliser une page blanche (cloaking) pour passer la revue.", evidence: [{ url: META_PAGE, date: null, description: "Page officielle" }] },
              { market: "SPORTS", country: "DE", rule: "Meta bannit les pubs de paris en Allemagne.", riskLevel: "BAN", evidence: [{ url: INVENTED, date: null, description: "Inventé" }] },
            ],
          });
        return JSON.stringify({ rules: [{ market: "CASINO", country: "ALL", rule: "TikTok interdit les pubs de jeux d'argent hors marchés approuvés.", riskLevel: "BAN", evidence: [{ url: tiktokFound, date: null, description: "Page officielle" }, { url: BHW, date: "2026-10-24", description: "Forum" }] }] });
      },
      { web },
    );
    const r = await buildInitialRules(d, NOW);
    expect(llm.calls.map((c) => c.model)).toEqual([PLANNER_MODEL, PLANNER_MODEL]);
    expect(r.created).toHaveLength(3);
    expect(r.rejected).toBe(1); // preuve inventée
    const rules = prisma._tables.complianceRule!;
    for (const rule of rules) {
      expect(hasLegalAdvice(String(rule.rule))).toBe(false);
      expect(evidenceOf(rule.evidence).every((e) => !e.url.includes("inventes"))).toBe(true);
    }
    const fr = rules.find((x) => x.country === "FR")!;
    expect(fr.rule).toBe("Meta laisse passer les pubs de casino en France.");
    expect(fr.workaround).toBeNull(); // contournement malhonnête refusé
    expect(rules.find((x) => x.platform === "META" && x.country === "ALL")!.workaround).toBe("Demander l'autorisation écrite de Meta avant de lancer.");
    const tiktok = rules.find((x) => x.platform === "TIKTOK")!;
    expect(tiktok.verified).toBe(true); // page officielle + forum
    expect(tiktok.sourceEntryId).toBe("e1");
    expect(r.pages.some((p) => p.url === tiktokFound && p.via === "search")).toBe(true);
    expect(r.alerts.map((a) => a.riskLevel).sort()).toEqual(["BAN", "HIGH"]);
    expect(plain(r.alerts.find((a) => a.riskLevel === "BAN")!.text)).toContain("Risque : BAN");
  });
});

describe("Compliance : revérification à 30 jours", () => {
  it("relit les règles anciennes seulement ; confirmée → date mise à jour ; source disparue → non vérifiée", async () => {
    const OLD_OK = "https://transparency.meta.com/policies/old-ok";
    const prisma = createFakePrisma({
      complianceRule: [
        { id: "old", platform: "META", market: "CASINO", country: "ALL", rule: "Meta exige une autorisation écrite.", riskLevel: "HIGH", evidence: [{ url: OLD_OK, date: "2026-09-01", description: "Page" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(31), sourceEntryId: null },
        { id: "gone", platform: "TIKTOK", market: "DATING", country: "FR", rule: "TikTok refuse les pubs de rencontres suggestives.", riskLevel: "MEDIUM", evidence: [{ url: "https://ads.tiktok.com/disparu", date: null, description: "" }], verified: true, workaround: null, isActive: true, lastVerifiedAt: days(40), sourceEntryId: null },
        { id: "fresh", platform: "META", market: "DATING", country: "ALL", rule: "Meta exige une autorisation pour les rencontres.", riskLevel: "MEDIUM", evidence: [{ url: OLD_OK, date: null, description: "" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(5), sourceEntryId: null },
      ],
    });
    const web = createFakeAnalystsWeb({ [OLD_OK]: `<p>${"Gambling ads need written permission from Meta. ".repeat(5)}</p>` });
    const { d, llm } = deps(prisma, (req) => {
      expect(req.system).toBe(REVERIFY_SYSTEM);
      return JSON.stringify({ stillValid: true, riskLevel: "BAN", note: "La page le dit toujours." });
    }, { web });
    const r = await reverifyRules(d, NOW);
    expect(r.checked.sort()).toEqual(["gone", "old"]);
    expect(r.confirmed).toEqual(["old"]);
    expect(r.unreachable).toEqual(["gone"]);
    expect(llm.calls).toHaveLength(1);
    const rows = Object.fromEntries(prisma._tables.complianceRule!.map((x) => [x.id, x]));
    expect((rows.old!.lastVerifiedAt as Date).getTime()).toBe(NOW.getTime());
    expect(rows.old!.riskLevel).toBe("BAN");
    expect(rows.gone!.verified).toBe(false);
    expect(rows.fresh!.lastVerifiedAt).toEqual(days(5));
    expect(r.alerts).toHaveLength(1); // HIGH → BAN
  });

  it("sans accès web : rien n'est fait", async () => {
    const { d } = deps(createFakePrisma(), () => "{}");
    expect((await reverifyRules(d, NOW)).skipped).toBe("no_web");
  });
});

describe("Pas d'avis juridique, contournements honnêtes", () => {
  it("« c'est légal / illégal » est retiré et réécrit", () => {
    const r = sanitizeLegal("Les pubs bonus passent mal sur TikTok. En France, c'est illégal sans licence. Teste plutôt la vidéo.");
    expect(hasLegalAdvice(r.text)).toBe(false);
    expect(r.text).toContain(LEGAL_REWRITE_SENTENCE);
    expect(r.text).toContain("Teste plutôt la vidéo.");
    expect(r.removed).toHaveLength(1);
    expect(hasLegalAdvice("Tu as le droit de faire de la pub casino en Espagne.")).toBe(true);
    expect(hasLegalAdvice("C'est parfaitement légal.")).toBe(true);
    expect(hasLegalAdvice("Meta refuse la pub sans autorisation écrite.")).toBe(false);
  });

  it("refuse les contournements malhonnêtes", () => {
    expect(honestWorkaround("Passer par un compte de secours")).toBeNull();
    expect(honestWorkaround("Cloaking de la page d'arrivée")).toBeNull();
    expect(honestWorkaround("Cibler les plus de 18 ans et demander l'autorisation")).toBe("Cibler les plus de 18 ans et demander l'autorisation");
  });

  it("adresse inventée retirée (et la ligne si c'était sa seule source)", () => {
    const known = knownUrlSet([BHW]);
    const r = stripUnknownUrls(`- Vrai (${BHW})\n- Faux (${INVENTED})\n- Mixte (${BHW}) (${INVENTED})`, known);
    expect(r.text).toBe(`- Vrai (${BHW})\n- Mixte (${BHW})`);
    expect(r.removed).toEqual([INVENTED, INVENTED]);
  });
});

describe("Stratège : réponses aux questions", () => {
  function marketData() {
    return createFakePrisma({
      trendEntry: [
        entry({ id: "u1", url: UGC, category: "AD_CREATIVE", summary: "Les vidéos qui filment l'écran d'un joueur marchent bien en casino en France.", relevanceScore: 9, verified: true }),
        entry({ id: "u2", url: REDDIT, category: "AD_BAN", summary: "Les pubs bonus sont souvent refusées par TikTok en France.", relevanceScore: 8, verified: false }),
        entry({ id: "old", url: "https://www.reddit.com/r/casino/old", summary: "Vieux post.", publishedAt: days(45), createdAt: days(45) }),
        entry({ id: "de", url: DATING_DE, market: "DATING", countries: ["DE"], summary: "Témoignages en Allemagne." }),
      ],
      complianceRule: [{ id: "r1", platform: "TIKTOK", market: "CASINO", country: "FR", rule: "TikTok bannit les comptes qui montrent un bonus.", riskLevel: "HIGH", evidence: [{ url: NEWS, date: "2026-10-21", description: "Article" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(3), sourceEntryId: null, createdAt: days(3), updatedAt: days(3) }],
    });
  }

  it("« qu'est-ce qui marche en casino en France ? » : réponse sourcée, adresse inventée retirée, non vérifié, avertissement", async () => {
    const prisma = marketData();
    const { d, llm } = deps(prisma, (req) => {
      expect(req.system).toBe(STRATEGIST_ANSWER_SYSTEM);
      const data = JSON.parse(req.user) as { DONNÉES: { veille: Array<{ url: string }>; regles: unknown[] } };
      expect(data.DONNÉES.veille.map((v) => v.url).sort()).toEqual([REDDIT, UGC].sort()); // 30 jours, casino, France
      expect(data.DONNÉES.regles).toHaveLength(1);
      return [
        "Voici ce qui marche en ce moment.",
        `- Les vidéos qui filment l'écran d'un joueur marchent bien (${UGC})`,
        `- Les pubs bonus se font souvent refuser par TikTok (${REDDIT})`,
        `- TikTok bannit les comptes qui montrent un bonus (${NEWS})`,
        `- Les influenceurs doublent les inscriptions (${INVENTED})`,
        "- Le casino en ligne est légal en France.",
        "En France, c'est illégal de faire de la pub casino sans licence.",
      ].join("\n");
    });
    const a = await answerMarketQuestion(d, { question: "Qu'est-ce qui marche en casino en France ?", market: "CASINO", countries: ["FR"] }, NOW);
    expect(llm.calls[0]!.model).toBe(PLANNER_MODEL);
    const text = plain(a.text);
    expect(text).toContain(UGC);
    expect(text).toContain(REDDIT);
    expect(text).not.toContain(INVENTED);
    expect(text).not.toContain("influenceurs");
    expect(text).not.toMatch(/Voici/);
    expect(hasLegalAdvice(text)).toBe(false);
    expect(text).toContain(LEGAL_REWRITE_SENTENCE);
    expect(text.trim().endsWith(LEGAL_DISCLAIMER)).toBe(true);
    const redditLine = text.split("\n").find((l) => l.includes(REDDIT))!;
    expect(redditLine).toContain("non vérifié");
    expect(text.split("\n").find((l) => l.includes(UGC))).not.toContain("non vérifié");
    expect(text.split("\n").length).toBeLessThanOrEqual(20);
    expect(a.removedUrls).toEqual([INVENTED]);
    expect(a.usedEntryIds.sort()).toEqual(["u1", "u2"]);
    expect(a.usedRuleIds).toEqual(["r1"]);
    expect(a.sources.map((s) => s.url).sort()).toEqual([NEWS, REDDIT, UGC].sort());
  });

  it("aucune donnée : réponse honnête sans appel à l'IA, propose une recherche", async () => {
    const { d, llm } = deps(createFakePrisma(), () => "ne doit pas être appelé");
    const a = await answerMarketQuestion(d, { question: "Quelles tendances paris sportifs en Allemagne ?", market: "SPORTS", countries: ["DE"] }, NOW);
    expect(llm.calls).toHaveLength(0);
    expect(a.noData).toBe(true);
    expect(a.suggestSearch).toBe(true);
    expect(plain(a.text)).toBe("Je n'ai encore rien lu de solide sur le paris sportifs en Allemagne ces 30 derniers jours. Tu veux que je lance une recherche ?");
    expect(voiceCheck(a.text).problems).toEqual([]);
  });

  it("plafond atteint : erreur claire AVANT l'appel", async () => {
    const prisma = marketData();
    prisma._tables.agentUsage = [{ id: "u", teamKey: ANALYSTS_TEAM_KEY, provider: "llm", month: "2026-10", cents: 3000, calls: 10, alerted80: true, alerted100: true }];
    const { d, llm } = deps(prisma, () => "x");
    await expect(answerMarketQuestion(d, { question: "casino France", market: "CASINO", countries: ["FR"] }, NOW)).rejects.toMatchObject({ code: "budget" });
    expect(llm.calls).toHaveLength(0);
  });

  it("Opus en échec : erreur, aucun autre modèle essayé ; la dépense est comptée sinon", async () => {
    const prisma = createFakePrisma();
    const { d, llm } = deps(prisma, () => new Error("délai dépassé"));
    const err = await callAnalystsTask(d, "strategy", { system: "s", user: "u" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalystsAiError);
    expect((err as AnalystsAiError).code).toBe("ai_failed");
    expect(llm.calls.map((c) => c.model)).toEqual([PLANNER_MODEL]);
    const ok = deps(prisma, () => "réponse");
    await callAnalystsTask(ok.d, "weekly_report", { system: "s", user: "u" });
    expect(ok.llm.calls[0]!.model).toBe(QUALITY_MODEL);
    expect(prisma._tables.agentUsage![0]).toMatchObject({ teamKey: ANALYSTS_TEAM_KEY, provider: "llm", cents: 3, calls: 1 });
  });
});

// ------------------------------------------------------------------------------------- synthèse et rapport

function weekData() {
  return createFakePrisma({
    trendEntry: [
      entry({ id: "c1", url: UGC, category: "AD_CREATIVE", summary: "Les vidéos qui filment l'écran d'un joueur marchent bien en casino en France.", relevanceScore: 9, verified: true }),
      entry({ id: "c2", url: REDDIT, category: "AD_BAN", summary: "Les pubs bonus sont refusées par TikTok en France.", relevanceScore: 8 }),
      entry({ id: "d1", url: DATING_DE, market: "DATING", countries: ["DE"], category: "AD_STRATEGY", summary: "Les témoignages vidéo coûtent moins cher en Allemagne.", relevanceScore: 7 }),
    ],
    complianceRule: [
      { id: "r1", platform: "TIKTOK", market: "CASINO", country: "FR", rule: "TikTok bannit les comptes qui montrent un bonus de casino.", riskLevel: "BAN", evidence: [{ url: NEWS, date: "2026-10-21", description: "Article" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(3), sourceEntryId: null, createdAt: days(3), updatedAt: days(3) },
      { id: "r2", platform: "META", market: "CASINO", country: "ALL", rule: "Meta exige une autorisation écrite.", riskLevel: "HIGH", evidence: [{ url: META_PAGE, date: null, description: "Page" }], verified: false, workaround: null, isActive: true, lastVerifiedAt: days(40), sourceEntryId: null, createdAt: days(40), updatedAt: days(40) },
    ],
  });
}

const SYNTHESIS_JSON = JSON.stringify({
  groups: [
    {
      market: "CASINO",
      country: "FR",
      trends: [
        { text: "Les vidéos d'écran de joueur marchent bien.", urls: [UGC] },
        { text: "Les pubs bonus se font refuser sur TikTok.", urls: [REDDIT] },
        { text: "Tendance inventée.", urls: [INVENTED] },
      ],
      internal: null,
      recommendations: [
        { title: "Vidéo d'écran de joueur sans bonus", description: "Filmer une vraie partie, sans montrer de bonus.", adType: "UGC", angle: "TEMOIGNAGE", format: "15 s, 9:16, sous-titres, voix", platform: "META", countries: ["FR"], risk: "LOW", priority: 1, urls: [UGC] },
        { title: "Pub bonus sur TikTok", description: "Mettre le bonus en avant.", adType: "VIDEO", angle: "BONUS", format: "10 s", platform: "TIKTOK", countries: ["FR"], risk: "MEDIUM", priority: 2, urls: [REDDIT] },
        { title: "Influenceurs", description: "Payer des influenceurs.", adType: "VIDEO", angle: "AUTRE", format: "30 s", platform: null, countries: ["FR"], risk: "LOW", priority: 3, urls: [INVENTED] },
      ],
    },
    {
      market: "DATING",
      country: "DE",
      trends: [{ text: "Les témoignages vidéo coûtent moins cher.", urls: [DATING_DE] }],
      internal: null,
      recommendations: [{ title: "Témoignage vidéo de couple", description: "Un couple raconte sa rencontre.", adType: "VIDEO", angle: "TEMOIGNAGE", format: "20 s, 9:16", platform: "TIKTOK", countries: ["DE"], risk: "LOW", priority: 1, urls: [DATING_DE] }],
    },
  ],
});

describe("Stratège : synthèse de la semaine", () => {
  it("produit des recommandations market_analysis sourcées, jamais BAN, risque le plus prudent, rien d'appliqué", async () => {
    const prisma = weekData();
    const { d, llm } = deps(prisma, (req) => {
      expect(req.system).toBe(STRATEGIST_WEEKLY_SYSTEM);
      return SYNTHESIS_JSON;
    });
    const s = await weeklySynthesis(d, NOW);
    expect(llm.calls.map((c) => c.model)).toEqual([PLANNER_MODEL]);
    const recs = prisma._tables.recommendation!;
    expect(recs).toHaveLength(2);
    for (const r of recs) expect(r).toMatchObject({ teamKey: "analystes", source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED", target: "MARKET", size: "BIG" });
    for (const r of recs) expect(r.appliedAt ?? null).toBeNull();
    expect(recs.map((r) => (r.after as { title: string }).title).sort()).toEqual(["Témoignage vidéo de couple", "Vidéo d'écran de joueur sans bonus"]);
    // « Pub bonus sur TikTok » : la règle TikTok France est BAN → jamais recommandée. Meta : HIGH → risque relevé.
    const meta = recs.find((r) => (r.after as { platform: string }).platform === "META")!;
    expect((meta.after as { risk: string }).risk).toBe("HIGH");
    expect((meta.evidence as { sources: Array<{ url: string }> }).sources.map((x) => x.url)).toEqual([UGC]);
    const casino = s.groups.find((g) => g.market === "CASINO" && g.country === "FR")!;
    expect(casino.trends.map((t) => t.sources[0]!.url)).toEqual([UGC, REDDIT]);
    expect(casino.topRule?.id).toBe("r1");
    expect(s.recommendations.map((r) => r.number)).toEqual([1, 2]);
    // Relancée : mise à jour, pas de doublon.
    await weeklySynthesis(d, NOW);
    expect(prisma._tables.recommendation).toHaveLength(2);
  });
});

describe("Rapporteur : rapport de la semaine et briefing", () => {
  it("rapport hebdo écrit par le code quand la rédaction de l'IA est refusée (emojis, adresse inventée) : format, longueur, voix", async () => {
    const prisma = weekData();
    const { d, llm } = deps(prisma, (req) => (req.system === STRATEGIST_WEEKLY_SYSTEM ? SYNTHESIS_JSON : `📊 Rapport\n🎰 Casino\n- truc (${INVENTED})`));
    const r = await buildWeeklyReport(d, NOW, { siteUrl: "https://app.linkaffipro.com/agents/analyses" });
    expect(llm.calls.map((c) => c.model)).toEqual([PLANNER_MODEL, QUALITY_MODEL]);
    expect(llm.calls[1]!.system).toBe(REPORTER_WEEKLY_SYSTEM);
    expect(r.writtenBy).toBe("code");
    expect(r.rejected.length).toBeGreaterThan(0);
    const text = plain(r.text);
    const week = isoWeekOf("2026-10-26").week;
    expect(week).toBe(44);
    expect(text.startsWith(`Rapport de la semaine ${week}`)).toBe(true);
    expect(text.indexOf("Casino")).toBeLessThan(text.indexOf("Paris sportifs"));
    expect(text.indexOf("Paris sportifs")).toBeLessThan(text.indexOf("Rencontres"));
    expect(text).toContain(`- Les vidéos d'écran de joueur marchent bien (${UGC})`);
    expect(text).toContain(`- Les pubs bonus se font refuser sur TikTok, non vérifié (${REDDIT})`);
    expect(text).toContain("⚠️ TikTok : TikTok bannit les comptes qui montrent un bonus de casino. Risque : BAN.");
    expect(text).toContain("→ Recommandation : Vidéo d'écran de joueur sans bonus");
    expect(text).toContain("Paris sportifs\n- Rien de nouveau lu cette semaine.");
    expect(text).toContain("1 nouvelle règle compliance ajoutée.");
    expect(text).toContain(LEGAL_DISCLAIMER);
    expect(text.trim().endsWith("Détail complet sur le site : https://app.linkaffipro.com/agents/analyses")).toBe(true);
    expect(text).not.toContain(INVENTED);
    expect(text.length).toBeLessThanOrEqual(WEEKLY_REPORT_MAX_CHARS);
    expect(voiceCheck(r.text, { allowList: true, allowLong: true }).problems).toEqual([]);
    const saved = prisma._tables.strategyReport![0]!;
    expect(saved).toMatchObject({ reportType: "WEEKLY", period: "2026-W44", market: null });
    expect((saved.recommendations as unknown[]).length).toBe(2);
  });

  it("rapport hebdo rédigé par l'IA accepté s'il respecte tout", async () => {
    const prisma = weekData();
    const site = "https://app.linkaffipro.com/agents/analyses";
    const good = [
      "Rapport de la semaine 44",
      "",
      "Casino",
      `- Les vidéos d'écran de joueur cartonnent (${UGC})`,
      `⚠️ TikTok bannit les comptes qui montrent un bonus. Risque : BAN. Source : ${NEWS}`,
      "→ Recommandation : vidéo d'écran de joueur sans bonus",
      "",
      "Paris sportifs",
      "- Rien de nouveau lu cette semaine.",
      "",
      "Rencontres",
      `- Les témoignages vidéo coûtent moins cher en Allemagne, non vérifié (${DATING_DE})`,
      "",
      "1 nouvelle règle compliance ajoutée.",
      LEGAL_DISCLAIMER,
      `Détail complet sur le site : ${site}`,
    ].join("\n");
    const { d } = deps(prisma, (req) => (req.system === STRATEGIST_WEEKLY_SYSTEM ? SYNTHESIS_JSON : good));
    const r = await buildWeeklyReport(d, NOW, { siteUrl: site });
    expect(r.rejected).toEqual([]);
    expect(r.writtenBy).toBe("ai");
    expect(plain(r.text)).toBe(good);
  });

  it("plafond atteint : rapport écrit par le code, aucun appel", async () => {
    const prisma = weekData();
    prisma._tables.agentUsage = [{ id: "u", teamKey: ANALYSTS_TEAM_KEY, provider: "web", month: "2026-10", cents: 5000, calls: 1, alerted80: true, alerted100: true }];
    const { d, llm } = deps(prisma, () => "x");
    const r = await buildWeeklyReport(d, NOW);
    expect(llm.calls).toHaveLength(0);
    expect(r.writtenBy).toBe("code");
    expect(plain(r.text)).toContain(`(${UGC})`);
    expect(r.errors[0]).toMatch(/Plafond/);
  });

  it("briefing casino Allemagne : StrategyReport ON_DEMAND focalisé", async () => {
    const prisma = createFakePrisma({
      trendEntry: [entry({ id: "g1", url: "https://www.gamblinginsider.com/de/slots-ads", countries: ["DE"], summary: "Les pubs de machines à sous sont très limitées en Allemagne.", relevanceScore: 8, verified: true })],
    });
    const { d } = deps(prisma, () => `- Les pubs de machines à sous passent très mal en Allemagne (https://www.gamblinginsider.com/de/slots-ads)`);
    const b = await buildBriefing(d, { market: "CASINO", countries: ["DE"], requestedBy: "123" }, NOW);
    const text = plain(b.text);
    expect(text.split("\n")[0]).toBe("Briefing casino, Allemagne");
    expect(text).toContain("https://www.gamblinginsider.com/de/slots-ads");
    expect(text).toContain(LEGAL_DISCLAIMER);
    expect(prisma._tables.strategyReport![0]).toMatchObject({ reportType: "ON_DEMAND", market: "CASINO", countries: ["DE"], requestedBy: "123" });
  });
});

describe("Alertes et voix de Kevin", () => {
  it("tendance virale : « 🔥 Tendance : … — url », non vérifié dit", () => {
    const a = alertFor({ id: "e1", summary: "Les vidéos d'écran de joueur explosent sur TikTok en Espagne.", url: UGC, verified: false });
    expect(a.kind).toBe("trend");
    expect(plain(a.text)).toMatch(/^🔥 Tendance( du moment)? : Les vidéos d'écran de joueur explosent sur TikTok en Espagne\. \(non vérifié\) — https:/);
    expect(voiceCheck(a.text).problems).toEqual([]);
  });

  it("toutes les variantes des alertes passent voiceCheck", () => {
    for (const [key, entry] of Object.entries(ALERT_VARIANTS)) {
      const { texts, rules } = voiceEntryTexts(entry);
      for (const t of texts) expect(voiceCheck(t, rules).problems, `${key} : ${t}`).toEqual([]);
    }
  });
});
