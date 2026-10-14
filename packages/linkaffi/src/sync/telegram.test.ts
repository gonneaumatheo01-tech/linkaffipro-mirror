import { describe, expect, it } from "vitest";
import { mapCampaign } from "./mapping";
import {
  TELEGRAM_CLICK_COUNTS_PER_PASS,
  buildTelegramCampaignsState,
  clickCountTargets,
  countTheirPlayers,
  isTelegramCampaignRow,
  isTelegramDivergence,
  mapTelegramCampaign,
  mapTelegramCampaigns,
  ourLinksByKey,
  parseTelegramCampaignsState,
  resolveTelegramCampaignRef,
  summarizeTelegramMembers,
  telegramCampaignLookup,
  telegramCampaignsStateAfterError,
  telegramSyncDue,
  telegramTolerance,
  type LaTelegramCampaign,
  type OurTelegramLink,
  type TelegramBuildInput,
  type TelegramSources,
} from "./telegram";

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const offer = {
  id: "camp1",
  campaign_key: "47eb8mwc",
  name: "Celsius",
  casino_id: "cas1",
  domain: "linkaffi.me",
};

describe("campagnes Telegram dans la table campaigns", () => {
  it("reconnaît une campagne Telegram par son type ou par notre lien / notre canal", () => {
    expect(isTelegramCampaignRow({ ...offer, type: "telegram" })).toBe(true);
    expect(isTelegramCampaignRow({ ...offer, destination_type: "Canal Telegram" })).toBe(true);
    expect(isTelegramCampaignRow({ ...offer, invite_link_id: "cl_invite_1" })).toBe(true);
    expect(isTelegramCampaignRow({ ...offer, telegram_channel_id: "ch_1" })).toBe(true);
  });

  it("une offre vers un casino n'est jamais prise pour une campagne Telegram", () => {
    expect(isTelegramCampaignRow(offer)).toBe(false);
    expect(isTelegramCampaignRow({ ...offer, type: "casino", invite_link_id: null })).toBe(false);
    // `channel_id` seul est trop vague pour décider.
    expect(isTelegramCampaignRow({ ...offer, channel_id: "abc" })).toBe(false);
  });

  it("une campagne Telegram n'est pas importée comme offre ; une offre l'est toujours", () => {
    expect(mapCampaign({ ...offer, type: "telegram", casino_id: null })).toBeNull();
    expect(mapCampaign(offer)?.campaignKey).toBe("47eb8mwc");
  });

  it("lit les colonnes probables, l'état actif et le compteur de clics", () => {
    const c = mapTelegramCampaign(
      {
        id: UUID_A,
        campaign_key: "tgPaul01",
        name: "Paul — VIP",
        affiliate_id: UUID_B,
        affiliate_name: "Paul",
        invite_link_id: "cl_link_1",
        channel_id: "cl_channel_1",
        status: "paused",
        clicks_count: "42",
        type: "telegram",
      },
      "campaigns",
    );
    expect(c).toEqual({
      key: "tgPaul01",
      linkaffiId: UUID_A,
      clicksCampaignId: UUID_A,
      name: "Paul — VIP",
      affiliateId: UUID_B,
      affiliateName: "Paul",
      inviteLinkId: "cl_link_1",
      channelId: "cl_channel_1",
      isActive: false,
      clicks: 42,
    });
    expect(
      mapTelegramCampaign({ campaign_key: "k1", is_active: true }, "campaigns")?.isActive,
    ).toBe(true);
    expect(mapTelegramCampaign({ campaign_key: "k1", status: "??" }, "campaigns")?.isActive).toBe(
      null,
    );
    expect(mapTelegramCampaign({ campaign_key: "k1" }, "campaigns")?.clicks).toBeNull();
  });

  it("table telegram_campaigns : les clics portent la campagne du lien (campaign_id) si elle existe", () => {
    const c = mapTelegramCampaign(
      { id: "tc1", telegram_campaign_key: "tgKey", campaign_id: UUID_A },
      "telegram_campaigns",
    );
    expect(c?.key).toBe("tgKey");
    expect(c?.linkaffiId).toBe("tc1");
    expect(c?.clicksCampaignId).toBe(UUID_A);
  });

  it("une ligne sans clé lisible est ignorée ; une clé en double garde la dernière", () => {
    expect(mapTelegramCampaign({ id: "x" }, "campaigns")).toBeNull();
    expect(mapTelegramCampaign({ campaign_key: "a b" }, "campaigns")).toBeNull();
    const list = mapTelegramCampaigns(
      [
        { ...offer },
        { id: "t1", campaign_key: "tg1", type: "telegram", name: "Ancien" },
        { id: "t1", campaign_key: "tg1", type: "telegram", name: "Nouveau" },
      ],
      "campaigns",
    );
    expect(list.map((c) => [c.key, c.name])).toEqual([["tg1", "Nouveau"]]);
  });
});

