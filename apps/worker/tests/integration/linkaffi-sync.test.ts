import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@linkaffipro/db";
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import { processSyncLinkaffi } from "../../src/processors/sync-linkaffi";
import { runSync } from "../../src/sync/linkaffi-sync";
import { capturedJobs, createBotAndChannel, fakeJob, resetDb } from "./helpers";

const SUB_ID = "SUBSYNC00001";
const API_KEY = "lkst_test_key";
const ANON_KEY = "anon_test_key";
const T0 = "2026-10-01T10:00:00.000Z";

type Row = Record<string, unknown>;

/**
 * Serveur HTTP qui imite l'API de lecture Link Affi (docs/LINKAFFI-API.md) : `GET /stats-api/<table>?limit&offset…`
 * répond `{ table, total, offset, limit, count, rows }`. Les lignes sont modifiables entre deux passages.
 */
function fakeLinkAffi(tables: Record<string, Row[]>) {
  const requests: Array<{ url: URL; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push({ url, headers: req.headers });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== API_KEY || req.headers["apikey"] !== ANON_KEY) return send(401, { error: "unauthorized" });
    const table = url.pathname.replace(/^\/stats-api\/?/, "");
    if (!table) return send(200, { tables: Object.keys(tables) });
    const rows = tables[table];
    if (!rows) return send(404, { error: "unknown table" });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const slice = rows.slice(offset, offset + limit);
    return send(200, { table, total: rows.length, offset, limit, count: slice.length, rows: slice });
  });
  return { server, requests };
}

