import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Création et désactivation des liens des campagnes Telegram d'affiliés, base et Telegram simulés : idempotence
 * (aucun nouvel appel à Telegram pour la même clé et le même canal), appels simultanés, révocation par le bot créateur,
 * Telegram injoignable. Le parcours sur base réelle est dans tests/integration/linkaffi-integration-api.test.ts.
 */
type Row = Record<string, unknown> & { id: string; channelId: string; isActive: boolean };
const db = vi.hoisted(() => ({
  links: [] as Row[],
  channels: [] as Array<Record<string, unknown> & { id: string }>,
  bots: [] as Array<Record<string, unknown> & { id: string }>,
  /** Journal des appels (`AuditLog`) : résultat des désactivations précédentes. */
  audits: [] as Array<{ entityId: string; metadata: Record<string, unknown> }>,
  /** Simule l'index unique (clé, canal) qui se déclenche après un appel simultané. */
  raceOnCreate: null as Row | null,
}));
const tg = vi.hoisted(() => ({
  created: 0,
  createImpl: null as null | (() => Promise<{ botId: string; url: string }>),
  revoke: vi.fn(async (_link: unknown): Promise<string | null> => null),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    inviteLink: {
      findMany: vi.fn(async ({ where }: { where: { linkaffiCampaignKey: string } }) =>
        db.links.filter((l) => l.linkaffiCampaignKey === where.linkaffiCampaignKey),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const l = db.links.find((x) => x.id === where.id);
        if (!l) return null;
        return {
          ...l,
          bot: db.bots.find((b) => b.id === l.botId),
          channel: db.channels.find((c) => c.id === l.channelId),
        };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (db.raceOnCreate) {
          db.links.push(db.raceOnCreate);
          db.raceOnCreate = null;
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
        const row = { id: `l${db.links.length + 1}`, isActive: true, ...data } as Row;
        db.links.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const l = db.links.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return l;
        },
      ),
    },
    channel: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.channels.find((c) => c.id === where.id) ?? null,
      ),
    },
    bot: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.bots.find((b) => b.id === where.id) ?? null,
      ),
    },
    auditLog: {
      // Dernier résultat de révocation journalisé pour ce lien (le plus récent d'abord).
      findFirst: vi.fn(async ({ where }: { where: { entityId: string } }) => {
        const hit = [...db.audits].reverse().find((a) => a.entityId === where.entityId);
        return hit ? { metadata: hit.metadata } : null;
      }),
    },
  },
}));
vi.mock("@/lib/channels/share-links", () => {
  class TelegramLinkError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    TelegramLinkError,
    createJoinRequestLink: vi.fn(async (_channel: unknown, _name: string) => {
      if (tg.createImpl) return tg.createImpl();
      tg.created += 1;
      return { botId: "bot-main", url: `https://t.me/+aff${tg.created}` };
    }),
    revokeOnTelegram: tg.revoke,
  };
});

const { createLinkaffiInviteLink, patchLinkaffiInviteLink } = await import("./invite-links");
const shareLinks = await import("@/lib/channels/share-links");

const req = {
  campaignKey: "paul1",
  campaignName: "Paul · Zone Interdite 🔞 offre spéciale du mois",
  affiliateId: "aff-paul",
  affiliateName: "Paul",
  channelId: "ch-zone",
  attributionDays: null as number | null,
};