const tgPaul: LaTelegramCampaign = {
  key: "tgPaul01",
  linkaffiId: UUID_A,
  clicksCampaignId: UUID_A,
  name: "Paul VIP",
  affiliateId: "aff-paul",
  affiliateName: "Paul",
  inviteLinkId: "link-paul",
  channelId: "chan-1",
  isActive: true,
  clicks: null,
};

describe("références de campagne", () => {
  const lookup = telegramCampaignLookup([tgPaul], ["ourOnly1"]);

  it("identifiant Link Affi → clé ; clé connue gardée ; clé inconnue bien formée gardée", () => {
    expect(resolveTelegramCampaignRef(UUID_A, lookup)).toBe("tgPaul01");
    expect(resolveTelegramCampaignRef("tgPaul01", lookup)).toBe("tgPaul01");
    expect(resolveTelegramCampaignRef("ourOnly1", lookup)).toBe("ourOnly1");
    expect(resolveTelegramCampaignRef("autreCle", lookup)).toBe("autreCle");
  });

  it("identifiant inconnu, vide ou illisible : rien", () => {
    expect(resolveTelegramCampaignRef(UUID_B, lookup)).toBeNull();
    expect(resolveTelegramCampaignRef("", lookup)).toBeNull();
    expect(resolveTelegramCampaignRef(null, lookup)).toBeNull();
    expect(resolveTelegramCampaignRef("pas une clé", lookup)).toBeNull();
    expect(resolveTelegramCampaignRef({ a: 1 }, lookup)).toBeNull();
  });
});

describe("telegram_members", () => {
  const lookup = telegramCampaignLookup([tgPaul], []);

  it("membres distincts par campagne, campagne relue par sa clé ou son identifiant", () => {
    const s = summarizeTelegramMembers(
      [
        { campaign_key: "tgPaul01", telegram_user_id: 1, player_id: null },
        { campaign_key: "tgPaul01", telegram_user_id: 1, player_id: "pl-1" },
        { telegram_campaign_id: UUID_A, telegram_user_id: "2" },
        { campaign_key: "autre01", telegram_user_id: 3 },
        { campaign_id: UUID_B, telegram_user_id: 4 },
      ],
      lookup,
    );
    expect(s.byKey.get("tgPaul01")?.members).toBe(2);
    expect([...(s.byKey.get("tgPaul01")?.playerIds ?? [])]).toEqual(["pl-1"]);
    expect(s.byKey.get("autre01")?.members).toBe(1);
    expect(s.unresolved).toBe(1);
    expect(s.hasPlayerColumn).toBe(true);
  });

  it("sans colonne de joueur lié : le repli des inscriptions n'est pas possible", () => {
    const s = summarizeTelegramMembers([{ campaign_key: "tgPaul01", telegram_user_id: 1 }], lookup);
    expect(s.hasPlayerColumn).toBe(false);
  });
});

describe("joueurs crédités par Link Affi (attribution tg)", () => {
  const lookup = telegramCampaignLookup([tgPaul], []);

  it("compte inscriptions et premiers dépôts par clé ou par campagne Telegram du joueur", () => {
    const r = countTheirPlayers(
      [
        { ref: "tgPaul01", campaignId: "offre", hasColumn: true, ftd: true },
        { ref: UUID_A, campaignId: "offre", hasColumn: true, ftd: false },
        { ref: null, campaignId: UUID_A, hasColumn: false, ftd: true },
        { ref: null, campaignId: "offre", hasColumn: true, ftd: true },
      ],
      lookup,
    );
    expect(r.exposed).toBe(true);
    expect(r.byKey.get("tgPaul01")).toEqual({ registrations: 3, ftds: 2 });
  });

  it("aucune colonne tg et aucun joueur sous une campagne Telegram : non exposé", () => {
    const r = countTheirPlayers(
      [{ ref: null, campaignId: "offre", hasColumn: false, ftd: true }],
      lookup,
    );
    expect(r.exposed).toBe(false);
    expect(r.byKey.size).toBe(0);
  });

  it("colonne présente mais vide partout : exposé, zéro joueur", () => {
    const r = countTheirPlayers(
      [{ ref: null, campaignId: null, hasColumn: true, ftd: false }],
      lookup,
    );
    expect(r.exposed).toBe(true);
    expect(r.byKey.size).toBe(0);
  });
});

