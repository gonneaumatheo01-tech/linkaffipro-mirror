/**
 * Gains (phase 10) sur base réelle, API Link Affi simulée :
 * - CPA par joueur : +montant le jour du crédit, −montant le jour de l'annulation (événements CPA / CPA_REVERSAL,
 *   rejouables sans doublon) ;
 * - agrégat `stats` : seules les lignes de NOTRE affilié sont demandées et copiées (une ligne Link Affi = une ligne) ;
 * - statistiques journalières : `DailyStat.commissions` = CPA nette + part de revshare, par jour réel, nos offres
 *   seulement ; un jour ancien touché par la synchro est repris par le recalcul horaire (marque `dirtySince`) ;
 * - rapports Telegram : « Commissions » et « Gains » (commissions − dépense pub).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@linkaffipro/db";
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import { runSync } from "../../src/sync/linkaffi-sync";
import { DAILY_DIRTY_KEY, DAILY_LAST_RUN_KEY, recomputeDailyStats } from "../../src/stats/daily";
import { dayKey, parisMidnightUtc } from "../../src/stats/aggregate";
import { buildDailyData, shiftKey, utcDateOf } from "../../src/reports/build";
import { formatDailyBrief } from "../../src/reports/format";
import { resetDb } from "./helpers";

const API_KEY = "lkst_gains";
const ANON_KEY = "anon_gains";
type Row = Record<string, unknown>;

const now = new Date();
const todayKey = dayKey(now);
const yesterdayKey = shiftKey(todayKey, -1);
/** Jour du crédit : hors de la fenêtre habituelle de 3 jours du recalcul horaire. */
const creditKey = shiftKey(todayKey, -9);
const noon = (key: string) =>
  new Date(parisMidnightUtc(key).getTime() + 12 * 3_600_000).toISOString();
/** Minuit et 2 minutes à Paris (création habituelle d'une ligne `stats` du jour). */
const justAfterMidnight = (key: string) =>
  new Date(parisMidnightUtc(key).getTime() + 2 * 60_000).toISOString();

const tables: Record<string, Row[]> = {
  casinos: [{ id: "cas-g", name: "Celsius Paris sportifs", is_active: true }],
  campaigns: [
    {
      id: "camp-ours",
      campaign_key: "GAINS001",
      casino_id: "cas-g",
      affiliate_id: "aff-ours",
      name: "Notre offre",
    },
    {
      id: "camp-other",
      campaign_key: "GAINS002",
      casino_id: "cas-g",
      affiliate_id: "aff-other",
      name: "Offre d'un autre affilié",
    },
  ],
  currency_rates: [],
  players: [
    // Approuvé : +70 le jour du crédit.
    {
      id: "pl-a",
      casino_id: "cas-g",
      campaign_id: "camp-ours",
      affiliate_id: "aff-ours",
      external_player_id: "G1",
      status: "ftd_qualified",
      cpa_status: "approved",
      cpa_affiliate_amount: 70,
      cpa_credited_at: noon(creditKey),
      created_at: noon(creditKey),
      updated_at: noon(creditKey),
    },
    // Crédité puis annulé hier : +70 le jour du crédit, −70 hier.
    {
      id: "pl-r",
      casino_id: "cas-g",
      campaign_id: "camp-ours",
      affiliate_id: "aff-ours",
      external_player_id: "G2",
      status: "ftd_disqualified",
      cpa_status: "reversed",
      cpa_affiliate_amount: 70,
      cpa_credited_at: noon(creditKey),
      cpa_reversed_at: noon(yesterdayKey),
      disqualified_at: noon(yesterdayKey),
      created_at: noon(creditKey),
      updated_at: noon(yesterdayKey),
    },
    // Joueur d'un autre affilié (offre non rattachée) : importé, jamais compté.
    {
      id: "pl-x",
      casino_id: "cas-g",
      campaign_id: "camp-other",
      affiliate_id: "aff-other",
      external_player_id: "G3",
      status: "ftd_qualified",
      cpa_status: "approved",
      cpa_affiliate_amount: 500,
      cpa_credited_at: noon(yesterdayKey),
      created_at: noon(yesterdayKey),
      updated_at: noon(yesterdayKey),
    },
  ],
  player_events: [],
  player_financials: [],
  revshare_snapshots: [],
  deposit_snapshots: [],
  ftd_invalidations: [],
  clicks: [],
  stats: [
    // Ligne d'hier de notre offre (revshare fractionnaire, comme chez Link Affi).
    {
      id: "st-y",
      affiliate_id: "aff-ours",
      casino_id: "cas-g",
      campaign_id: "camp-ours",
      date: yesterdayKey,
      created_at: justAfterMidnight(yesterdayKey),
      revenue: 13.09,
      cpa_revenue: 0,
      revshare_revenue: 13.092594000000002,
    },
    // Correction créée aujourd'hui pour le jour du crédit : comptée aujourd'hui.
    {
      id: "st-c",
      affiliate_id: "aff-ours",
      casino_id: "cas-g",
      campaign_id: "camp-ours",
      date: creditKey,
      created_at: now.toISOString(),
      revenue: -2.5,
      cpa_revenue: 0,
      revshare_revenue: -2.5,
    },
    // Prime manuelle sans offre : copiée, ne compte dans aucune campagne.
    {
      id: "st-b",
      affiliate_id: "aff-ours",
      casino_id: "cas-g",
      campaign_id: null,
      date: yesterdayKey,
      created_at: noon(yesterdayKey),
      revenue: 200,
      cpa_revenue: 0,
      revshare_revenue: 0,
    },
    // Autre affilié : jamais demandé.
    {
      id: "st-o",
      affiliate_id: "aff-other",
      casino_id: "cas-g",
      campaign_id: "camp-other",
      date: yesterdayKey,
      created_at: justAfterMidnight(yesterdayKey),
      revenue: 900,
      cpa_revenue: 500,
      revshare_revenue: 400,
    },
  ],
};

