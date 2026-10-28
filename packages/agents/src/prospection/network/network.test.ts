/** Phase 32, chantier A — réseaux : chaque preuve, seuil de 4, fusion / séparation, propagation, Top 10 en une ligne, tri par valeur. */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation, voiceCheck } from "../../boss/voice";
import { buildDailyTop, sortForTopByValue } from "../pipeline/daily-top";
import { transitionProspect } from "../pipeline/status";
import { createProspectKit } from "../score/prospect-test-kit";
import { readWatchFixture } from "../watch/testing";
import { buildClusters, linkedPairs, pairEvidence, siteKey, type ClusterProspect } from "./cluster";
import { renderNetworkCard } from "./card";
import { mergeProspects, networkOf, propagateNetworkStatus, rebuildNetworks, splitProspect } from "./store";

beforeEach(() => resetVoiceRotation());

type Raw = Partial<ClusterProspect> & { id: string; username: string };
const fx = readWatchFixture<{ sets: Record<string, Raw[]> }>("networks.json");
const set = (name: string): ClusterProspect[] => fx.sets[name]!.map((p) => ({ contacts: [], description: null, promoCodes: [], forwardsFrom: {}, ...p }) as ClusterProspect);
const kinds = (a: ClusterProspect, b: ClusterProspect) => pairEvidence(a, b).map((e) => e.kind).sort();

describe("preuves de rapprochement", () => {
  it("même contact (+3) et même code promo (+2)", () => {
    const [a, b] = set("same_contact_and_code");
    expect(kinds(a!, b!)).toEqual(["same_contact", "same_promo_code"]);
  });
  it("même signature (+2) et même groupe lié (+3)", () => {
    const [a, b] = set("signature_and_group");
    expect(kinds(a!, b!)).toEqual(["same_linked_group", "same_signature"]);
  });
  it("transferts dans les deux sens (+2) et même site (+2)", () => {
    const [a, b] = set("cross_forwards_and_site");
    expect(kinds(a!, b!)).toEqual(["cross_forwards", "same_site"]);
  });
  it("transferts dans un seul sens : pas une preuve", () => {
    const [a, b] = set("one_way_forwards");
    expect(kinds(a!, b!)).toEqual([]);
  });
  it("cas limite à 3 points (site + description) : pas de réseau", () => {
    const list = set("limit_three_points");
    expect(kinds(list[0]!, list[1]!)).toEqual(["same_description", "same_site"]);
    expect(linkedPairs(list)).toEqual([]);
    expect(buildClusters(list)).toEqual([]);
  });
  it("site : page de liens gardée, marque et Telegram écartés", () => {
    expect(siteKey("https://linktr.ee/maxime")).toBe("linktr.ee/maxime");
    expect(siteKey("https://www.winamax.fr/promo")).toBeNull();
    expect(siteKey("https://t.me/x")).toBeNull();
    expect(siteKey("pronos-maison.fr")).toBe("pronos-maison.fr");
  });
});

describe("regroupement", () => {
  it("seuil de 4 : a + b (contact + code, 5 points) réunis ; c (contact seul, 3) et d (groupe lié seul, 3) : non", () => {
    const clusters = buildClusters(set("same_contact_and_code"));
    expect(clusters.map((c) => c.members)).toEqual([["a", "b"]]);
    expect(clusters[0]!.evidence.length).toBeGreaterThan(0);
  });
  it("une paire séparée par le client n'est jamais réunie", () => {
    const clusters = buildClusters(set("same_contact_and_code"), { splitPairs: [["a", "b"]] });
    for (const c of clusters) expect(c.members.includes("a") && c.members.includes("b")).toBe(false);
  });
  it("groupe du client gardé même sans preuve", () => {
    const clusters = buildClusters(set("one_way_forwards"), { manualGroups: [["o1", "o2"]] });
    expect(clusters).toEqual([{ members: ["o1", "o2"], evidence: [], manual: true }]);
  });
});

async function seedNetwork(k: ReturnType<typeof createProspectKit>) {
  const ids: string[] = [];
  for (const [i, name] of ["pronos_a", "pronos_b", "pronos_c"].entries()) {
    const p = await k.prospect({ username: name, medianViews: 1800, tier: i === 0 ? "A" : "B", score: 80 - i * 5, countries: ["FR"], brands: [{ brand: "1xbet", promoCode: "MAXPRONO", intensity: "HEAVY" }] });
    await k.prisma.prospectContact.create({ data: { prospectId: p.id, type: "TELEGRAM_USERNAME", value: "@admin_pub", label: "pub", source: "description", confidence: "HIGH" } as never });
    ids.push(p.id);
  }
  return ids;
}