describe("tolérance des écarts", () => {
  it("membres : 2 d'écart tolérés, 5 % au-delà de 40", () => {
    expect(telegramTolerance("members", 10, 8)).toBe(2);
    expect(isTelegramDivergence("members", 10, 8)).toBe(false);
    expect(isTelegramDivergence("members", 10, 7)).toBe(true);
    expect(telegramTolerance("members", 100, 90)).toBe(5);
    expect(isTelegramDivergence("members", 100, 95)).toBe(false);
    expect(isTelegramDivergence("members", 100, 94)).toBe(true);
  });

  it("inscriptions et premiers dépôts : exacts sous 20, 5 % au-delà", () => {
    expect(isTelegramDivergence("ftds", 3, 2)).toBe(true);
    expect(isTelegramDivergence("registrations", 0, 0)).toBe(false);
    expect(isTelegramDivergence("registrations", 19, 18)).toBe(true);
    expect(isTelegramDivergence("registrations", 40, 38)).toBe(false);
    expect(isTelegramDivergence("registrations", 40, 37)).toBe(true);
  });
});

const ourPaul: OurTelegramLink = {
  key: "tgPaul01",
  inviteLinkId: "link-paul",
  channelId: "chan-1",
  isActive: true,
  name: "Paul VIP (chez nous)",
  affiliateId: "aff-paul",
  affiliateName: "Paul",
};

const allSources: TelegramSources = {
  campaigns: "campaigns",
  members: true,
  registrations: "players",
  clicks: "clicks",
};

function build(over: Partial<TelegramBuildInput> = {}) {
  return buildTelegramCampaignsState({
    now: new Date("2026-10-14T12:00:00Z"),
    sources: allSources,
    linkaffiCampaigns: [tgPaul],
    ourLinks: [ourPaul],
    theirMembers: new Map([["tgPaul01", 10]]),
    theirPlayers: new Map([["tgPaul01", { registrations: 4, ftds: 2 }]]),
    clicks: new Map([["tgPaul01", { clicks: 57, checkedAt: "2026-10-14T12:00:00.000Z" }]]),
    ours: new Map([["tgPaul01", { members: 10, registrations: 4, ftds: 2 }]]),
    ...over,
  });
}