/** Imitation de l'API de lecture : filtres `eq.<colonne>` appliqués, le reste ignoré (l'upsert rend la relecture sans risque). */
function fakeLinkAffi() {
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(url);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== API_KEY || req.headers["apikey"] !== ANON_KEY)
      return send(401, {});
    const table = url.pathname.replace(/^\/stats-api\/?/, "");
    const all = tables[table];
    if (!all) return send(404, { error: "unknown table" });
    const eq = [...url.searchParams.entries()].filter(([k]) => k.startsWith("eq."));
    const rows = all.filter((r) => eq.every(([k, v]) => String(r[k.slice(3)]) === v));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const slice = rows.slice(offset, offset + limit);
    return send(200, {
      table,
      total: rows.length,
      offset,
      limit,
      count: slice.length,
      rows: slice,
    });
  });
  return { server, requests };
}

async function clean() {
  await prisma.dailyStat.deleteMany();
  await prisma.affiliateDailyStat.deleteMany();
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.setting.deleteMany({
    where: { key: { in: [DAILY_DIRTY_KEY, DAILY_LAST_RUN_KEY] } },
  });
  await resetDb();
}

const stat = (dimension: string, key: string) =>
  prisma.dailyStat.findUnique({ where: { date_dimension: { date: utcDateOf(key), dimension } } });
const money = (row: { [k: string]: unknown } | null, k: string) => (row ? Number(row[k]) : null);
const client = () => new LinkAffiClient({ minIntervalMs: 0 });