describe("réseaux en base", () => {
  it("reconstruction : 3 canaux, portée cumulée, puis séparation et fusion", async () => {
    const k = createProspectKit();
    const ids = await seedNetwork(k);
    const lonely = await k.prospect({ username: "solo_fr" });
    expect(await rebuildNetworks(k.deps)).toEqual({ networks: 1, members: 3 });
    const view = (await networkOf(k.deps, ids[0]!))!;
    expect(view.members).toHaveLength(3);
    expect(view.network.totalReach).toBe(5400);
    expect(view.network.mainContact).toBe("@admin_pub");
    expect(view.network.name).toBe("Réseau @admin_pub");
    expect(await networkOf(k.deps, lonely.id)).toBeNull();
    expect(k.events("NETWORK_JOINED")).toHaveLength(3);

    // « sépare @pronos_c » : ne revient jamais au prochain recalcul.
    expect((await splitProspect(k.deps, ids[2]!, "client")).ok).toBe(true);
    await rebuildNetworks(k.deps);
    expect((await k.row(ids[2]!)) as unknown as { networkId: string | null }).toMatchObject({ networkId: null });
    expect((await networkOf(k.deps, ids[0]!))!.members).toHaveLength(2);

    // « @pronos_c et @solo_fr c'est la même personne » : réseau du client, gardé au recalcul.
    const m = await mergeProspects(k.deps, [ids[2]!, lonely.id], "client");
    expect(m.ok).toBe(true);
    await rebuildNetworks(k.deps);
    const manual = (await networkOf(k.deps, lonely.id))!;
    expect(manual.network.origin).toBe("MANUAL");
    expect(manual.members.map((x) => x.id).sort()).toEqual([ids[2]!, lonely.id].sort());
  });

  it("propagation : un statut posé par le client sur un membre passe aux autres, avec un événement chacun", async () => {
    const k = createProspectKit();
    const ids = await seedNetwork(k);
    await rebuildNetworks(k.deps);
    const r = await transitionProspect(k.deps, ids[0]!, "CONTACTED", { by: "client" });
    expect(r.ok && r.propagated?.sort()).toEqual([ids[1]!, ids[2]!].sort());
    for (const id of ids) expect((await k.row(id)).status).toBe("CONTACTED");
    const viaNetwork = k.events("STATUS_CHANGED").filter((e) => (e.payload as Record<string, unknown>).via === "network");
    expect(viaNetwork).toHaveLength(2);
    expect((await networkOf(k.deps, ids[0]!))!.network.status).toBe("CONTACTED");
    // Le système ne propage jamais.
    const k2 = createProspectKit();
    const ids2 = await seedNetwork(k2);
    await rebuildNetworks(k2.deps);
    await transitionProspect(k2.deps, ids2[0]!, "DISQUALIFIED", { by: "system" });
    expect((await k2.row(ids2[1]!)).status).toBe("QUALIFIED");
    // Propagation directe (Kevin, site).
    const out = await propagateNetworkStatus(k2.deps, (await networkOf(k2.deps, ids2[1]!))!.network.id, "SKIPPED", { by: "client" });
    expect(out.updated.length).toBe(3);
  });

  it("Top du jour : le réseau tient en une seule ligne, tous ses canaux présentés", async () => {
    const k = createProspectKit();
    const ids = await seedNetwork(k);
    await k.prospect({ username: "autre_fr", score: 70, tier: "A" });
    await rebuildNetworks(k.deps);
    const top = await buildDailyTop(k.deps, { count: 10, now: k.now() });
    expect(top.items).toHaveLength(2);
    const net = top.items.find((i) => i.networkId)!;
    expect(net.memberIds!.sort()).toEqual([...ids].sort());
    expect(net.html.split("\n")[0]).toBe("Réseau @admin_pub : 3 canaux FR, 5,4k vues/post cumulées");
    expect(voiceCheck(net.html).problems).toEqual([]);
    // L'en-tête compte les 4 canaux montrés (3 du réseau + 1), pas les 2 cartes.
    expect(top.header).toMatch(/\b4 canaux\b/);
  });

  it("carte de réseau avec valeur cumulée : fourchette, « estimation non calibrée »", () => {
    const html = renderNetworkCard({
      name: "Réseau @admin_pub",
      mainContact: "@admin_pub",
      totalReach: 5400,
      evidence: [{ a: "a", b: "b", kind: "same_contact", points: 3, detail: "même contact @admin_pub" }],
      members: [
        { handle: "@a", tier: "A", countries: ["FR"], medianViews: 2000, valueEstimate: { low: 400, base: 1000, high: 2200, calibratedBy: "default" } },
        { handle: "@b", tier: "B", countries: ["FR"], medianViews: 1800, valueEstimate: { low: 200, base: 500, high: 1100, calibratedBy: "default" } },
      ],
    });
    expect(html).toContain("600 € à 3 300 € par mois (estimation non calibrée)");
    expect(voiceCheck(html).problems).toEqual([]);
  });
});

describe("tri du Top : niveau puis valeur", () => {
  const r = (id: string, tier: "A" | "B", score: number, base?: number) => ({ id, tier, score, cocitationCount: 0, valueEstimate: base === undefined ? null : { base } });
  it("valeur probable avant le score dans un même niveau ; niveau d'abord", () => {
    const rows = [r("a1", "A", 90, 100), r("a2", "A", 70, 900), r("b1", "B", 99, 5000)];
    expect(sortForTopByValue(rows).map((x) => x.id)).toEqual(["a2", "a1", "b1"]);
  });
  it("sans aucune valeur : tri par score (phase 31)", () => {
    expect(sortForTopByValue([r("x", "A", 50), r("y", "A", 80)]).map((x) => x.id)).toEqual(["y", "x"]);
  });
  it("réglage tier_then_score : la valeur est ignorée", async () => {
    const k = createProspectKit();
    await k.prospect({ username: "haut_score", score: 90, valueEstimate: { base: 10 } } as never);
    await k.prospect({ username: "haute_valeur", score: 72, valueEstimate: { base: 5000 } } as never);
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items[0]!.html).toContain("haute_valeur");
    await k.prisma.setting.create({ data: { key: "prospection.daily_top_sort", value: "tier_then_score" } });
    expect((await buildDailyTop(k.deps, { count: 10, now: k.now() })).items[0]!.html).toContain("haut_score");
  });
});