describe("Setting linkaffi.telegramCampaigns", () => {
  it("chiffres concordants : aucune divergence, identité de Link Affi d'abord", () => {
    const s = build();
    expect(s.available).toBe(true);
    expect(s.error).toBeNull();
    expect(s.syncedAt).toBe("2026-10-14T12:00:00.000Z");
    expect(s.divergences).toEqual([]);
    expect(s.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP",
      affiliateName: "Paul",
      inviteLinkId: "link-paul",
      channelId: "chan-1",
      isActive: true,
      clicks: 57,
      members: 10,
      registrations: 4,
      ftds: 2,
      ours: { members: 10, registrations: 4, ftds: 2 },
      linkaffi: true,
      platform: true,
    });
  });

  it("écarts au-delà de la tolérance, les plus grands d'abord", () => {
    const s = build({
      ours: new Map([["tgPaul01", { members: 15, registrations: 5, ftds: 2 }]]),
    });
    expect(s.divergences).toEqual([
      { campaignKey: "tgPaul01", field: "members", ours: 15, theirs: 10 },
      { campaignKey: "tgPaul01", field: "registrations", ours: 5, theirs: 4 },
    ]);
  });

  it("chiffre inconnu chez Link Affi (null) : jamais d'écart, jamais 0 inventé", () => {
    const s = build({
      sources: { ...allSources, members: false, registrations: null },
      theirMembers: null,
      theirPlayers: null,
      ours: new Map([["tgPaul01", { members: 30, registrations: 9, ftds: 3 }]]),
    });
    expect(s.campaigns.tgPaul01).toMatchObject({ members: null, registrations: null, ftds: null });
    expect(s.divergences).toEqual([]);
  });

  it("campagne connue d'un seul côté : comptée à zéro de l'autre côté quand le chiffre existe", () => {
    const s = build({
      linkaffiCampaigns: [],
      sources: { ...allSources, campaigns: null },
      ourLinks: [ourPaul, { ...ourPaul, key: "tgSeul01", name: "Seul chez nous" }],
      theirMembers: new Map([
        ["tgPaul01", 10],
        ["inconnu1", 4],
      ]),
      theirPlayers: new Map(),
      clicks: new Map(),
      ours: new Map([
        ["tgPaul01", { members: 10, registrations: 0, ftds: 0 }],
        ["tgSeul01", { members: 5, registrations: 0, ftds: 0 }],
      ]),
    });
    expect(Object.keys(s.campaigns)).toEqual(["inconnu1", "tgPaul01", "tgSeul01"]);
    expect(s.campaigns.tgSeul01).toMatchObject({
      name: "Seul chez nous",
      members: 0,
      registrations: 0,
      clicks: null,
      linkaffi: false,
      platform: true,
    });
    expect(s.campaigns.inconnu1).toMatchObject({ name: null, linkaffi: false, platform: false });
    expect(s.divergences).toEqual([
      { campaignKey: "tgSeul01", field: "members", ours: 5, theirs: 0 },
      { campaignKey: "inconnu1", field: "members", ours: 0, theirs: 4 },
    ]);
  });

  it("rien d'exposé chez Link Affi : indisponible, nos campagnes listées sans chiffres Link Affi", () => {
    const s = build({
      sources: { campaigns: null, members: false, registrations: null, clicks: null },
      linkaffiCampaigns: [],
      theirMembers: null,
      theirPlayers: null,
      clicks: new Map(),
    });
    expect(s.available).toBe(false);
    expect(s.divergences).toEqual([]);
    expect(s.campaigns.tgPaul01).toMatchObject({
      name: "Paul VIP (chez nous)",
      clicks: null,
      members: null,
      registrations: null,
      ftds: null,
      ours: { members: 10, registrations: 4, ftds: 2 },
    });
  });

  it("un échec garde les chiffres de la dernière lecture réussie", () => {
    const ok = build();
    const failed = telegramCampaignsStateAfterError(
      ok,
      new Date("2026-10-14T12:20:00Z"),
      "Link Affi ne répond pas",
    );
    expect(failed).toMatchObject({
      syncedAt: "2026-10-14T12:00:00.000Z",
      checkedAt: "2026-10-14T12:20:00.000Z",
      available: true,
      error: "Link Affi ne répond pas",
    });
    expect(failed.campaigns).toEqual(ok.campaigns);
    const first = telegramCampaignsStateAfterError(null, new Date("2026-10-14T12:20:00Z"), "x");
    expect(first).toMatchObject({
      syncedAt: null,
      available: false,
      campaigns: {},
      divergences: [],
    });
  });

  it("notre lien par clé : l'actif le plus récent", () => {
    const m = ourLinksByKey([
      { ...ourPaul, inviteLinkId: "old", isActive: true },
      { ...ourPaul, inviteLinkId: "revoked", isActive: false },
      { ...ourPaul, inviteLinkId: "new", isActive: true },
    ]);
    expect(m.get("tgPaul01")?.inviteLinkId).toBe("new");
    const m2 = ourLinksByKey([
      { ...ourPaul, inviteLinkId: "active", isActive: true },
      { ...ourPaul, inviteLinkId: "revoked", isActive: false },
    ]);
    expect(m2.get("tgPaul01")?.inviteLinkId).toBe("active");
  });
});

describe("rythme et comptage des clics", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("lecture due toutes les 10 minutes, tout de suite en resynchro complète", () => {
    expect(telegramSyncDue(null, now)).toBe(true);
    expect(telegramSyncDue({ checkedAt: "2026-10-14T11:55:00Z" }, now)).toBe(false);
    expect(telegramSyncDue({ checkedAt: "2026-10-14T11:55:00Z" }, now, true)).toBe(true);
    expect(telegramSyncDue({ checkedAt: "2026-10-14T11:50:00Z" }, now)).toBe(true);
    expect(telegramSyncDue({ checkedAt: "2026-10-14T13:00:00Z" }, now)).toBe(true);
    expect(telegramSyncDue({ checkedAt: "n'importe quoi" }, now)).toBe(true);
  });

  it("clics à compter : sans compteur, avec identifiant, les plus anciens d'abord, au plus N", () => {
    const camp = (key: string, over: Partial<LaTelegramCampaign> = {}): LaTelegramCampaign => ({
      ...tgPaul,
      key,
      ...over,
    });
    const previous = build({
      linkaffiCampaigns: [camp("a"), camp("b"), camp("c")],
      clicks: new Map([
        ["a", { clicks: 1, checkedAt: "2026-10-14T11:00:00.000Z" }],
        ["b", { clicks: 1, checkedAt: "2026-10-14T10:00:00.000Z" }],
      ]),
    });
    const targets = clickCountTargets(
      [
        camp("a"),
        camp("b"),
        camp("c"),
        camp("d", { clicks: 3 }),
        camp("e", { clicksCampaignId: null }),
      ],
      previous,
      2,
    );
    expect(targets.map((c) => c.key)).toEqual(["c", "b"]);
    expect(TELEGRAM_CLICK_COUNTS_PER_PASS).toBeGreaterThan(0);
  });
});

