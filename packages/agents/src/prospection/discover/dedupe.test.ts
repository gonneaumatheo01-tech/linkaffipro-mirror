import { describe, expect, it } from "vitest";
import { PROSPECTION_SETTINGS, type Candidate } from "../contract";
import { upsertCandidates } from "./dedupe";
import { discoverKit } from "./testing";

const run = { sourceType: "DIRECTORY", sourceDetail: "test", languages: ["fr"], vertical: "SPORTS" };
const dir = (url: string, extra: Partial<Candidate> = {}): Candidate => ({ url, sourceType: "DIRECTORY", sourceDetail: "https://tgstat.com/x", ...extra });

describe("upsertCandidates", () => {
  it("normalise, un channelUrl unique, journal, événements, enrichissement enfilé", async () => {
    const k = discoverKit();
    const r = await upsertCandidates(k.deps, [dir("@Pronos_Du_Coin", { announcedSubscribers: 17000, title: "Pronos" }), dir("https://t.me/s/pronos_du_coin"), dir("t.me/le_tipster"), dir("t.me/aide_bot"), dir("t.me/addlist/PaRiS42xyz")], run);
    expect(r).toMatchObject({ found: 3, newCount: 2, duplicates: 1, paused: false, errors: [] });
    expect(k.prospects().map((p) => [p.channelUrl, p.username, p.status, p.sourceType, p.subscribers ?? null])).toEqual([
      ["https://t.me/pronos_du_coin", "pronos_du_coin", "DISCOVERED", "DIRECTORY", null],
      ["https://t.me/le_tipster", "le_tipster", "DISCOVERED", "DIRECTORY", null],
    ]);
    expect(k.events().filter((e) => e.type === "DISCOVERED")).toHaveLength(2);
    expect((k.events()[0]!.payload as { announcedSubscribers: number }).announcedSubscribers).toBe(17000);
    expect(k.runs()[0]).toMatchObject({ sourceType: "DIRECTORY", found: 3, newCount: 2, duplicates: 1 });
    expect(k.runs()[0]!.finished).toBeInstanceOf(Date);
    expect(k.jobs.map((j) => j.opts?.jobId)).toEqual(k.prospects().map((p) => `prospection.enrich:${p.id}`));
  });

  it("lien d'invitation → UNREADABLE immédiat, jamais enfilé ; place de marché gardée", async () => {
    const k = discoverKit();
    await upsertCandidates(k.deps, [dir("https://t.me/+AbCdEf123456"), dir("t.me/bonus_casino_fr", { marketplace: { url: "https://telega.io/channels/bonus_casino_fr/card", price: "40 €" } })], run);
    const [inv, mk] = k.prospects();
    expect(inv).toMatchObject({ channelUrl: "https://t.me/+AbCdEf123456", username: null, status: "UNREADABLE" });
    expect(mk!.monetization).toEqual({ marketplaceListing: "https://telega.io/channels/bonus_casino_fr/card", adPrice: "40 €", sellsAds: true });
    expect(k.jobs.map((j) => (j.job as { prospectId: string }).prospectId)).toEqual([mk!.id]);
  });

  it("cocitations : +1 par canal d'origine, une seule fois ; liste noire ignorée", async () => {
    const k = discoverKit({ seed: { prospect: [{ id: "black", channelUrl: "https://t.me/noir_canal", username: "noir_canal", status: "BLACKLISTED", priority: 0, cocitationCount: 0, sourceType: "DIRECTORY", discoveredAt: new Date(0) }] } });
    const g = (from: string) => ({ ...dir("t.me/cible_canal"), sourceType: "GRAPH_MENTION" as const, discoveredFromId: from, graphDepth: 1 });
    await upsertCandidates(k.deps, [g("srcA")], run);
    const cible = () => k.prospects().find((p) => p.username === "cible_canal")!;
    expect(cible()).toMatchObject({ cocitationCount: 1, priority: 1, graphDepth: 1, discoveredFromId: "srcA" });
    await upsertCandidates(k.deps, [g("srcA")], run); // même origine : pas compté deux fois
    expect(cible().cocitationCount).toBe(1);
    const r = await upsertCandidates(k.deps, [g("srcB"), { ...dir("t.me/noir_canal"), discoveredFromId: "srcB" }], run);
    expect(r).toMatchObject({ newCount: 0, duplicates: 2 });
    expect(cible()).toMatchObject({ cocitationCount: 2, priority: 2 });
    expect(k.prospects().find((p) => p.id === "black")).toMatchObject({ cocitationCount: 0, status: "BLACKLISTED" });
    expect(k.events().filter((e) => e.type === "COCITED" && e.prospectId === cible().id).map((e) => (e.payload as { fromId: string }).fromId)).toEqual(["srcA", "srcB"]);
  });

  it("plafond journalier (depuis minuit Paris) ; le manuel passe outre", async () => {
    const k = discoverKit({
      seed: {
        setting: [{ key: PROSPECTION_SETTINGS.discoveryDailyCap.key, value: 3 }],
        // Créé hier soir à 23 h 30 Paris : ne compte pas ; créé ce matin : compte.
        prospect: [
          { channelUrl: "https://t.me/hier_soir", username: "hier_soir", status: "DISCOVERED", priority: 0, cocitationCount: 0, sourceType: "DIRECTORY", discoveredAt: new Date("2026-10-26T22:30:00Z") },
          { channelUrl: "https://t.me/ce_matin", username: "ce_matin", status: "DISCOVERED", priority: 0, cocitationCount: 0, sourceType: "DIRECTORY", discoveredAt: new Date("2026-10-26T23:30:00Z") },
        ],
      },
    });
    const r = await upsertCandidates(k.deps, ["aaaa1", "bbbb2", "cccc3"].map((n) => dir(`t.me/${n}`)), run);
    expect(r.newCount).toBe(2);
    expect(r.errors[0]).toMatch(/Plafond journalier atteint \(3/);
    const m = await upsertCandidates(k.deps, [{ url: "t.me/dddd4", sourceType: "MANUAL", sourceDetail: null }], run, { ignoreCap: true, by: "client" });
    expect(m.newCount).toBe(1);
    expect(k.prospects().find((p) => p.username === "dddd4")!.priority).toBe(10);
    expect(k.jobs.at(-1)!.opts).toMatchObject({ priority: 1 });
  });

  it("sans file (tests, outils) : rien n'est enfilé, pas d'erreur", async () => {
    const k = discoverKit();
    const r = await upsertCandidates({ ...k.deps, prospection: undefined }, [dir("t.me/abcdef")], run);
    expect(r.newCount).toBe(1);
    expect(k.jobs).toEqual([]);
  });
});
