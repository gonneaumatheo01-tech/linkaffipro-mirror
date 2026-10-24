/**
 * Phase 24 : Agent Ads sur base réelle. Campagne, groupe, pubs, coûts et `DailyStat` de test → recommandations
 * attendues (arrêter la pub trop chère, augmenter celle qui rapporte, tester une variante) → rapport quotidien généré,
 * archivé et envoyé au faux Telegram → une recommandation marquée « Fait » (journal) et pas re-proposée → refus
 * d'appliquer → alerte « coût trop élevé » une seule fois → rapport de la semaine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  ADS_NEVER_APPLIED,
  applyRecommendation,
  computeAdsAnalysis,
  createFakeLlm,
  markAdsRecommendation,
  runAdsAlerts,
  runAdsDaily,
  runAdsWeekly,
  type EngineDeps,
} from "@linkaffipro/agents";
import { resetDb } from "./helpers";

// Samedi 24 octobre 2026, 12 h à Paris.
const NOW = new Date("2026-10-24T10:00:00Z");
const adminSent: string[] = [];
const deps: EngineDeps = {
  prisma,
  now: () => NOW,
  enqueue: { async orchestrator() {}, async step() {} },
  admin: {
    async send(html) {
      adminSent.push(html);
      return { messageId: 1 };
    },
  },
  providers: { llm: createFakeLlm() },
};

const day = (n: number) => new Date(Date.UTC(2026, 9, 23 - n));

async function cleanAds() {
  await prisma.dailyStat.deleteMany({});
  await prisma.adCost.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.alert.deleteMany({ where: { kind: { startsWith: "ads_" } } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "agents.ads" } } });
}

describe("Agent Ads : recommandations, rapport, « Fait », alertes (base réelle)", () => {
  let bad = "";
  let good = "";
  let adSetId = "";

  beforeAll(async () => {
    await resetDb();
    await cleanAds();
    const c = await prisma.campaign.create({ data: { name: "Casino test pubs", vertical: "CASINO", status: "ACTIVE", budgetDaily: 1000 } });
    const s = await prisma.adSet.create({ data: { campaignId: c.id, name: "Hommes 25-45" } });
    await prisma.adSet.create({ data: { campaignId: c.id, name: "Femmes 25-45" } });
    adSetId = s.id;
    bad = (await prisma.ad.create({ data: { adSetId: s.id, name: "Image bonus" } })).id;
    good = (await prisma.ad.create({ data: { adSetId: s.id, name: "Vidéo roulette" } })).id;
    // 14 jours : la pub « Image bonus » coûte 40 € par inscription sans rapporter ; « Vidéo roulette » rapporte 4 fois
    // sa dépense.
    for (let n = 0; n < 14; n++) {
      const date = day(n);
      for (const [adId, spend, commissions] of [[bad, 40, 0], [good, 20, 80]] as const) {
        await prisma.adCost.create({ data: { levelKey: `ad:${adId}`, date, source: "API", adId, adSetId: s.id, campaignId: c.id, spend, impressions: 2000, clicks: 50 } });
        await prisma.dailyStat.create({ data: { date, dimension: `ad:${adId}`, adId, spend, registrations: 1, joined: 3, requests: 4, entryClicks: 40, offerClicks: 5, commissions, cpaCommissions: commissions } });
      }
      await prisma.dailyStat.create({ data: { date, dimension: `campaign:${c.id}`, campaignId: c.id, spend: 60, registrations: 2, joined: 6, commissions: 80 } });
    }
  });

  afterAll(async () => {
    await cleanAds();
  });

  it("analyse : chiffres de la pub depuis DailyStat, gains = commissions − dépense", async () => {
    const a = await computeAdsAnalysis(prisma, { period: "7d", now: NOW });
    const row = a.rows.find((r) => r.id === good)!;
    expect(row.current).toMatchObject({ spend: 140, commissions: 560, gains: 420, roas: 4, costPerRegistration: 20, impressions: 14_000, adClicks: 350 });
    expect(row.enoughData).toBe(true);
    expect(a.connectorsMissing).toBe(true);
  });

  it("recommandations attendues, rapport quotidien archivé et envoyé", async () => {
    const r = await runAdsDaily(deps);
    const recs = await prisma.recommendation.findMany({ where: { teamKey: "ads", status: "PROPOSED" } });
    const keys = recs.map((x) => `${x.action}:${x.target}:${x.targetId}`).sort();
    expect(keys).toEqual([`SCALE:AD:${good}`, `STOP:AD:${bad}`, `TEST:AD:${good}`, `TEST:ADSET:${adSetId}`].sort());
    const stop = recs.find((x) => x.action === "STOP")!;
    expect((stop.evidence as { threshold: number }).threshold).toBe(30);
    expect((stop.evidence as { summary: string }).summary).toContain("40,00 € par inscription");
    expect(r.sent).toBe(true);
    expect(adminSent.at(-1)).toContain("Pubs");
    expect(adminSent.at(-1)).toContain("/agents/ads");
    expect(adminSent.at(-1)).toContain("1 à arrêter, 1 à augmenter, 2 à tester");
    const report = await prisma.insightReport.findUnique({ where: { teamKey_weekStart: { teamKey: "ads", weekStart: "2026-10-24" } } });
    expect(report?.sentAt).not.toBeNull();
    expect((report?.stats as { kind: string }).kind).toBe("daily");
  });

  it("« Fait » : journalisé, pas re-proposé ; jamais appliquée par la plateforme", async () => {
    const stop = await prisma.recommendation.findFirstOrThrow({ where: { teamKey: "ads", action: "STOP" } });
    const user = await prisma.user.findFirst();
    const res = await markAdsRecommendation(deps, { id: stop.id, status: "DONE", comment: "coupée chez TikTok" }, { userId: user?.id ?? null, via: "SITE" });
    expect(res.ok).toBe(true);
    expect(await prisma.recommendation.findUnique({ where: { id: stop.id } })).toMatchObject({ status: "DONE", comment: "coupée chez TikTok" });
    expect(await prisma.auditLog.count({ where: { action: "agents.ads.recommendation_done", entityId: stop.id } })).toBe(1);
    await runAdsDaily(deps, { send: false });
    expect(await prisma.recommendation.count({ where: { teamKey: "ads", action: "STOP" } })).toBe(1);
    expect(await prisma.recommendation.count({ where: { teamKey: "ads", action: "SCALE", status: "PROPOSED" } })).toBe(1);
    const scale = await prisma.recommendation.findFirstOrThrow({ where: { teamKey: "ads", action: "SCALE" } });
    expect(await applyRecommendation(deps, scale.id, { via: "SITE" })).toEqual({ ok: false, message: ADS_NEVER_APPLIED });
    expect((await prisma.recommendation.findUnique({ where: { id: scale.id } }))?.status).toBe("PROPOSED");
  });

  it("alerte « coût trop élevé » une seule fois par 24 h", async () => {
    const first = await runAdsAlerts(deps);
    expect(first.ads_cost_over_threshold).toMatchObject({ created: 1 });
    const again = await runAdsAlerts(deps);
    expect(again.ads_cost_over_threshold).toMatchObject({ created: 0 });
    expect(await prisma.alert.count({ where: { kind: "ads_cost_over_threshold", resolvedAt: null } })).toBe(1);
  });

  it("rapport de la semaine", async () => {
    const w = await runAdsWeekly(deps);
    expect(w.sent).toBe(true);
    expect(adminSent.at(-1)).toContain("semaine");
    expect(adminSent.at(-1)).toContain("Casino");
    expect(await prisma.insightReport.count({ where: { teamKey: "ads", weekStart: { startsWith: "semaine-" } } })).toBe(1);
  });
});