describe("POST /invite-links (base et Telegram simulés)", () => {
  beforeEach(() => {
    db.links.length = 0;
    db.channels.splice(
      0,
      db.channels.length,
      {
        id: "ch-zone",
        title: "Zone Interdite",
        telegramChatId: -100123n,
        language: "fr",
        isActive: true,
        isMediaLibrary: false,
      },
      {
        id: "ch-tir",
        title: "Tir Cadré",
        telegramChatId: -100456n,
        language: "fr",
        isActive: true,
        isMediaLibrary: false,
      },
      {
        id: "ch-off",
        title: "Ancien",
        telegramChatId: -100789n,
        language: "fr",
        isActive: false,
        isMediaLibrary: false,
      },
    );
    db.bots.splice(0, db.bots.length, { id: "bot-main", username: "bot_main", isActive: true });
    db.raceOnCreate = null;
    tg.created = 0;
    tg.createImpl = null;
    tg.revoke.mockClear();
    vi.mocked(shareLinks.createJoinRequestLink).mockClear();
  });

  it("crée le lien chez Telegram (201), nommé d'après la campagne sur 32 caractères, puis le rend tel quel (200)", async () => {
    const first = await createLinkaffiInviteLink(req);
    expect(first.status).toBe(201);
    expect(first.link).toEqual({
      inviteLinkId: "l1",
      url: "https://t.me/+aff1",
      isActive: true,
      channelId: "ch-zone",
      campaignKey: "paul1",
    });
    const [channel, name] = vi.mocked(shareLinks.createJoinRequestLink).mock.calls[0]!;
    expect(channel).toMatchObject({ id: "ch-zone" });
    expect(name).toBe("Paul · Zone Interdite 🔞 offre s");
    expect(name.length).toBe(32);
    expect(db.links[0]).toMatchObject({
      kind: "LINKAFFI",
      createsJoinRequest: true,
      botId: "bot-main",
      linkaffiCampaignKey: "paul1",
      linkaffiCampaignName: req.campaignName,
      linkaffiAffiliateId: "aff-paul",
      linkaffiAffiliateName: "Paul",
      attributionDays: null,
      createdById: null,
      language: "fr",
    });

    const again = await createLinkaffiInviteLink(req);
    expect(again.status).toBe(200);
    expect(again.link).toEqual(first.link);
    expect(again.updated).toEqual([]);
    expect(shareLinks.createJoinRequestLink).toHaveBeenCalledTimes(1);
    expect(db.links).toHaveLength(1);
  });

  it("même clé, autre canal : un autre lien ; même clé, autre affilié : refusé (409)", async () => {
    await createLinkaffiInviteLink(req);
    const tir = await createLinkaffiInviteLink({ ...req, channelId: "ch-tir" });
    expect(tir.status).toBe(201);
    expect(tir.link.inviteLinkId).toBe("l2");
    expect(tir.link.url).toBe("https://t.me/+aff2");
    await expect(
      createLinkaffiInviteLink({ ...req, affiliateId: "aff-marc", channelId: "ch-tir" }),
    ).rejects.toMatchObject({ status: 409, code: "affiliate_mismatch" });
  });

  it("nouveau nom ou nouvelle durée pour la même clé et le même canal : même lien, champs mis à jour", async () => {
    await createLinkaffiInviteLink(req);
    const r = await createLinkaffiInviteLink({
      ...req,
      campaignName: "Paul v2",
      attributionDays: 30,
    });
    expect(r.status).toBe(200);
    expect(r.updated.sort()).toEqual(["attributionDays", "linkaffiCampaignName"]);
    expect(db.links[0]).toMatchObject({ linkaffiCampaignName: "Paul v2", attributionDays: 30 });
    expect(shareLinks.createJoinRequestLink).toHaveBeenCalledTimes(1);
  });

  it("relance sans nom d'affilié ni durée : le lien garde son nom et sa durée ; lien nouveau sans eux : à vie", async () => {
    await createLinkaffiInviteLink({ ...req, affiliateName: "Sarah K.", attributionDays: 30 });
    const { affiliateName: _n, attributionDays: _d, ...omitted } = req;
    const r = await createLinkaffiInviteLink(omitted);
    expect(r.status).toBe(200);
    expect(r.updated).toEqual([]);
    expect(db.links[0]).toMatchObject({ linkaffiAffiliateName: "Sarah K.", attributionDays: 30 });
    const tir = await createLinkaffiInviteLink({ ...omitted, channelId: "ch-tir" });
    expect(tir.status).toBe(201);
    expect(db.links[1]).toMatchObject({ linkaffiAffiliateName: null, attributionDays: null });
  });

  it("canal inconnu ou désactivé : 404 sans appel à Telegram", async () => {
    for (const channelId of ["ch-inconnu", "ch-off"])
      await expect(createLinkaffiInviteLink({ ...req, channelId })).rejects.toMatchObject({
        status: 404,
        code: "channel_not_found",
      });
    expect(shareLinks.createJoinRequestLink).not.toHaveBeenCalled();
  });

  it("refus de Telegram : 422 ou 503 (injoignable, avec Retry-After), et rien n'est enregistré", async () => {
    const { TelegramLinkError } = shareLinks;
    for (const [kind, status, code] of [
      ["no_bot", 422, "no_bot"],
      ["refused", 422, "telegram_refused"],
      ["transient", 503, "telegram_unavailable"],
    ] as const) {
      tg.createImpl = async () => {
        throw new TelegramLinkError(kind, `refus ${kind}`);
      };
      const err = await createLinkaffiInviteLink(req).catch((e: unknown) => e);
      expect(err).toMatchObject({ status, code, message: `refus ${kind}` });
      if (kind === "transient")
        expect((err as { headers: Record<string, string> }).headers).toEqual({
          "Retry-After": "60",
        });
    }
    expect(db.links).toHaveLength(0);
  });

  it("deux appels simultanés : un seul lien gardé, celui en trop révoqué, même réponse (200)", async () => {
    db.raceOnCreate = {
      id: "l-gagnant",
      channelId: "ch-zone",
      isActive: true,
      telegramInviteLink: "https://t.me/+gagnant",
      linkaffiCampaignKey: "paul1",
      linkaffiAffiliateId: "aff-paul",
      linkaffiCampaignName: req.campaignName,
      linkaffiAffiliateName: "Paul",
      attributionDays: null,
    };
    const r = await createLinkaffiInviteLink(req);
    expect(r.status).toBe(200);
    expect(r.link).toMatchObject({ inviteLinkId: "l-gagnant", url: "https://t.me/+gagnant" });
    expect(tg.revoke).toHaveBeenCalledTimes(1);
    expect(tg.revoke.mock.calls[0]![0]).toMatchObject({ telegramInviteLink: "https://t.me/+aff1" });
  });
});

