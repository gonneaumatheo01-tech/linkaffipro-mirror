/** Phase 32, chantier A — suivi des affiliés signés : chaque alerte, preuves vérifiées, IA tenue par le code. */
import { describe, expect, it } from "vitest";
import { createProspectKit, fakeLlm } from "../score/prospect-test-kit";
import { DAY_MS } from "../score/settings";
import { codeAffiliateFindings, isOurLink, ourLinksStats, parseAffiliateWatch, watchAffiliate } from "./affiliates-watch";
import { postsOf, readWatchFixture, WATCH_NOW } from "./testing";

const fx = readWatchFixture<{ sets: Record<string, Array<{ text: string; links?: string[]; buttons?: Array<{ text: string; url: string }> }>> }>("affiliate-posts.json");
const posts = (name: string) => postsOf(fx.sets[name]!);
const offers = [{ brand: "Winamax", trackingHint: "abc123" }];

async function run(name: string, opts: { signedDaysAgo?: number; llm?: ReturnType<typeof fakeLlm> | null } = {}) {
  const k = createProspectKit(WATCH_NOW);
  k.deps.prospectionLlm = opts.llm === undefined ? null : opts.llm;
  await k.offer({ brand: "Winamax", trackingHint: "abc123" });
  const r = await watchAffiliate(k.deps, {
    prospect: { id: "p1", username: "pronos_fr", title: "Pronos", status: "SIGNED", signedAt: new Date(WATCH_NOW.getTime() - (opts.signedDaysAgo ?? 20) * DAY_MS), countries: ["FR"], vertical: "SPORTS" },
    posts: posts(name),
    now: WATCH_NOW,
  });
  return r;
}

describe("nos liens", () => {
  it("domaines Link Affi, go.goolink.eu, indice de suivi", () => {
    expect(isOurLink("https://linkaffi.me/go/x", [])).toBe(true);
    expect(isOurLink("https://go.goolink.eu/r/Ab", [])).toBe(true);
    expect(isOurLink("https://exemple.fr/?ref=abc123", ["abc123"])).toBe(true);
    expect(isOurLink("https://www.betano.com/?btag=1", ["abc123"])).toBe(false);
    expect(ourLinksStats(posts("with_our_links"), offers).postsWithOurLink).toBe(2);
  });
});

describe("alertes d'affilié", () => {
  it("avec nos liens : aucune alerte", async () => {
    expect((await run("with_our_links")).alerts).toEqual([]);
  });
  it("sans nos liens depuis 14 jours : AFFILIATE_NOT_POSTING ; signé depuis 10 jours : rien", async () => {
    expect((await run("without_links")).alerts.map((a) => a.kind)).toEqual(["AFFILIATE_NOT_POSTING"]);
    expect((await run("without_links", { signedDaysAgo: 10 })).alerts).toEqual([]);
  });
  it("pousse un concurrent : preuve de 15 mots au plus", async () => {
    const [a] = (await run("competitor")).alerts;
    expect(a!.kind).toBe("AFFILIATE_PUSHES_COMPETITOR");
    expect(a!.data.brand).toBe("Betano");
    expect(a!.evidence!.split(" ").length).toBeLessThanOrEqual(15);
    expect(a!.family).toBe("affiliate");
  });
  it("« gains garantis » : AFFILIATE_RISKY_CLAIM avec l'extrait", async () => {
    const [a] = (await run("guaranteed")).alerts;
    expect(a!.kind).toBe("AFFILIATE_RISKY_CLAIM");
    expect(a!.evidence).toContain("gains garantis");
    expect(a!.evidence!.split(" ").length).toBeLessThanOrEqual(15);
  });
  it("IA : preuve inventée ou marque absente écartée ; vraie preuve gardée ; modèle Sonnet", async () => {
    const llm = fakeLlm([
      JSON.stringify({ competitors: [{ brand: "Unibet", evidence: "jouez sur Unibet" }], risky: [{ type: "promise", evidence: "fonce les amis" }, { type: "minors", evidence: "dès 16 ans" }], our_brand_without_link: false }),
    ]);
    const r = await run("guaranteed", { llm });
    expect(llm.calls[0]!.model).toBe("claude-sonnet-5-5");
    expect(llm.calls[0]!.user).toContain("<donnees>");
    expect(r.ai).toBe("used");
    expect(r.alerts.map((a) => `${a.kind}:${String(a.data.type ?? a.data.brand)}`).sort()).toEqual(["AFFILIATE_RISKY_CLAIM:guaranteed", "AFFILIATE_RISKY_CLAIM:promise"]);
  });
  it("IA en panne : le code seul parle", async () => {
    const llm = { calls: [], async complete() { throw new Error("panne"); } };
    const r = await run("competitor", { llm: llm as never });
    expect(r.ai).toBe("failed");
    expect(r.alerts.map((a) => a.kind)).toEqual(["AFFILIATE_PUSHES_COMPETITOR"]);
  });
  it("réponse illisible de l'IA : rien", () => {
    expect(parseAffiliateWatch("pas du json", posts("guaranteed"), offers)).toEqual({ competitors: [], risky: [], ourBrandWithoutLink: false });
    expect(codeAffiliateFindings(posts("without_links"), offers)).toEqual({ competitors: [], risky: [] });
  });
});
