import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PrismaClientModule from "@prisma/client";
import { LinkAffiError, type LinkAffiClient } from "@linkaffipro/linkaffi";

type Row = Record<string, unknown>;

/** Fausse base : seules les lectures de la synchro Telegram (aucune écriture hors du `Setting`). */
const h = vi.hoisted(() => {
  const store = {
    settings: new Map<string, { key: string; value: unknown }>(),
    inviteLinks: [] as Row[],
    /** Membres rattachés : { linkaffiCampaignKey } */
    members: [] as Row[],
    /** Nos joueurs : { ftdAt, clickKey } (clé du clic d'offre). */
    ourPlayers: [] as Row[],
    /** Copie des joueurs Link Affi pour la requête d'attribution (`ref`, `campaign_id`, `has_column`, `ftd`). */
    attributionRows: [] as Row[],
    /** Joueurs Link Affi avec premier dépôt (repli par les membres liés). */
    ftdLaIds: [] as string[],
    queries: [] as string[],
  };
  const db = {
    setting: {
      findUnique: vi.fn(
        async (a: { where: { key: string } }) => store.settings.get(a.where.key) ?? null,
      ),
      upsert: vi.fn(async (a: { where: { key: string }; create: Row; update: Row }) => {
        const row = { key: a.where.key, value: (a.update as { value: unknown }).value };
        store.settings.set(a.where.key, row);
        return row;
      }),
    },
    inviteLink: { findMany: vi.fn(async () => store.inviteLinks) },
    member: {
      groupBy: vi.fn(async (a: { where: { linkaffiCampaignKey: { in: string[] } } }) => {
        const counts = new Map<string, number>();
        for (const m of store.members) {
          const k = m.linkaffiCampaignKey as string;
          if (a.where.linkaffiCampaignKey.in.includes(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return [...counts].map(([linkaffiCampaignKey, n]) => ({
          linkaffiCampaignKey,
          _count: { _all: n },
        }));
      }),
    },
    player: {
      findMany: vi.fn(
        async (a: { where: { click: { linkaffiTelegramCampaignKey: { in: string[] } } } }) =>
          store.ourPlayers
            .filter((p) =>
              a.where.click.linkaffiTelegramCampaignKey.in.includes(p.clickKey as string),
            )
            .map((p) => ({ ftdAt: p.ftdAt, click: { linkaffiTelegramCampaignKey: p.clickKey } })),
      ),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      store.queries.push(sql);
      if (sql.includes("has_column")) return store.attributionRows;
      if (sql.includes("la_id")) {
        const ids = values.find(Array.isArray) as string[];
        return store.ftdLaIds.filter((id) => ids.includes(id)).map((la_id) => ({ la_id }));
      }
      throw new Error(`requête inattendue : ${sql}`);
    }),
  };
  return { store, db };
});

vi.mock("@linkaffipro/db", async () => {
  const actual = await vi.importActual<typeof PrismaClientModule>("@prisma/client");
  return { prisma: h.db, Prisma: actual.Prisma };
});

import {
  TELEGRAM_CAMPAIGNS_SETTING_KEY,
  parseTelegramCampaignsState,
  type TelegramCampaignsState,
} from "@linkaffipro/linkaffi";
import {
  syncTelegramCampaigns,
  telegramCampaignsDue,
  telegramSyncErrorText,
} from "./linkaffi-telegram";

const { store, db } = h;
const NOW = new Date("2026-10-14T12:00:00Z");
const UUID_PAUL = "11111111-2222-3333-4444-555555555555";

/** Faux client `stats-api` : tables en mémoire, liste des tables, comptage par filtre d'égalité. */
function fakeClient(
  tables: Record<string, Row[]>,
  opts: { listTables?: () => Promise<string[]>; failOn?: Record<string, LinkAffiError> } = {},
) {
  const calls: string[] = [];
  const rowsOf = (t: string) => {
    calls.push(t);
    const fail = opts.failOn?.[t];
    if (fail) throw fail;
    const rows = tables[t];
    if (!rows) throw new LinkAffiError(`Introuvable (404) : /${t}`, 404, false);
    return rows;
  };
  const client = {
    listTables: vi.fn(opts.listTables ?? (async () => Object.keys(tables))),
    getPage: vi.fn(async (t: string) => {
      const rows = rowsOf(t);
      return {
        table: t,
        total: rows.length,
        offset: 0,
        limit: 1,
        count: rows.length,
        rows: rows.slice(0, 1),
      };
    }),
    getAll: vi.fn(async (t: string) => rowsOf(t)),
    count: vi.fn(
      async (t: string, q: { eq?: Record<string, string> } = {}) =>
        rowsOf(t).filter((r) => Object.entries(q.eq ?? {}).every(([k, v]) => r[k] === v)).length,
    ),
  };
  return { client: client as unknown as LinkAffiClient & typeof client, calls };
}

function state(): TelegramCampaignsState {
  return parseTelegramCampaignsState(store.settings.get(TELEGRAM_CAMPAIGNS_SETTING_KEY)?.value)!;
}

const offerRow = { id: "camp1", campaign_key: "47eb8mwc", name: "Celsius", casino_id: "cas1" };
const paulRow = {
  id: UUID_PAUL,
  campaign_key: "tgPaul01",
  name: "Paul VIP",
  type: "telegram",
  affiliate_id: "aff-paul",
  invite_link_id: "link-paul",
  channel_id: "chan-1",
  is_active: true,
};
const ourPaulLink = {
  id: "link-paul",
  channelId: "chan-1",
  isActive: true,
  linkaffiCampaignKey: "tgPaul01",
  linkaffiCampaignName: "Paul VIP",
  linkaffiAffiliateId: "aff-paul",
  linkaffiAffiliateName: "Paul",
};

beforeEach(() => {
  store.settings.clear();
  store.inviteLinks = [ourPaulLink];
  store.members = [];
  store.ourPlayers = [];
  store.attributionRows = [];
  store.ftdLaIds = [];
  store.queries = [];
  vi.clearAllMocks();
});

describe("tables Telegram absentes chez Link Affi", () => {
  it("aucune erreur : indisponible, nos campagnes listées sans chiffres Link Affi, aucune table Telegram lue", async () => {
    store.members = [{ linkaffiCampaignKey: "tgPaul01" }, { linkaffiCampaignKey: "tgPaul01" }];
    const { client, calls } = fakeClient({ campaigns: [offerRow], players: [], clicks: [] });
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r).toEqual({ available: false, campaigns: 1, divergences: 0, error: null });
    const s = state();
    expect(s).toMatchObject({
      available: false,
      error: null,
      syncedAt: NOW.toISOString(),
      sources: { campaigns: null, members: false, registrations: null, clicks: null },
      divergences: [],
    });
    expect(s.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP",
      affiliateName: "Paul",
      members: null,
      clicks: null,
      ours: { members: 2, registrations: 0, ftds: 0 },
    });
    // Liste des tables, puis `campaigns` (pas lue par ce passage) : rien d'autre.
    expect(calls).toEqual(["campaigns"]);
    expect(client.listTables).toHaveBeenCalledTimes(1);
  });

  it("les lignes `campaigns` déjà lues par le passage sont réutilisées (aucune requête de plus)", async () => {
    const { client, calls } = fakeClient({ campaigns: [offerRow] });
    await syncTelegramCampaigns({ db: db as never, client, now: () => NOW, campaignRows: [] });
    expect(calls).toEqual([]);
    expect(state().available).toBe(false);
  });

  it("liste des tables illisible : chaque table est sondée, une table inconnue (404) n'est pas une panne", async () => {
    const { client, calls } = fakeClient(
      { campaigns: [offerRow] },
      {
        listTables: async () => {
          throw new LinkAffiError("Réponse inattendue pour la liste des tables", null, false);
        },
      },
    );
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r.error).toBeNull();
    expect(r.available).toBe(false);
    expect(calls).toEqual(["telegram_campaigns", "campaigns", "telegram_members"]);
  });

  it("une table annoncée mais refusée (400) compte comme absente", async () => {
    const { client } = fakeClient(
      { campaigns: [offerRow], telegram_members: [] },
      { failOn: { telegram_members: new LinkAffiError("Réponse 400", 400, false) } },
    );
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r).toMatchObject({ available: false, error: null });
  });
});

