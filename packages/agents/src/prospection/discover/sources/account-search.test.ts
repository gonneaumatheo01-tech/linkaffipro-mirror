/**
 * Phase 32, chantier C — source « recherche par compte réel » : désactivée par défaut, débit (1 demande / 5 s), lot de
 * 20, plafond de 100 par jour et par compte, comptes qui conversent exclus, arrêt propre au premier FLOOD_WAIT ou
 * avertissement (source coupée, Kevin prévient), candidats `ACCOUNT_SEARCH` passés au Sourceur, boîte aux lettres du
 * userbot (sorte `prospect-search` seulement) et test adverse (aucune adhésion, aucun envoi). Base en mémoire, faux
 * userbot, horloge simulée, aucun réseau.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestKit } from "../../../human/test-kit";
import { ACCOUNT_SEARCH } from "../../contract-advanced";
import type { ProspectionKevinDeps } from "../../kevin-port";
import { PROSPECTION_ADVANCED_KEVIN_VARIANTS as A } from "../../kevin-advanced-texts";
import { USERBOT_HEARTBEAT_KEY, USERBOT_REQUEST_PREFIX } from "../../../inspiration/sources/userbot-mailbox";
import {
  accountSearchQueries,
  createUserbotSearchTransport,
  runAccountSearch,
  type AccountSearchDeps,
  type AccountSearchTransport,
  type FoundChannel,
  type SearchOutcome,
} from "./account-search";

const LOT = { vertical: "SPORTS" as const, languages: ["fr"] };

function setup(opts: { transport?: AccountSearchTransport | null; accounts?: string[] | null } = {}) {
  const kit = createTestKit(new Date("2026-10-27T01:30:00Z"));
  let clock = Date.parse("2026-10-27T01:30:00Z");
  const deps = kit.deps as unknown as AccountSearchDeps;
  deps.now = () => new Date(clock);
  deps.clock = () => clock;
  deps.sleep = async (ms: number) => void (clock += ms);
  const at: number[] = [];
  let n = 0;
  const transport: AccountSearchTransport & { searched: string[]; profiled: string[]; accountsUsed: string[] } = {
    searched: [],
    profiled: [],
    accountsUsed: [],
    async search(accountId, query) {
      at.push(clock);
      this.accountsUsed.push(accountId);
      this.searched.push(query);
      clock += 300; // temps de réponse simulé
      const channels: FoundChannel[] = Array.from({ length: 4 }, () => {
        n++;
        return { id: String(1000 + n), accessHash: String(9000 + n), username: `pronos_${n}`, title: `Pronos ${n}`, subscribers: 1000 + n };
      });
      return { ok: true, value: channels, calls: 1 };
    },
    async profile(accountId, channel) {
      at.push(clock);
      this.accountsUsed.push(accountId);
      this.profiled.push(channel.username ?? "");
      return { ok: true, value: { id: channel.id, username: channel.username, title: "Pronos", subscribers: 5400, about: "Pronos foot", linkedChat: { username: `${channel.username}_chat`, title: "Discussion" } }, calls: 1 };
    },
  };
  deps.accountSearch = {
    transport: opts.transport === undefined ? transport : opts.transport,
    ...(opts.accounts === null ? {} : { accounts: async () => opts.accounts ?? ["acc1", "acc2"] }),
  };
  const enable = () => kit.prisma.setting.create({ data: { key: ACCOUNT_SEARCH.enabled.key, value: true } });
  return { kit, deps: deps as ProspectionKevinDeps, raw: deps, transport, at, enable, advance: (ms: number) => (clock += ms) };
}

const counters = async (kit: ReturnType<typeof createTestKit>) => (await kit.prisma.setting.findUnique({ where: { key: ACCOUNT_SEARCH.countersKey } }))?.value as { perAccount: Record<string, number>; flood?: unknown };
const enabled = async (kit: ReturnType<typeof createTestKit>) => (await kit.prisma.setting.findUnique({ where: { key: ACCOUNT_SEARCH.enabled.key } }))?.value;

describe("recherche par compte réel : interrupteur", () => {
  it("désactivée par défaut : refusée, aucune demande", async () => {
    const t = setup();
    expect(ACCOUNT_SEARCH.enabled.value).toBe(false);
    expect(await runAccountSearch(t.deps, LOT)).toMatchObject({ ok: false, requests: 0, stopped: "désactivée" });
    expect(t.transport.searched).toHaveLength(0);
  });

  it("prospection en pause ou userbot absent : rien n'est demandé", async () => {
    const t = setup({ transport: null });
    await t.enable();
    expect(await runAccountSearch(t.deps, LOT)).toMatchObject({ ok: false, stopped: expect.stringMatching(/indisponible/) });
    const u = setup();
    await u.enable();
    await u.kit.prisma.setting.create({ data: { key: "prospection.enabled", value: false } });
    expect(await runAccountSearch(u.deps, LOT)).toMatchObject({ stopped: "prospection en pause" });
    expect(u.transport.searched).toHaveLength(0);
  });
});

describe("recherche par compte réel : lot", () => {
  it("lot de 20 demandes au plus, 5 s entre deux, candidats ACCOUNT_SEARCH au Sourceur", async () => {
    const t = setup();
    await t.enable();
    const r = await runAccountSearch(t.deps, LOT);
    expect(r.ok).toBe(true);
    expect(r.requests).toBe(ACCOUNT_SEARCH.perLot);
    expect(t.at).toHaveLength(20);
    for (let i = 1; i < t.at.length; i++) expect(t.at[i]! - t.at[i - 1]!).toBeGreaterThanOrEqual(ACCOUNT_SEARCH.rateMs);
    // Recherches puis fiches (3 au plus après chaque recherche).
    expect(t.transport.searched).toHaveLength(5);
    expect(t.transport.profiled).toHaveLength(15);
    const prospects = t.kit.tables("prospect");
    expect(prospects.length).toBe(r.newCount);
    expect(prospects.length).toBeGreaterThan(0);
    expect(prospects.every((p) => p.sourceType === "ACCOUNT_SEARCH" && p.status === "DISCOVERED")).toBe(true);
    expect(t.kit.tables("prospectSourceRun").at(-1)).toMatchObject({ sourceType: "ACCOUNT_SEARCH", vertical: "SPORTS" });
    // Comptes utilisés à tour de rôle, comptés.
    const c = await counters(t.kit);
    expect((c.perAccount.acc1 ?? 0) + (c.perAccount.acc2 ?? 0)).toBe(20);
    expect(Math.abs((c.perAccount.acc1 ?? 0) - (c.perAccount.acc2 ?? 0))).toBeLessThanOrEqual(1);
    // Le lot suivant enchaîne : 5 s après la dernière demande du précédent, gabarits suivants.
    const before = t.transport.searched.slice();
    await runAccountSearch(t.deps, LOT);
    expect(t.at[20]! - t.at[19]!).toBeGreaterThanOrEqual(ACCOUNT_SEARCH.rateMs);
    expect(t.transport.searched.slice(5)).not.toEqual(before);
  });

  it("plafond de 100 par jour et par compte", async () => {
    const t = setup();
    await t.enable();
    const day = "2026-10-27";
    await t.kit.prisma.setting.create({ data: { key: ACCOUNT_SEARCH.countersKey, value: { day, perAccount: { acc1: 99, acc2: 100 } } } });
    const r = await runAccountSearch(t.deps, LOT);
    expect(r.requests).toBe(1);
    expect(r.stopped).toMatch(/plafond/);
    expect(t.transport.accountsUsed).toEqual(["acc1"]);
    expect((await counters(t.kit)).perAccount).toEqual({ acc1: 100, acc2: 100 });
  });

  it("premier FLOOD_WAIT : arrêt propre, source coupée, Kevin prévient", async () => {
    const t = setup();
    await t.enable();
    let calls = 0;
    const search = t.transport.search.bind(t.transport);
    t.transport.search = async (a, q, l): Promise<SearchOutcome<FoundChannel[]>> => (++calls === 2 ? { ok: false, floodWaitSeconds: 120 } : search(a, q, l));
    const r = await runAccountSearch(t.deps, LOT);
    expect(r).toMatchObject({ ok: false, stopped: "FLOOD_WAIT" });
    expect(r.requests).toBe(5); // 1 recherche + 3 fiches + la recherche refusée
    expect(await enabled(t.kit)).toBe(false);
    expect((await counters(t.kit)).flood).toMatchObject({ seconds: 120 });
    expect(t.kit.sent).toHaveLength(1);
    expect(A.accountFloodStopped({ seconds: 120 })).toContain(t.kit.sent[0]!.html);
    // Les canaux déjà trouvés passent quand même au Sourceur.
    expect(t.kit.tables("prospect").length).toBe(4);
    // Coupée : le lot suivant ne demande plus rien.
    expect(await runAccountSearch(t.deps, LOT)).toMatchObject({ stopped: "désactivée", requests: 0 });
  });

  it("premier avertissement de Telegram : coupée tout de suite, Kevin prévient", async () => {
    const t = setup();
    await t.enable();
    t.transport.search = async () => ({ ok: false, warning: "PEER_FLOOD" });
    const r = await runAccountSearch(t.deps, LOT);
    expect(r).toMatchObject({ ok: false, requests: 1, stopped: "avertissement de Telegram" });
    expect(await enabled(t.kit)).toBe(false);
    expect(A.accountWarningStopped).toContain(t.kit.sent[0]!.html);
  });

  it("comptes libres seulement : jamais un compte qui porte une persona, un bot fantôme ou un DM récent", async () => {
    const t = setup({ accounts: null });
    await t.enable();
    const p = t.kit.prisma;
    const free = (await p.telegramUserAccount.create({ data: { label: "Libre", phone: "+331", sessionEncrypted: "x", status: "ACTIVE", isActive: true, createdAt: new Date("2026-01-01") } as never })) as { id: string };
    await p.telegramUserAccount.create({ data: { label: "Léa", phone: "+332", sessionEncrypted: "x", status: "ACTIVE", isActive: true, personaId: "persona1" } as never });
    await p.telegramUserAccount.create({ data: { label: "Fantôme", phone: "+333", sessionEncrypted: "x", status: "ACTIVE", isActive: true, botId: "bot1" } as never });
    const dm = (await p.telegramUserAccount.create({ data: { label: "Bavard", phone: "+334", sessionEncrypted: "x", status: "ACTIVE", isActive: true } as never })) as { id: string };
    await p.accountDm.create({ data: { accountId: dm.id, status: "SENT", createdAt: new Date("2026-10-25T10:00:00Z") } as never });
    await runAccountSearch(t.deps, LOT);
    expect(new Set(t.transport.accountsUsed)).toEqual(new Set([free.id]));
  });

  it("une recherche à la fois : un second lot est remis à plus tard", async () => {
    const t = setup();
    await t.enable();
    const enqueue = vi.fn(async () => undefined);
    t.raw.prospection = { enqueue };
    await t.kit.prisma.setting.create({ data: { key: "prospection.account_search.lock", value: { at: new Date("2026-10-27T01:29:00Z").toISOString() } } });
    expect(await runAccountSearch(t.deps, LOT)).toMatchObject({ ok: false, stopped: expect.stringMatching(/tourne déjà/) });
    expect(enqueue).toHaveBeenCalledWith({ type: "prospection.account-search", lot: LOT }, expect.objectContaining({ delayMs: expect.any(Number) }));
    expect(t.transport.searched).toHaveLength(0);
  });

  it("gabarits : langues à tour de rôle, rotation par curseur", () => {
    const q = accountSearchQueries("CASINO", ["fr", "it"], 0, 4);
    expect(q.map((x) => x.language)).toEqual(["fr", "it", "fr", "it"]);
    expect(accountSearchQueries("CASINO", ["fr", "it"], 2, 1)[0]).toEqual(q[2]);
    expect(accountSearchQueries("SPORTS", [], 0, 30).length).toBe(30);
  });
});

describe("boîte aux lettres du userbot", () => {
  it("demandes `prospect-search` seulement ; réponses lues ; FLOOD_WAIT et avertissement transmis", async () => {
    const kit = createTestKit(new Date("2026-10-27T01:30:00Z"));
    const now = () => new Date("2026-10-27T01:30:00Z");
    await kit.prisma.setting.create({ data: { key: USERBOT_HEARTBEAT_KEY, value: { at: now().toISOString() } } });
    const deposited: Array<Record<string, unknown>> = [];
    const replies = [
      { ok: true, calls: 1, channels: [{ id: "1", accessHash: "9", username: "pronos_fr", title: "Pronos", subscribers: 10 }] },
      { ok: false, floodWaitSeconds: 30 },
      { ok: false, warning: "PEER_FLOOD" },
    ];
    // Faux userbot : à chaque attente, répond à la demande en cours.
    const sleep = async () => {
      for (const row of kit.tables("setting")) {
        const key = String(row.key);
        const v = row.value as Record<string, unknown>;
        if (!key.startsWith(USERBOT_REQUEST_PREFIX) || v.status !== "PENDING") continue;
        deposited.push(v);
        await kit.prisma.setting.update({ where: { key }, data: { value: { ...v, status: "DONE", response: replies.shift() } as never } });
      }
    };
    const tr = await createUserbotSearchTransport(kit.prisma, { now, sleep });
    expect(tr).not.toBeNull();
    expect(await tr!.search("acc1", "pronos foot", 50)).toMatchObject({ ok: true, value: [{ username: "pronos_fr" }] });
    expect(await tr!.profile("acc1", { id: "1", accessHash: "9", username: "pronos_fr" })).toEqual({ ok: false, floodWaitSeconds: 30 });
    expect(await tr!.search("acc1", "x", 5)).toEqual({ ok: false, warning: "PEER_FLOOD" });
    expect(deposited.map((d) => [d.kind, d.op])).toEqual([
      ["prospect-search", "search"],
      ["prospect-search", "profile"],
      ["prospect-search", "search"],
    ]);
    expect(deposited[0]!.limit).toBe(20);
    // Lignes effacées après lecture.
    expect(kit.tables("setting").filter((r) => String(r.key).startsWith(USERBOT_REQUEST_PREFIX))).toHaveLength(0);
  });

  it("userbot muet depuis plus d'une minute : indisponible", async () => {
    const kit = createTestKit();
    await kit.prisma.setting.create({ data: { key: USERBOT_HEARTBEAT_KEY, value: { at: "2026-10-27T01:00:00Z" } } });
    expect(await createUserbotSearchTransport(kit.prisma, { now: () => new Date("2026-10-27T01:30:00Z") })).toBeNull();
  });
});

describe("test adverse : la recherche par compte ne peut ni rejoindre ni écrire", () => {
  const code = readFileSync(join(import.meta.dirname, "account-search.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  it("aucun import ni appel d'adhésion, d'envoi ou de lecture d'historique", () => {
    expect(code).not.toMatch(/joinWithInvite|joinWithInviteOnce|createUserbotHistoryTransport|createDefaultAccountReader|prismaAccountHistoryReader|readWithAccount/);
    expect(code).not.toMatch(/"join-invite"|"history"|"is-member"/);
    expect(code).not.toMatch(/\b(sendMessage|sendDm|enqueueDm|joinChannel|JoinChannel|ImportChatInvite|importChatInvite)\b/);
    expect(code).not.toMatch(/from\s+["'](grammy|telegram|@linkaffipro\/(telegram|mtproto|userbot))/);
  });
  it("la seule sorte de demande déposée est `prospect-search`", () => {
    const kinds = [...code.matchAll(/kind:\s*([A-Z_]+|"[^"]+")/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);
    // « CHANNEL » : genre du candidat transmis au Sourceur, pas une demande au userbot.
    expect(kinds.every((k) => k === "PROSPECT_SEARCH_KIND" || k === '"prospect-search"' || k === '"CHANNEL"')).toBe(true);
  });
});
