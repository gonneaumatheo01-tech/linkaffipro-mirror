import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@linkaffipro/db";
import {
  LinkAffiClient,
  TELEGRAM_CAMPAIGNS_SETTING_KEY,
  parseTelegramCampaignsState,
} from "@linkaffipro/linkaffi";
import { runSync } from "../../src/sync/linkaffi-sync";
import { syncTelegramCampaigns } from "../../src/sync/linkaffi-telegram";
import { createBotAndChannel, resetDb } from "./helpers";

/**
 * Synchro des campagnes Telegram des affiliés (phase 13, D6) : base réelle, `stats-api` simulée par un serveur HTTP
 * local (aucun appel réel à Link Affi). Tables Telegram absentes, présentes, partielles ; Link Affi en panne.
 */

type Row = Record<string, unknown>;
const API_KEY = "lkst_test_telegram";
const ANON_KEY = "anon_test_telegram";
const SUB_ID = "SUBTGSYNC001";
const TG_UUID = "7c0f3d2a-1b2c-4d5e-8f90-112233445566";
const T0 = "2026-10-01T10:00:00.000Z";

/** `GET /stats-api` → liste des tables ; `GET /stats-api/<table>?limit&offset&eq.<col>=…` → page ; 404 si inconnue. */
function fakeStatsApi(tables: Record<string, Row[]>) {
  const state = { down: false, requests: [] as URL[] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    state.requests.push(url);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") return send(405, { error: "lecture seule" });
    if (state.down) return send(500, { error: "panne" });
    if (req.headers["x-api-key"] !== API_KEY || req.headers["apikey"] !== ANON_KEY)
      return send(401, { error: "unauthorized" });
    const table = url.pathname.replace(/^\/stats-api\/?/, "");
    if (!table) return send(200, { tables: Object.keys(tables) });
    const all = tables[table];
    if (!all) return send(404, { error: "unknown table" });
    const eq = [...url.searchParams].filter(([k]) => k.startsWith("eq."));
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
  return { server, state };
}

describe("synchro Link Affi : campagnes Telegram des affiliés (base réelle, API simulée)", () => {
  let server: Server;
  let api: ReturnType<typeof fakeStatsApi>["state"];
  let client: LinkAffiClient;
  const tables: Record<string, Row[]> = {};

  const offerRow = {
    id: "camp-1",
    campaign_key: "OFFRE001",
    casino_id: "cas-1",
    name: "Offre casino",
    domain: null,
    created_at: T0,
  };
  const telegramRow = {
    id: TG_UUID,
    campaign_key: "tgPaul01",
    name: "Paul VIP",
    type: "telegram",
    casino_id: null,
    affiliate_id: "aff-paul",
    invite_link_id: "",
    channel_id: "",
    is_active: true,
    created_at: T0,
  };
  const player = (extra: Row = {}): Row => ({
    id: "pl-1",
    casino_id: "cas-1",
    campaign_id: "camp-1",
    external_player_id: "EXT-TG-1",
    sub_id: SUB_ID,
    sub_id_source: "postback",
    status: "ftd_qualified",
    ftd_amount: 30,
    ftd_at: T0,
    all_deposits_count: 1,
    total_deposited_amount: 30,
    created_at: T0,
    updated_at: T0,
    ...extra,
  });
  const otherPlayer: Row = {
    id: "pl-2",
    casino_id: "cas-1",
    campaign_id: "camp-1",
    external_player_id: "EXT-TG-2",
    status: "registered",
    created_at: T0,
    updated_at: T0,
  };

  /** Tables générales de Link Affi (sans rien de Telegram). */
  function baseTables(): Record<string, Row[]> {
    return {
      casinos: [{ id: "cas-1", name: "Casino", is_active: true, updated_at: T0 }],
      campaigns: [offerRow],
      currency_rates: [],
      players: [player(), otherPlayer],
      player_events: [],
      player_financials: [],
      revshare_snapshots: [],
      deposit_snapshots: [],
      ftd_invalidations: [],
      clicks: [{ id: "clk-1", campaign_id: "camp-1", sub_id: SUB_ID, created_at: T0 }],
      stats: [],
    };
  }
  function setTables(next: Record<string, Row[]>) {
    for (const k of Object.keys(tables)) delete tables[k];
    Object.assign(tables, next);
  }
  const telegramMembers: Row[] = [
    { campaign_key: "tgPaul01", telegram_user_id: 7001, username: "alice_tg", first_name: "Alice" },
    { campaign_key: "tgPaul01", telegram_user_id: 7002, username: "bob_tg", first_name: "Bob" },
    { telegram_campaign_id: TG_UUID, telegram_user_id: 7003, username: null, first_name: "Carl" },
  ];

  async function setting() {
    const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY } });
    return { raw: row?.value, state: parseTelegramCampaignsState(row?.value) };
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: TELEGRAM_CAMPAIGNS_SETTING_KEY } });
    const fake = fakeStatsApi(tables);
    server = fake.server;
    api = fake.state;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    // Client explicite vers le serveur simulé : jamais les variables d'environnement, jamais Link Affi.
    client = new LinkAffiClient({
      baseUrl: `http://127.0.0.1:${port}/stats-api`,
      apiKey: API_KEY,
      anonKey: ANON_KEY,
      minIntervalMs: 0,
      maxAttempts: 1,
    });

    // Notre côté : le lien d'invitation créé pour la campagne Telegram de Paul, trois membres rattachés (un autre non),
    // et un clic d'offre d'un membre rattaché, avec `tg`.
    const { bot, channel } = await createBotAndChannel();
    await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+tgPaulSync",
        name: "Paul VIP",
        kind: "LINKAFFI",
        createsJoinRequest: true,
        linkaffiCampaignKey: "tgPaul01",
        linkaffiCampaignName: "Paul VIP",
        linkaffiAffiliateId: "aff-paul",
        linkaffiAffiliateName: "Paul",
      },
    });
    const members = [];
    for (const [i, key] of (["tgPaul01", "tgPaul01", "tgPaul01", null] as const).entries())
      members.push(
        await prisma.member.create({
          data: {
            telegramUserId: BigInt(7001 + i),
            firstName: `M${i}`,
            linkaffiCampaignKey: key,
            linkaffiAffiliateId: key ? "aff-paul" : null,
            affiliateAttributedAt: key ? new Date(T0) : null,
          },
        }),
      );
    const link = await prisma.trackingLink.create({
      data: {
        slug: "tgsync01",
        kind: "OFFER",
        destinationTemplate: "https://linkaffi.me/go/OFFRE001?sub_id={subid}",
        label: "Offre",
      },
    });
    await prisma.click.create({
      data: {
        trackingLinkId: link.id,
        subId: SUB_ID,
        memberId: members[0]!.id,
        botId: bot.id,
        linkaffiTelegramCampaignKey: "tgPaul01",
      },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("tables Telegram absentes : synchro verte, aucune erreur, aucune table suivie de plus, indisponible", async () => {
    setTables(baseTables());
    const results = await runSync({ client, now: () => new Date("2026-10-14T10:00:00Z") });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.table)).not.toContain("telegram");
    const sources = (await prisma.syncState.findMany({ select: { source: true } })).map(
      (s) => s.source,
    );
    expect(sources.some((s) => s.includes("telegram"))).toBe(false);

    const { state } = await setting();
    expect(state).toMatchObject({
      available: false,
      error: null,
      checkedAt: "2026-10-14T10:00:00.000Z",
      syncedAt: "2026-10-14T10:00:00.000Z",
      sources: { campaigns: null, members: false, registrations: null, clicks: null },
      divergences: [],
    });
    // Notre campagne est listée avec nos chiffres ; ceux de Link Affi sont inconnus (null), jamais 0.
    expect(state?.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP",
      affiliateName: "Paul",
      isActive: true,
      clicks: null,
      members: null,
      registrations: null,
      ftds: null,
      ours: { members: 3, registrations: 1, ftds: 1 },
      linkaffi: false,
      platform: true,
    });
    // Aucune table Telegram demandée (absentes de la liste) ; seulement des lectures.
    expect(api.requests.some((u) => u.pathname.includes("telegram"))).toBe(false);
  });

  it("une synchro limitée à d'autres tables ne relit pas Link Affi pour les campagnes Telegram", async () => {
    const before = (await setting()).state?.checkedAt;
    await runSync({ client, tables: ["casinos"], now: () => new Date("2026-10-14T10:30:00Z") });
    expect((await setting()).state?.checkedAt).toBe(before);
  });

  it("tables présentes : la campagne Telegram n'est pas une offre, chiffres lus, comparés, sans écart", async () => {
    setTables({
      ...baseTables(),
      campaigns: [offerRow, telegramRow],
      players: [player({ tg: "tgPaul01" }), { ...otherPlayer, tg: null }],
      clicks: [
        { id: "clk-1", campaign_id: "camp-1", sub_id: SUB_ID, created_at: T0 },
        { id: "lc-1", campaign_id: TG_UUID, created_at: T0 },
        { id: "lc-2", campaign_id: TG_UUID, created_at: T0 },
      ],
      telegram_members: telegramMembers,
      telegram_member_events: [{ event_id: "lap_join_requested_x", type: "join_requested" }],
    });
    api.requests.length = 0;
    const results = await runSync({ client, now: () => new Date("2026-10-14T10:40:00Z") });
    expect(results.every((r) => r.ok)).toBe(true);

    expect(await prisma.affiliateCampaign.count({ where: { externalId: TG_UUID } })).toBe(0);
    expect(await prisma.affiliateCampaign.count({ where: { campaignKey: "tgPaul01" } })).toBe(0);

    const { raw, state } = await setting();
    expect(state).toMatchObject({
      available: true,
      error: null,
      syncedAt: "2026-10-14T10:40:00.000Z",
      sources: {
        campaigns: "campaigns",
        members: true,
        registrations: "players",
        clicks: "clicks",
      },
      divergences: [],
    });
    expect(state?.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP",
      affiliateId: "aff-paul",
      affiliateName: "Paul",
      isActive: true,
      clicks: 2,
      members: 3,
      registrations: 1,
      ftds: 1,
      ours: { members: 3, registrations: 1, ftds: 1 },
      linkaffi: true,
      platform: true,
    });
    // Jamais l'historique des membres, jamais de pseudo ni de prénom gardé.
    expect(api.requests.some((u) => u.pathname.endsWith("/telegram_member_events"))).toBe(false);
    expect(JSON.stringify(raw)).not.toMatch(/alice_tg|bob_tg|Alice|Carl/);
    // Comptage des clics du lien de l'affilié : filtre d'égalité sur la campagne.
    const count = api.requests.find(
      (u) => u.pathname.endsWith("/clicks") && u.searchParams.get("eq.campaign_id") === TG_UUID,
    );
    expect(count?.searchParams.get("limit")).toBe("1");
  });

  it("écarts : membres non reçus par Link Affi, joueur crédité à une autre campagne", async () => {
    setTables({
      ...baseTables(),
      campaigns: [offerRow, telegramRow],
      players: [player({ tg: "autreCle" }), { ...otherPlayer, tg: null }],
      clicks: [{ id: "lc-1", campaign_id: TG_UUID, created_at: T0 }],
      telegram_members: [],
    });
    // Le joueur doit être relu : nouvelle date de mise à jour.
    tables.players![0]!.updated_at = "2026-10-14T10:45:00.000Z";
    await runSync({ client, now: () => new Date("2026-10-14T10:55:00Z") });
    const { state } = await setting();
    expect(state?.campaigns.tgPaul01).toMatchObject({
      members: 0,
      registrations: 0,
      ftds: 0,
      clicks: 1,
    });
    expect(state?.campaigns.autreCle).toMatchObject({
      registrations: 1,
      ftds: 1,
      ours: { members: 0, registrations: 0, ftds: 0 },
      linkaffi: false,
      platform: false,
    });
    expect(state?.divergences).toEqual([
      { campaignKey: "tgPaul01", field: "members", ours: 3, theirs: 0 },
      { campaignKey: "autreCle", field: "registrations", ours: 0, theirs: 1 },
      { campaignKey: "autreCle", field: "ftds", ours: 0, theirs: 1 },
      { campaignKey: "tgPaul01", field: "registrations", ours: 1, theirs: 0 },
      { campaignKey: "tgPaul01", field: "ftds", ours: 1, theirs: 0 },
    ]);
  });

  it("tables partielles : membres seulement, inscriptions par les joueurs liés aux membres (lecture Telegram seule)", async () => {
    setTables({
      ...baseTables(),
      players: [player({ updated_at: "2026-10-14T11:00:00.000Z" }), otherPlayer],
      telegram_members: [
        { campaign_key: "tgPaul01", telegram_user_id: 7001, player_id: "pl-1" },
        { campaign_key: "tgPaul01", telegram_user_id: 7002, player_id: null },
        { campaign_key: "tgPaul01", telegram_user_id: 7003, player_id: null },
      ],
    });
    // Les joueurs gardent leur dernière copie (colonne `tg` de la lecture précédente) : on repart d'une copie sans.
    await prisma.$executeRaw`UPDATE "Player" SET "raw" = "raw" - 'tg'`;
    api.requests.length = 0;
    const r = await runSync({
      client,
      tables: ["telegram"],
      now: () => new Date("2026-10-14T11:10:00Z"),
    });
    expect(r).toEqual([]);
    // Lecture Telegram seule : liste des tables, `campaigns` (pas lue par ce passage), membres. Rien d'autre.
    expect(api.requests.map((u) => u.pathname.replace(/^\/stats-api\/?/, ""))).toEqual([
      "",
      "campaigns",
      "telegram_members",
    ]);
    const { state } = await setting();
    expect(state).toMatchObject({
      available: true,
      error: null,
      sources: { campaigns: null, members: true, registrations: "telegram_members", clicks: null },
      divergences: [],
    });
    expect(state?.campaigns.tgPaul01).toMatchObject({
      members: 3,
      registrations: 1,
      ftds: 1,
      clicks: null,
      linkaffi: false,
      ours: { members: 3, registrations: 1, ftds: 1 },
    });
  });

  it("Link Affi en panne : rien ne lève, la dernière lecture est gardée avec une raison lisible", async () => {
    const before = (await setting()).state;
    api.down = true;
    try {
      const outcome = await syncTelegramCampaigns({
        client,
        now: () => new Date("2026-10-14T11:30:00Z"),
      });
      expect(outcome.error).toBe(
        "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes.",
      );
    } finally {
      api.down = false;
    }
    const { state } = await setting();
    expect(state).toMatchObject({
      syncedAt: before?.syncedAt,
      checkedAt: "2026-10-14T11:30:00.000Z",
      available: true,
      error: "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes.",
    });
    expect(state?.campaigns).toEqual(before?.campaigns);
  });
});