describe("tables Telegram présentes", () => {
  const telegramMembers: Row[] = [
    { campaign_key: "tgPaul01", telegram_user_id: 1, username: "alice", first_name: "Alice" },
    { campaign_key: "tgPaul01", telegram_user_id: 2, username: "bob", first_name: "Bob" },
    { campaign_key: "tgPaul01", telegram_user_id: 3, username: "carl", first_name: "Carl" },
  ];

  it("compare membres, inscriptions et premiers dépôts ; compte les clics du lien de l'affilié", async () => {
    store.members = [1, 2, 3].map(() => ({ linkaffiCampaignKey: "tgPaul01" }));
    store.ourPlayers = [
      { clickKey: "tgPaul01", ftdAt: new Date() },
      { clickKey: "tgPaul01", ftdAt: null },
    ];
    store.attributionRows = [
      { ref: "tgPaul01", campaign_id: "camp1", has_column: true, ftd: true },
      { ref: UUID_PAUL, campaign_id: "camp1", has_column: true, ftd: false },
      { ref: null, campaign_id: "camp1", has_column: true, ftd: false },
    ];
    const { client, calls } = fakeClient({
      campaigns: [offerRow, paulRow],
      telegram_members: telegramMembers,
      telegram_member_events: [],
      clicks: [
        { id: "c1", campaign_id: UUID_PAUL },
        { id: "c2", campaign_id: UUID_PAUL },
        { id: "c3", campaign_id: "camp1" },
      ],
    });
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r).toEqual({ available: true, campaigns: 1, divergences: 0, error: null });
    const s = state();
    expect(s.sources).toEqual({
      campaigns: "campaigns",
      members: true,
      registrations: "players",
      clicks: "clicks",
    });
    expect(s.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP",
      affiliateId: "aff-paul",
      // Nom de l'affilié : absent chez Link Affi, repris de notre lien.
      affiliateName: "Paul",
      inviteLinkId: "link-paul",
      channelId: "chan-1",
      isActive: true,
      clicks: 2,
      members: 3,
      registrations: 2,
      ftds: 1,
      ours: { members: 3, registrations: 2, ftds: 1 },
      linkaffi: true,
      platform: true,
      clicksCheckedAt: NOW.toISOString(),
    });
    // Jamais l'historique des membres, jamais de donnée personnelle gardée.
    expect(calls).not.toContain("telegram_member_events");
    const raw = JSON.stringify(store.settings.get(TELEGRAM_CAMPAIGNS_SETTING_KEY)?.value);
    expect(raw).not.toMatch(/alice|Alice|bob|Carl/);
  });

  it("écarts au-delà de la tolérance", async () => {
    store.members = Array.from({ length: 8 }, () => ({ linkaffiCampaignKey: "tgPaul01" }));
    store.ourPlayers = [{ clickKey: "tgPaul01", ftdAt: new Date() }];
    store.attributionRows = [{ ref: null, campaign_id: null, has_column: true, ftd: false }];
    const { client } = fakeClient({
      campaigns: [offerRow, { ...paulRow, clicks: 40 }],
      telegram_members: telegramMembers,
    });
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r.divergences).toBe(3);
    expect(state().divergences).toEqual([
      { campaignKey: "tgPaul01", field: "members", ours: 8, theirs: 3 },
      { campaignKey: "tgPaul01", field: "registrations", ours: 1, theirs: 0 },
      { campaignKey: "tgPaul01", field: "ftds", ours: 1, theirs: 0 },
    ]);
    // Compteur porté par la campagne : aucune requête de comptage.
    expect(client.count).not.toHaveBeenCalled();
    expect(state().campaigns.tgPaul01?.clicks).toBe(40);
    expect(state().sources.clicks).toBe("campaigns");
  });

  it("table telegram_campaigns dédiée : préférée aux lignes de `campaigns`", async () => {
    const { client, calls } = fakeClient({
      campaigns: [offerRow],
      telegram_campaigns: [
        {
          id: "tc1",
          campaign_key: "tgPaul01",
          campaign_id: UUID_PAUL,
          name: "Paul (table)",
          status: "active",
        },
      ],
      clicks: [{ id: "c1", campaign_id: UUID_PAUL }],
    });
    await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(calls).not.toContain("campaigns");
    expect(state().sources.campaigns).toBe("telegram_campaigns");
    expect(state().campaigns.tgPaul01).toMatchObject({
      name: "Paul (table)",
      isActive: true,
      clicks: 1,
    });
  });
});