describe("PATCH /invite-links/{id} (base et Telegram simulés)", () => {
  beforeEach(async () => {
    db.links.length = 0;
    db.audits.length = 0;
    db.links.push({
      id: "l1",
      channelId: "ch-zone",
      botId: "bot-creator",
      kind: "LINKAFFI",
      isActive: true,
      telegramInviteLink: "https://t.me/+aff1",
      linkaffiCampaignKey: "paul1",
    });
    db.bots.splice(0, db.bots.length, { id: "bot-creator", username: "createur", isActive: true });
    db.channels.splice(0, db.channels.length, {
      id: "ch-zone",
      title: "Zone",
      telegramChatId: -1n,
    });
    tg.revoke.mockReset();
    tg.revoke.mockImplementation(async () => null);
  });

  it("désactive : révocation chez Telegram par le bot créateur, puis inactif ; une 2e fois : rien à faire", async () => {
    const r = await patchLinkaffiInviteLink("l1", false);
    expect(r.changed).toBe(true);
    expect(r.link).toMatchObject({ inviteLinkId: "l1", isActive: false, revokedOnTelegram: true });
    expect(r.message).toMatch(/restent à l'affilié/);
    expect(tg.revoke).toHaveBeenCalledTimes(1);
    expect(tg.revoke.mock.calls[0]![0]).toMatchObject({ bot: { id: "bot-creator" } });
    expect(db.links[0]!.isActive).toBe(false);
    const again = await patchLinkaffiInviteLink("l1", false);
    expect(again).toMatchObject({ changed: false, link: { isActive: false } });
    expect(tg.revoke).toHaveBeenCalledTimes(1);
  });

  it("déjà désactivé : redit le résultat de la révocation journalisée, sinon « inconnu » (null)", async () => {
    db.links[0]!.isActive = false;
    // Désactivé sans trace (autre voie) : on ne sait pas si Telegram l'a retiré.
    const unknown = await patchLinkaffiInviteLink("l1", false);
    expect(unknown).toMatchObject({ changed: false, link: { revokedOnTelegram: null } });
    expect(unknown.message).toMatch(/déjà désactivé/);
    // Premier PATCH : Telegram avait refusé (bot retiré) → la relance le redit, sans prétendre le contraire.
    db.audits.push({ entityId: "l1", metadata: { changed: true, revokedOnTelegram: false } });
    const refused = await patchLinkaffiInviteLink("l1", false);
    expect(refused.link.revokedOnTelegram).toBe(false);
    expect(refused.message).toMatch(/Telegram n'avait pas pu le retirer/);
    db.audits.push({ entityId: "l1", metadata: { changed: true, revokedOnTelegram: true } });
    expect((await patchLinkaffiInviteLink("l1", false)).link.revokedOnTelegram).toBe(true);
    expect(tg.revoke).not.toHaveBeenCalled();
  });

  it("réactivation refusée (409) ; lien actif + isActive true : rien à faire", async () => {
    expect((await patchLinkaffiInviteLink("l1", true)).changed).toBe(false);
    await patchLinkaffiInviteLink("l1", false);
    await expect(patchLinkaffiInviteLink("l1", true)).rejects.toMatchObject({
      status: 409,
      code: "reactivation_refused",
    });
  });

  it("Telegram refuse (bot retiré) : désactivé ici quand même, et la réponse le dit", async () => {
    tg.revoke.mockImplementation(async () => "400 : Bad Request: CHAT_ADMIN_REQUIRED");
    const r = await patchLinkaffiInviteLink("l1", false);
    expect(r.link).toMatchObject({ isActive: false, revokedOnTelegram: false });
    expect(r.message).toMatch(/Telegram n'a pas pu le retirer/);
    expect(db.links[0]!.isActive).toBe(false);
  });

  it("Telegram injoignable : 503, le lien reste actif", async () => {
    const { TelegramLinkError } = shareLinks;
    tg.revoke.mockImplementation(async () => {
      throw new TelegramLinkError("transient", "Telegram ne répond pas pour l'instant.");
    });
    await expect(patchLinkaffiInviteLink("l1", false)).rejects.toMatchObject({
      status: 503,
      code: "telegram_unavailable",
    });
    expect(db.links[0]!.isActive).toBe(true);
  });

  it("lien inconnu (ou d'un autre type) : 404", async () => {
    await expect(patchLinkaffiInviteLink("inconnu", false)).rejects.toMatchObject({
      status: 404,
      code: "invite_link_not_found",
    });
  });
});