describe("synchronisation Link Affi : joueurs rattachés par sub-ID (base réelle, API simulée)", () => {
  let server: Server;
  let requests: ReturnType<typeof fakeLinkAffi>["requests"];
  let memberId = "";
  let clickId = "";
  let postId = "";
  const tables: Record<string, Row[]> = {
    casinos: [{ id: "cas-1", name: "Casino Test", is_active: true, updated_at: T0 }],
    campaigns: [{ id: "camp-1", campaign_key: "KEY1", casino_id: "cas-1", name: "Campagne Telegram", domain: null, created_at: T0 }],
    currency_rates: [{ currency: "USD", rate: 1.25 }],
    players: [
      { id: "pl-1", casino_id: "cas-1", campaign_id: "camp-1", external_player_id: "EXT-1", sub_id: SUB_ID, sub_id_source: "postback", status: "active", ftd_amount: 50, ftd_at: T0, all_deposits_count: 1, total_deposited_amount: 50, redeposits_count: 0, created_at: T0, updated_at: T0 },
      // Joueur sans sub-ID : importé mais rattaché à personne.
      { id: "pl-2", casino_id: "cas-1", campaign_id: "camp-1", external_player_id: "EXT-2", sub_id: null, sub_id_source: null, status: "registered", created_at: T0, updated_at: T0 },
    ],
    player_events: [
      { id: "ev-1", player_id: "pl-1", casino_id: "cas-1", event: "registration", idempotency_key: "k-reg-1", created_at: T0 },
      { id: "ev-2", player_id: "pl-1", casino_id: "cas-1", event: "ftd", amount: 50, currency: "EUR", idempotency_key: "k-ftd-1", created_at: T0 },
    ],
    player_financials: [],
    revshare_snapshots: [],
    deposit_snapshots: [],
    ftd_invalidations: [],
    clicks: [{ id: "clk-1", campaign_id: "camp-1", casino_id: "cas-1", sub_id: SUB_ID, created_at: T0 }],
  };

  beforeAll(async () => {
    await resetDb();
    const fake = fakeLinkAffi(tables);
    server = fake.server;
    requests = fake.requests;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    // Les variables d'environnement pointent vers le serveur simulé (lues par `new LinkAffiClient()`).
    process.env.LINKAFFI_API_URL = `http://127.0.0.1:${port}/stats-api`;
    process.env.LINKAFFI_API_KEY = API_KEY;
    process.env.LINKAFFI_ANON_KEY = ANON_KEY;

    // Notre côté : un membre a cliqué une offre (sub-ID) depuis un message.
    const { bot, channel } = await createBotAndChannel();
    const member = await prisma.member.create({ data: { telegramUserId: 9090n, firstName: "Sam" } });
    memberId = member.id;
    const post = await prisma.post.create({ data: { code: "SYNCP0ST", channelId: channel.id, botId: bot.id, status: "SENT", text: "Offre", sentAt: new Date() } });
    postId = post.id;
    const link = await prisma.trackingLink.create({ data: { slug: "syncoff1", kind: "OFFER", destinationTemplate: "https://linkaffi.me/go/KEY1?sub_id={subid}", label: "Offre synchro", postId: post.id } });
    const click = await prisma.click.create({ data: { trackingLinkId: link.id, subId: SUB_ID, memberId: member.id, postId: post.id, botId: bot.id } });
    clickId = click.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.LINKAFFI_API_URL;
    delete process.env.LINKAFFI_API_KEY;
    delete process.env.LINKAFFI_ANON_KEY;
  });

  it("importe casinos, campagnes et joueurs, et rattache le joueur au membre par sub-ID", async () => {
    // Client sans attente entre requêtes (l'implémentation réelle attend 1 s) ; URL et clés viennent de l'environnement.
    const results = await runSync({ client: new LinkAffiClient({ minIntervalMs: 0 }) });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.find((r) => r.table === "players")?.rows).toBe(2);
    expect(requests.every((r) => r.headers["x-api-key"] === API_KEY)).toBe(true);

    const program = await prisma.affiliateProgram.findUniqueOrThrow({ where: { source_externalId: { source: "LINKAFFI", externalId: "cas-1" } } });
    expect(program.name).toBe("Casino Test");
    const campaign = await prisma.affiliateCampaign.findUniqueOrThrow({ where: { programId_externalId: { programId: program.id, externalId: "camp-1" } } });
    expect(campaign.campaignKey).toBe("KEY1");
    expect(campaign.trackingUrlTemplate).toBe("https://linkaffi.me/go/KEY1?sub_id={subid}");

    const player = await prisma.player.findUniqueOrThrow({ where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: campaign.id, externalPlayerId: "EXT-1" } }, include: { events: true } });
    expect(player.subId).toBe(SUB_ID);
    expect(player.subIdSource).toBe("postback");
    expect(player.memberId).toBe(memberId);
    expect(player.clickId).toBe(clickId);
    expect(player.registeredAt?.toISOString()).toBe(T0);
    expect(player.ftdAt?.toISOString()).toBe(T0);
    expect(Number(player.depositTotal)).toBe(50);
    expect(player.depositCount).toBe(1);
    expect(player.events.map((e) => e.type).sort()).toEqual(["FTD", "REGISTRATION"]);
    expect(Number(player.events.find((e) => e.type === "FTD")?.amount)).toBe(50);

    const orphan = await prisma.player.findUniqueOrThrow({ where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: campaign.id, externalPlayerId: "EXT-2" } } });
    expect(orphan.memberId).toBeNull();
    expect(orphan.subId).toBeNull();

    // Événements métier rattachés au membre et automatisations émises.
    const types = (await prisma.event.findMany({ where: { memberId } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["player.registered", "player.ftd"]));
    const triggers = capturedJobs("automations").filter((j) => j.data.memberId === memberId).map((j) => j.data.trigger);
    expect(triggers).toEqual(expect.arrayContaining(["REGISTERED", "DEPOSITED"]));

    // Statistiques du message recalculées depuis les joueurs rattachés.
    const stats = await prisma.postStats.findUniqueOrThrow({ where: { postId } });
    expect(stats.registrations).toBe(1);
    expect(stats.ftds).toBe(1);
    expect(stats.deposits).toBe(1);
    expect(Number(stats.depositAmount)).toBe(50);

    // Curseurs : chaque table a réussi, la table joueurs a une borne `since`.
    const state = await prisma.syncState.findUniqueOrThrow({ where: { source: "players" } });
    expect(state.lastSuccessAt).toBeInstanceOf(Date);
    expect(state.isRunning).toBe(false);
    expect(state.rowsImported).toBe(2);
    expect((state.cursor as { since?: string }).since).toBeTruthy();
  });

  it("un second passage est incrémental et idempotent", async () => {
    requests.length = 0;
    // Nouveau dépôt côté Link Affi.
    const p1 = tables.players![0]!;
    p1.all_deposits_count = 2;
    p1.total_deposited_amount = 80;
    p1.updated_at = "2026-10-02T10:00:00.000Z";

    const results = await runSync({ client: new LinkAffiClient({ minIntervalMs: 0 }) });
    expect(results.every((x) => x.ok)).toBe(true);
    const playersReq = requests.find((q) => q.url.pathname.endsWith("/players"));
    expect(playersReq?.url.searchParams.get("date_col")).toBe("updated_at");
    expect(playersReq?.url.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await prisma.player.count()).toBe(2);
    const player = await prisma.player.findFirstOrThrow({ where: { subId: SUB_ID } });
    expect(player.depositCount).toBe(2);
    expect(Number(player.depositTotal)).toBe(80);
    expect(player.memberId).toBe(memberId);
    const types = (await prisma.event.findMany({ where: { memberId } })).map((e) => e.type);
    expect(types.filter((t) => t === "player.registered")).toHaveLength(1);
    expect(types.filter((t) => t === "player.deposit")).toHaveLength(1);
    expect(await prisma.playerEvent.count()).toBe(2);
    const stats = await prisma.postStats.findUniqueOrThrow({ where: { postId } });
    expect(stats.deposits).toBe(2);
    expect(Number(stats.depositAmount)).toBe(80);
  });

  it("via le processeur de la file : une table en erreur (accès refusé) n'empêche pas les autres", async () => {
    // Le processeur construit le client réel depuis l'environnement (une requête par seconde : on limite aux tables utiles).
    process.env.LINKAFFI_API_KEY = "mauvaise-cle";
    const r = (await processSyncLinkaffi(fakeJob({ type: "tick" as const, tables: ["casinos"] }))) as { results: Array<{ table: string; ok: boolean; error?: string }> };
    process.env.LINKAFFI_API_KEY = API_KEY;
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.ok).toBe(false);
    expect(r.results[0]?.error).toMatch(/401/);
    const state = await prisma.syncState.findUniqueOrThrow({ where: { source: "casinos" } });
    expect(state.lastError).toMatch(/401/);
    expect(state.isRunning).toBe(false);
  });
});