describe("tables partielles", () => {
  it("membres seulement : inscriptions inconnues (jamais 0 inventé), membres comparés", async () => {
    store.members = [{ linkaffiCampaignKey: "tgPaul01" }];
    store.ourPlayers = [{ clickKey: "tgPaul01", ftdAt: new Date() }];
    const { client } = fakeClient({
      campaigns: [offerRow],
      telegram_members: [{ campaign_key: "tgPaul01", telegram_user_id: 1 }],
    });
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r).toMatchObject({ available: true, divergences: 0, error: null });
    expect(state().sources).toEqual({
      campaigns: null,
      members: true,
      registrations: null,
      clicks: null,
    });
    expect(state().campaigns.tgPaul01).toMatchObject({
      members: 1,
      registrations: null,
      ftds: null,
      clicks: null,
      linkaffi: false,
    });
  });

  it("repli : joueurs liés aux membres de Link Affi quand les joueurs ne portent pas l'attribution", async () => {
    store.ftdLaIds = ["la-pl-1"];
    const { client } = fakeClient({
      campaigns: [offerRow],
      telegram_members: [
        { campaign_key: "tgPaul01", telegram_user_id: 1, player_id: "la-pl-1" },
        { campaign_key: "tgPaul01", telegram_user_id: 2, player_id: "la-pl-2" },
        { campaign_key: "tgPaul01", telegram_user_id: 3, player_id: null },
      ],
    });
    await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(state().sources.registrations).toBe("telegram_members");
    expect(state().campaigns.tgPaul01).toMatchObject({ registrations: 2, ftds: 1 });
    // Aucun membre rattaché chez nous : 3 membres, 2 inscriptions et 1 premier dépôt d'écart.
    expect(state().divergences.map((d) => [d.field, d.ours, d.theirs])).toEqual([
      ["members", 0, 3],
      ["registrations", 0, 2],
      ["ftds", 0, 1],
    ]);
  });
});

