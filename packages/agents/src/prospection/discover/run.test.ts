import { describe, expect, it } from "vitest";
import { QUERY_LANGUAGES } from "../dict";
import { PROSPECTION_SETTINGS } from "../contract";
import { addManualProspect } from "./manual";
import { pauseSource } from "./polite";
import { DISCOVERY_SHARES_SETTING, lotsPerSource, planDiscoveryLots, requestDiscovery, runDiscovery } from "./run";
import { DISCOVER_NOW, discoverKit, readProspectionFixture } from "./testing";

const DAY = 86_400_000;

describe("planDiscoveryLots", () => {
  it("4 langues par nuit, les 26 couvertes en 7 nuits, deux verticales, 4 sources ; même nuit = mêmes lots", async () => {
    const k = discoverKit();
    const seen = new Set<string>();
    for (let d = 0; d < 7; d++) {
      const at = new Date(DISCOVER_NOW.getTime() + d * DAY);
      const lots = await planDiscoveryLots(k.deps, at);
      expect(lots).toHaveLength(8);
      expect(new Set(lots.map((l) => l.vertical))).toEqual(new Set(["SPORTS", "CASINO"]));
      expect(new Set(lots.map((l) => l.source))).toEqual(new Set(["directories", "web_search", "social", "analysts"]));
      const langs = lots.find((l) => l.source === "web_search")!.languages;
      expect(langs).toHaveLength(4);
      langs.forEach((l) => seen.add(l));
      // Replanifier la même nuit ne fait pas avancer la rotation.
      expect(await planDiscoveryLots(k.deps, new Date(at.getTime() + 3600_000))).toEqual(lots);
    }
    expect([...seen].sort()).toEqual([...QUERY_LANGUAGES].sort());
  });

  it("prospection coupée → aucun lot ; une seule verticale réglée", async () => {
    const off = discoverKit({ seed: { setting: [{ key: PROSPECTION_SETTINGS.enabled.key, value: false }] } });
    expect(await planDiscoveryLots(off.deps, DISCOVER_NOW)).toEqual([]);
    const casino = discoverKit({ seed: { setting: [{ key: PROSPECTION_SETTINGS.verticals.key, value: ["CASINO"] }] } });
    expect(new Set((await planDiscoveryLots(casino.deps, DISCOVER_NOW)).map((l) => l.vertical))).toEqual(new Set(["CASINO"]));
  });
});

describe("répartition de la recherche (calibrage de la phase 32)", () => {
  it("sans réglage : 1 lot par source ; sous 10 % : aucun ; 30 % et plus : 2 lots", () => {
    expect(lotsPerSource(null)).toEqual({ directories: 1, web_search: 1, social: 1, analysts: 1 });
    expect(lotsPerSource({ directories: 0.05, web_search: 0.35, social: 0.2, graph: 0.2, analysts: 0.2 })).toEqual({ directories: 0, web_search: 2, social: 1, analysts: 1 });
    expect(lotsPerSource({ directories: 0, web_search: 0, social: 0, graph: 1, analysts: 0 })).toEqual({ directories: 0, web_search: 1, social: 0, analysts: 0 });
  });

  it("le plan de nuit suit la répartition acceptée ; le 2e lot lit d'autres langues", async () => {
    const k = discoverKit({ seed: { setting: [{ key: DISCOVERY_SHARES_SETTING, value: { directories: 0.05, web_search: 0.35, social: 0.2, graph: 0.2, analysts: 0.2 } }] } });
    const lots = (await planDiscoveryLots(k.deps, DISCOVER_NOW)).filter((l) => l.vertical === "SPORTS");
    expect(lots.map((l) => l.source)).toEqual(["web_search", "web_search", "social", "analysts"]);
    expect(lots[0]!.languages).not.toEqual(lots[1]!.languages);
  });
});