describe("gains : commissions Link Affi jusqu'aux statistiques journalières (base réelle)", () => {
  let server: Server;
  let requests: URL[];
  let campaignId = "";

  beforeAll(async () => {
    await clean();
    const fake = fakeLinkAffi();
    server = fake.server;
    requests = fake.requests;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.LINKAFFI_API_URL = `http://127.0.0.1:${port}/stats-api`;
    process.env.LINKAFFI_API_KEY = API_KEY;
    process.env.LINKAFFI_ANON_KEY = ANON_KEY;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.LINKAFFI_API_URL;
    delete process.env.LINKAFFI_API_KEY;
    delete process.env.LINKAFFI_ANON_KEY;
    await clean();
  });

  it("synchro : CPA datées au crédit et à l'annulation ; lignes stats de notre affilié seulement", async () => {
    // Offres d'abord, puis notre campagne qui rattache la nôtre (comme l'équipe le fait dans l'assistant).
    await runSync({ client: client(), tables: ["casinos", "campaigns"] });
    const ours = await prisma.affiliateCampaign.findFirstOrThrow({
      where: { externalId: "camp-ours" },
    });
    const c = await prisma.campaign.create({
      data: { name: "Paris sportifs TikTok", vertical: "SPORTS", affiliateCampaignIds: [ours.id] },
    });
    campaignId = c.id;
    requests.length = 0;

    const results = await runSync({ client: client() });
    expect(results.every((r) => r.ok)).toBe(true);

    const reversed = await prisma.player.findFirstOrThrow({
      where: { externalPlayerId: "G2" },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });
    expect(reversed).toMatchObject({ cpaStatus: "reversed" });
    expect(Number(reversed.cpaAmount)).toBe(70);
    expect(reversed.cpaCreditedAt?.toISOString()).toBe(noon(creditKey));
    expect(reversed.cpaReversedAt?.toISOString()).toBe(noon(yesterdayKey));
    expect(
      reversed.events.map((e) => [
        e.type,
        Number(e.amount),
        e.occurredAt.toISOString(),
        e.externalId,
      ]),
    ).toEqual([
      ["CPA", 70, noon(creditKey), "cpa:pl-r"],
      ["CPA_REVERSAL", -70, noon(yesterdayKey), "cpa_reversal:pl-r"],
    ]);
    // Journal : les commissions et l'annulation de NOS joueurs seulement (Event append-only) ; celle du joueur de
    // l'autre affilié reste dans PlayerEvent, sans entrée de journal.
    const logged = await prisma.event.findMany({ where: { type: { startsWith: "player.cpa_" } } });
    expect(logged.map((e) => e.type).sort()).toEqual([
      "player.cpa_credited",
      "player.cpa_credited",
      "player.cpa_reversed",
    ]);
    const outsider = await prisma.player.findFirstOrThrow({
      where: { externalPlayerId: "G3" },
      include: { events: true },
    });
    expect(outsider.events.map((e) => [e.type, Number(e.amount)])).toEqual([["CPA", 500]]);

    // stats : uniquement notre affilié, une ligne Link Affi = une ligne, offre retrouvée, revshare à 4 décimales.
    const statsRequests = requests.filter((u) => u.pathname.endsWith("/stats"));
    expect(statsRequests.length).toBeGreaterThan(0);
    expect(statsRequests.every((u) => u.searchParams.get("eq.affiliate_id") === "aff-ours")).toBe(
      true,
    );
    const rows = await prisma.affiliateDailyStat.findMany({ orderBy: { externalId: "asc" } });
    expect(
      rows.map((r) => [r.externalId, r.affiliateCampaignId === ours.id, Number(r.revshareRevenue)]),
    ).toEqual([
      ["st-b", false, 0],
      ["st-c", true, -2.5],
      ["st-y", true, 13.0926],
    ]);

    // Le jour du crédit sort de la fenêtre de 3 jours : il est marqué à recalculer.
    const dirty = await prisma.setting.findUnique({ where: { key: DAILY_DIRTY_KEY } });
    expect(dirty?.value).toMatchObject({ day: creditKey });
  });

  it("statistiques journalières : commissions au jour réel, nos offres seulement ; jour ancien repris grâce à la marque", async () => {
    await recomputeDailyStats({ days: 3 });

    const credit = await stat("all", creditKey);
    expect(money(credit, "cpaCommissions")).toBe(140);
    expect(money(credit, "revshareCommissions")).toBe(0);
    expect(money(credit, "commissions")).toBe(140);

    // Hier : l'annulation (−70) et la part de revshare (+13,09) ; jamais les 500 € de l'autre affilié ni la prime.
    const y = await stat("all", yesterdayKey);
    expect(money(y, "cpaCommissions")).toBe(-70);
    expect(money(y, "revshareCommissions")).toBe(13.09);
    expect(money(y, "commissions")).toBe(-56.91);
    expect(money(await stat(`campaign:${campaignId}`, yesterdayKey), "commissions")).toBe(-56.91);
    expect(money(await stat("campaigns", yesterdayKey), "commissions")).toBe(-56.91);
    expect(money(await stat("vertical:SPORTS", yesterdayKey), "commissions")).toBe(-56.91);

    // La correction créée aujourd'hui compte aujourd'hui.
    expect(money(await stat("all", todayKey), "revshareCommissions")).toBe(-2.5);

    // Marque traitée : effacée.
    expect(await prisma.setting.findUnique({ where: { key: DAILY_DIRTY_KEY } })).toBeNull();
  });

  it("rapport du matin : commissions et gains (commissions − dépense pub), jamais le mot « bénéfice »", async () => {
    await prisma.adCost.create({
      data: {
        campaignId,
        levelKey: `campaign:${campaignId}`,
        date: utcDateOf(yesterdayKey),
        spend: 20,
        source: "MANUAL",
        currency: "EUR",
      },
    });
    await recomputeDailyStats({ days: 3 });
    const data = await buildDailyData(now);
    expect(data.current.commissions).toBe(-56.91);
    const text = formatDailyBrief(data);
    expect(text).toContain("Commissions : <b>−56,91 €</b>");
    expect(text).toContain("Gains : <b>−76,91 €</b>");
    expect(text).not.toMatch(/bénéfice/i);
  });

  it("second passage : rien n'est dupliqué, aucun jour n'est remarqué", async () => {
    const before = {
      events: await prisma.playerEvent.count({ where: { type: { in: ["CPA", "CPA_REVERSAL"] } } }),
      stats: await prisma.affiliateDailyStat.count(),
      logged: await prisma.event.count({ where: { type: { startsWith: "player.cpa_" } } }),
    };
    expect(before).toEqual({ events: 4, stats: 3, logged: 3 });
    const results = await runSync({ client: client(), full: true });
    expect(results.every((r) => r.ok)).toBe(true);
    expect({
      events: await prisma.playerEvent.count({ where: { type: { in: ["CPA", "CPA_REVERSAL"] } } }),
      stats: await prisma.affiliateDailyStat.count(),
      logged: await prisma.event.count({ where: { type: { startsWith: "player.cpa_" } } }),
    }).toEqual(before);
    expect(await prisma.setting.findUnique({ where: { key: DAILY_DIRTY_KEY } })).toBeNull();
  });
});