describe("pannes et rythme", () => {
  it("Link Affi ne répond pas : rien ne lève, la lecture précédente est gardée avec la raison", async () => {
    store.attributionRows = [{ ref: "tgPaul01", campaign_id: null, has_column: true, ftd: false }];
    const ok = fakeClient({
      campaigns: [offerRow, paulRow],
      telegram_members: [{ campaign_key: "tgPaul01", telegram_user_id: 1 }],
      clicks: [],
    });
    await syncTelegramCampaigns({ db: db as never, client: ok.client, now: () => NOW });
    const before = state();
    const later = new Date("2026-10-14T12:10:00Z");
    const down = fakeClient(
      {},
      {
        listTables: async () => {
          throw new LinkAffiError("Erreur réseau : fetch failed", null, true);
        },
      },
    );
    const r = await syncTelegramCampaigns({
      db: db as never,
      client: down.client,
      now: () => later,
    });
    expect(r.error).toBe("Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes.");
    const after = state();
    expect(after).toMatchObject({
      syncedAt: NOW.toISOString(),
      checkedAt: later.toISOString(),
      available: true,
      error: r.error,
    });
    expect(after.campaigns).toEqual(before.campaigns);
  });

  it("accès refusé : raison lisible, sans clé ni adresse", () => {
    const text = telegramSyncErrorText(
      new LinkAffiError("Accès refusé (401) : vérifier les clés", 401, false),
    );
    expect(text).toBe("Link Affi refuse la lecture : vérifier les clés de lecture de Link Affi.");
    expect(telegramSyncErrorText(new Error("boom postgres://user:pass@host"))).not.toMatch(
      /postgres|pass/,
    );
  });

  it("une base en panne ne fait pas lever non plus", async () => {
    db.inviteLink.findMany.mockRejectedValueOnce(new Error("connexion perdue"));
    const { client } = fakeClient({ campaigns: [offerRow] });
    const r = await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(r.error).toBe("Lecture impossible pour l'instant : nouvel essai dans 10 minutes.");
    expect(state()).toMatchObject({
      syncedAt: null,
      checkedAt: NOW.toISOString(),
      available: false,
    });
  });

  it("relue toutes les 10 minutes (essai réussi ou non), tout de suite en resynchro complète", async () => {
    expect(await telegramCampaignsDue(db as never, NOW)).toBe(true);
    const { client } = fakeClient({ campaigns: [offerRow] });
    await syncTelegramCampaigns({ db: db as never, client, now: () => NOW });
    expect(await telegramCampaignsDue(db as never, new Date("2026-10-14T12:09:00Z"))).toBe(false);
    expect(await telegramCampaignsDue(db as never, new Date("2026-10-14T12:09:00Z"), true)).toBe(
      true,
    );
    expect(await telegramCampaignsDue(db as never, new Date("2026-10-14T12:10:00Z"))).toBe(true);
  });

  it("comptage des clics interrompu par une panne : la lecture réussit, les chiffres précédents restent", async () => {
    const other = {
      ...paulRow,
      id: "22222222-2222-3333-4444-555555555555",
      campaign_key: "tgZoe001",
    };
    const first = fakeClient({
      campaigns: [offerRow, paulRow, other],
      clicks: [{ campaign_id: UUID_PAUL }, { campaign_id: "22222222-2222-3333-4444-555555555555" }],
    });
    await syncTelegramCampaigns({ db: db as never, client: first.client, now: () => NOW });
    expect(state().campaigns.tgPaul01?.clicks).toBe(1);
    expect(state().campaigns.tgZoe001?.clicks).toBe(1);
    const later = new Date("2026-10-14T12:10:00Z");
    const second = fakeClient(
      { campaigns: [offerRow, paulRow, other] },
      { failOn: { clicks: new LinkAffiError("Réponse 503", 503, true) } },
    );
    const r = await syncTelegramCampaigns({
      db: db as never,
      client: second.client,
      now: () => later,
    });
    expect(r.error).toBeNull();
    expect(second.client.count).toHaveBeenCalledTimes(1);
    expect(state().campaigns.tgPaul01).toMatchObject({
      clicks: 1,
      clicksCheckedAt: NOW.toISOString(),
    });
    expect(state().campaigns.tgZoe001).toMatchObject({
      clicks: 1,
      clicksCheckedAt: NOW.toISOString(),
    });
  });
});