describe("runDiscovery", () => {
  it("annuaires → candidats dédoublonnés et journalisés", async () => {
    const no = { status: 404, body: "" };
    const k = discoverKit({
      routes: {
        "https://tgstat.com/robots.txt": no,
        "https://tgstat.com/gambling": { body: readProspectionFixture("directories/tgstat-gambling.html") },
        "https://telega.io/robots.txt": no,
        "https://telega.io/catalog?category=gambling&language=fr": { body: readProspectionFixture("directories/telega-catalog.html") },
      },
    });
    const r = await runDiscovery(k.deps, { source: "directories", languages: ["fr"], vertical: "CASINO" });
    expect(r.newCount).toBe(4);
    expect(r.paused).toBe(false);
    expect(k.runs()[0]).toMatchObject({ sourceType: "DIRECTORY", vertical: "CASINO", newCount: 4 });
    expect(k.prospects().every((p) => p.vertical === "CASINO" && p.sourceType === "DIRECTORY")).toBe(true);
  });

  it("source en pause → paused, aucune requête réseau, passage journalisé", async () => {
    const k = discoverKit();
    await pauseSource(k.deps, "web_search", "test");
    const r = await runDiscovery(k.deps, { source: "web_search", languages: ["fr"], vertical: "SPORTS" });
    expect(r).toMatchObject({ paused: true, newCount: 0 });
    expect(k.web.searches).toEqual([]);
    expect(k.web.fetches).toEqual([]);
    expect(k.runs()[0]!.pausedUntil).toBeInstanceOf(Date);
    const off = discoverKit({ seed: { setting: [{ key: PROSPECTION_SETTINGS.enabled.key, value: false }] } });
    expect((await runDiscovery(off.deps, { source: "social", languages: ["fr"], vertical: "SPORTS" })).paused).toBe(true);
    expect(off.web.searches).toEqual([]);
  });
});

describe("requestDiscovery", () => {
  it("« cherche des canaux casino en Pologne » : sources A à C en polonais, enfilées", async () => {
    const k = discoverKit();
    const r = await requestDiscovery(k.deps, { countries: ["pl"], vertical: "CASINO", requestId: "req1" });
    expect(r.languages).toEqual(["pl"]);
    expect(r.lots.map((l) => l.source)).toEqual(["directories", "web_search", "social"]);
    expect(r.lots.every((l) => l.countries?.[0] === "PL" && l.requestId === "req1")).toBe(true);
    expect(k.jobs.map((j) => j.opts?.jobId)).toEqual(["prospection.discover:req1:directories", "prospection.discover:req1:web_search", "prospection.discover:req1:social"]);
    const be = await requestDiscovery(k.deps, { countries: ["BE", "CH"], vertical: "SPORTS", requestId: "req2" });
    expect(be.languages).toEqual(["fr", "nl", "de", "it"]);
  });
});

describe("addManualProspect", () => {
  it("MANUAL, priorité 10, enrichi en priorité, hors plafond ; doublon, invitation, liste noire, texte illisible", async () => {
    const k = discoverKit({
      seed: {
        setting: [{ key: PROSPECTION_SETTINGS.discoveryDailyCap.key, value: 0 }],
        prospect: [{ id: "bl", channelUrl: "https://t.me/noir_canal", username: "noir_canal", status: "BLACKLISTED", priority: 0, cocitationCount: 0, sourceType: "DIRECTORY", discoveredAt: new Date(0) }],
      },
    });
    const a = await addManualProspect(k.deps, "https://t.me/s/Mon_Canal_Ami", "client");
    if (!a.ok) throw new Error(a.reason);
    expect(a).toMatchObject({ created: true, unreadable: false });
    expect(k.prospects().find((p) => p.id === a.prospectId)).toMatchObject({ sourceType: "MANUAL", priority: 10, status: "DISCOVERED" });
    expect(k.jobs.at(-1)).toMatchObject({ job: { type: "prospection.enrich", prospectId: a.prospectId }, opts: { priority: 1 } });
    expect(await addManualProspect(k.deps, { url: "@mon_canal_ami" }, "client")).toEqual({ ok: true, prospectId: a.prospectId, created: false, unreadable: false });
    expect(await addManualProspect(k.deps, "t.me/+AbCdEf123456", "client")).toMatchObject({ ok: true, created: true, unreadable: true });
    expect(await addManualProspect(k.deps, "@noir_canal", "client")).toMatchObject({ ok: false });
    expect(await addManualProspect(k.deps, "ceci n'est pas un canal", "client")).toMatchObject({ ok: false });
    expect(await addManualProspect(k.deps, "t.me/addlist/PaRiS42xyz", "client")).toMatchObject({ ok: false });
    expect(k.events().find((e) => e.type === "DISCOVERED" && e.prospectId === a.prospectId)!.payload).toMatchObject({ by: "client" });
  });
});