describe("lecture prudente du Setting", () => {
  it("relit exactement ce qui a été écrit (JSON)", () => {
    const s = build({ ours: new Map([["tgPaul01", { members: 15, registrations: 4, ftds: 2 }]]) });
    expect(parseTelegramCampaignsState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("forme inattendue : null ; champs illisibles : vides", () => {
    expect(parseTelegramCampaignsState(null)).toBeNull();
    expect(parseTelegramCampaignsState("x")).toBeNull();
    expect(parseTelegramCampaignsState([])).toBeNull();
    const p = parseTelegramCampaignsState({
      syncedAt: "pas une date",
      available: "oui",
      campaigns: { "clé invalide": {}, ok1: { clicks: "12", members: "x", ours: null }, ok2: 3 },
      divergences: [
        { campaignKey: "ok1", field: "members", ours: 1, theirs: 5 },
        { campaignKey: "ok1", field: "inconnu", ours: 1, theirs: 5 },
        { campaignKey: "ok1", field: "ftds", ours: null, theirs: 5 },
        "x",
      ],
    });
    expect(p?.syncedAt).toBeNull();
    expect(p?.available).toBe(false);
    expect(Object.keys(p?.campaigns ?? {})).toEqual(["ok1"]);
    expect(p?.campaigns.ok1).toMatchObject({
      clicks: 12,
      members: null,
      ours: { members: 0, registrations: 0, ftds: 0 },
    });
    expect(p?.divergences).toEqual([{ campaignKey: "ok1", field: "members", ours: 1, theirs: 5 }]);
  });

  it("forme minimale du cahier des charges : la date de lecture sert de date d'essai", () => {
    const p = parseTelegramCampaignsState({
      syncedAt: "2026-10-14T12:00:00.000Z",
      available: true,
      campaigns: {},
      divergences: [],
    });
    expect(p).toMatchObject({
      syncedAt: "2026-10-14T12:00:00.000Z",
      checkedAt: "2026-10-14T12:00:00.000Z",
      available: true,
      error: null,
      sources: { campaigns: null, members: false, registrations: null, clicks: null },
    });
  });

  it("forme minimale avec des chiffres (sans sources ni repères) : ce que Link Affi donne est déduit des chiffres", () => {
    // Forme D6 telle qu'écrite par les données de démonstration : ni `sources`, ni `platform`, ni `ours`.
    const p = parseTelegramCampaignsState({
      syncedAt: "2026-10-14T12:00:00.000Z",
      available: true,
      campaigns: {
        demotgpaul01: {
          affiliateId: "aff-paul",
          affiliateName: "Paul",
          name: "Paul — Telegram",
          inviteLinkId: "link-paul",
          channelId: "chan-1",
          isActive: true,
          clicks: 41,
          members: 12,
          registrations: 4,
          ftds: 1,
        },
        demotgzoe01: {
          affiliateId: "aff-zoe",
          name: "Zoé",
          inviteLinkId: null,
          clicks: null,
          members: 3,
          registrations: 0,
          ftds: 0,
        },
      },
      divergences: [{ campaignKey: "demotgpaul01", field: "ftds", ours: 2, theirs: 1 }],
    });
    expect(p?.sources).toEqual({
      campaigns: "telegram_campaigns",
      members: true,
      registrations: "players",
      clicks: "campaigns",
    });
    // Lien d'invitation connu : campagne de chez nous ; chiffres présents : vue chez Link Affi.
    expect(p?.campaigns.demotgpaul01).toMatchObject({ platform: true, linkaffi: true });
    expect(p?.campaigns.demotgzoe01).toMatchObject({ platform: false, linkaffi: true });
    // Repères écrits explicitement : jamais remplacés par la déduction.
    const explicit = parseTelegramCampaignsState({
      available: true,
      sources: { campaigns: null, members: true, registrations: null, clicks: null },
      campaigns: { k1: { inviteLinkId: "x", clicks: 3, platform: false, linkaffi: false } },
    });
    expect(explicit?.sources).toEqual({
      campaigns: null,
      members: true,
      registrations: null,
      clicks: null,
    });
    expect(explicit?.campaigns.k1).toMatchObject({ platform: false, linkaffi: false });
    // Rien d'exposé (aucun chiffre) : aucune source déduite.
    const empty = parseTelegramCampaignsState({
      available: false,
      campaigns: { k1: { inviteLinkId: "x", clicks: null, members: null } },
    });
    expect(empty?.sources).toEqual({
      campaigns: null,
      members: false,
      registrations: null,
      clicks: null,
    });
  });
});
