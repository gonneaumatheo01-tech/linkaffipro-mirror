import { GrammyError, HttpError } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Liens de partage (phase 11) : règles pures (nom, refus de Telegram en français, règle appliquée au lien) et
 * création / désactivation avec une base et un Telegram simulés (choix du bot, demande d'adhésion, journal).
 * Le parcours sur base réelle est dans tests/integration/share-links.test.ts.
 */

type Bot = { id: string; username: string; isActive: boolean; tokenEncrypted: string };
const db = vi.hoisted(() => ({
  channels: [] as Array<{ id: string; title: string; telegramChatId: bigint; language: string }>,
  admins: [] as Array<{ channelId: string; botId: string; rights: unknown; bot: Bot }>,
  links: [] as Array<Record<string, unknown> & { id: string }>,
  audits: [] as Array<Record<string, unknown>>,
  acting: null as Bot | null,
  /** Réponse simulée de Telegram, par bot. */
  telegram: new Map<string, (method: string, payload: Record<string, unknown>) => unknown>(),
  calls: [] as Array<{ bot: string; method: string; payload: Record<string, unknown> }>,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.channels.find((c) => c.id === where.id) ?? null,
      ),
    },
    channelBotAdmin: {
      findMany: vi.fn(async ({ where }: { where: { channelId: string } }) =>
        db.admins.filter((a) => a.channelId === where.channelId && a.bot.isActive),
      ),
    },
    inviteLink: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const name = (where.name as { equals?: string } | undefined)?.equals?.toLowerCase();
        const l = db.links.find(
          (x) =>
            (!where.id || x.id === where.id) &&
            x.channelId === where.channelId &&
            x.kind === where.kind &&
            (where.isActive === undefined || x.isActive === where.isActive) &&
            (!name || String(x.name).toLowerCase() === name),
        );
        if (!l) return null;
        const bot = db.admins.find((a) => a.botId === l.botId)?.bot;
        const channel = db.channels.find((c) => c.id === l.channelId);
        return { ...l, bot, channel };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `l${db.links.length + 1}`, isActive: true, ...data };
        db.links.push(row);
        return { ...row, telegramInviteLink: data.telegramInviteLink };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const l = db.links.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return l;
        },
      ),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => {
    db.audits.push(a);
  }),
}));
vi.mock("./acting-bot", () => ({ actingStandardBotFor: vi.fn(async () => db.acting) }));
vi.mock("@linkaffipro/telegram", () => ({
  canInviteFromRights: (r: unknown) =>
    r && typeof r === "object" && "can_invite_users" in r
      ? Boolean((r as { can_invite_users: unknown }).can_invite_users)
      : null,
  prismaTelegramDeps: {},
  getOrCreateBot: (bot: Bot) => {
    const call = (method: string) => async (chatId: unknown, other: unknown) => {
      const payload =
        method === "createChatInviteLink"
          ? { chat_id: chatId, ...(other as object) }
          : { chat_id: chatId, invite_link: other };
      db.calls.push({ bot: bot.username, method, payload });
      const fake = db.telegram.get(bot.id);
      if (!fake) throw new Error("Telegram non simulé");
      return fake(method, payload);
    };
    return {
      api: {
        createChatInviteLink: call("createChatInviteLink"),
        revokeChatInviteLink: call("revokeChatInviteLink"),
      },
    };
  },
}));

const sl = await import("./share-links");

const refused = (description = "Bad Request: not enough rights to manage chat invite links") =>
  new GrammyError(
    "Call failed",
    { ok: false, error_code: 400, description },
    "createChatInviteLink",
    {},
  );
const bot = (id: string, username = id): Bot => ({
  id,
  username,
  isActive: true,
  tokenEncrypted: "x",
});

describe("liens de partage : règles pures", () => {
  it("nom saisi : espaces retirés, obligatoire, 64 caractères au plus ; 32 chez Telegram sans couper un émoji", () => {
    expect(sl.parseShareName("  Post   Tir Cadré ")).toEqual({ name: "Post Tir Cadré" });
    expect(sl.parseShareName("")).toEqual({
      error: "Donnez un nom au lien (par exemple « Post Tir Cadré »).",
    });
    expect("error" in sl.parseShareName("x".repeat(65))).toBe(true);
    expect(sl.telegramLinkName("x".repeat(40))).toHaveLength(32);
    expect(Array.from(sl.telegramLinkName(`${"a".repeat(31)}🔞🔞`))).toHaveLength(32);
    expect(sl.telegramLinkName(`${"a".repeat(31)}🔞🔞`).endsWith("🔞")).toBe(true);
  });

  it("refus de Telegram expliqué en français, avec le droit à donner", () => {
    expect(sl.createErrorMessage(refused(), "zone_bot", "Zone Interdite")).toBe(
      "Telegram refuse que @zone_bot crée un lien dans « Zone Interdite ». Ajoutez @zone_bot comme administrateur de « Zone Interdite » avec le droit « Inviter via un lien », puis réessayez.",
    );
    const busy = new GrammyError(
      "x",
      { ok: false, error_code: 429, description: "Too Many Requests" },
      "m",
      {},
    );
    expect(sl.isTransientTelegramError(busy)).toBe(true);
    expect(sl.isTransientTelegramError(new HttpError("réseau", new Error("ECONNRESET")))).toBe(
      true,
    );
    expect(sl.isTransientTelegramError(refused())).toBe(false);
    expect(sl.createErrorMessage(busy, "b", "c")).toMatch(/réessayez dans une minute/);
    expect(
      sl.createErrorMessage(
        new GrammyError("x", { ok: false, error_code: 401, description: "Unauthorized" }, "m", {}),
        "b",
        "c",
      ),
    ).toMatch(/Réglages → Bots/);
    expect(
      sl.createErrorMessage(
        new GrammyError("x", { ok: false, error_code: 404, description: "Not Found" }, "m", {}),
        "b",
        "c",
      ),
    ).toMatch(/n'est plus reconnu par Telegram/);
    expect(sl.isGoneLinkError(refused("Bad Request: INVITE_HASH_EXPIRED"))).toBe(true);
    expect(sl.isGoneLinkError(refused())).toBe(false);
    expect(
      sl.isGoneLinkError(
        new GrammyError("x", { ok: false, error_code: 404, description: "Not Found" }, "m", {}),
      ),
    ).toBe(false);
  });

  it("règle appliquée au lien : même résolution que le bot (lien précis → canal d'origine → type → défaut)", () => {
    const rule = (over: Record<string, unknown>) =>
      ({
        id: "r",
        channelId: "zone",
        scope: "DEFAULT",
        isDefault: true,
        isActive: true,
        inviteLinkId: null,
        sourceChannelId: null,
        sourceKind: null,
        sortOrder: 0,
        label: null,
        mode: "DELAY",
        delaySeconds: 300,
        gateMode: "REQUIRED",
        gateChannelIds: ["roulette", "tir"],
        ...over,
      }) as never;
    const def = rule({ id: "def" });
    const tir = rule({
      id: "tir",
      scope: "SOURCE_CHANNEL",
      isDefault: false,
      sourceChannelId: "tir",
      label: "Venu de « Tir Cadré »",
      delaySeconds: 86400,
      gateMode: "NONE",
      gateChannelIds: [],
    });
    const own = rule({
      id: "own",
      scope: "INVITE_LINK",
      isDefault: false,
      inviteLinkId: "story",
      label: "Venu du lien « Story »",
      mode: "IMMEDIATE",
      gateMode: "NONE",
      gateChannelIds: [],
    });
    // Lien posté dans « Tir Cadré » : l'exception du canal d'origine ; « Tir Cadré » ne lui est pas redemandé.
    expect(sl.shareRuleText({ id: "post", sourceChannelId: "tir" }, "zone", [def, tir])).toEqual({
      text: "Règle : 1 jour (Venu de « Tir Cadré »)",
      ownException: false,
    });
    expect(sl.shareRuleText({ id: "post", sourceChannelId: "tir" }, "zone", [def])).toEqual({
      text: "Règle par défaut : 5 minutes après les canaux à rejoindre",
      ownException: false,
    });
    expect(
      sl.shareRuleText({ id: "story", sourceChannelId: null }, "zone", [def, tir, own]),
    ).toEqual({
      text: "Règle : tout de suite (Venu du lien « Story »)",
      ownException: true,
    });
    expect(sl.shareRuleText({ id: "x", sourceChannelId: null }, "zone", [])).toEqual({
      text: "Aucune règle : à valider à la main",
      ownException: false,
    });
  });

  it("message de « Désactiver » : retiré de Telegram, déjà fait, ou désactivé ici seulement", () => {
    const base = { name: "Post", bot: "zone_bot", error: null, alreadyDisabled: false };
    expect(sl.disabledMessage({ ...base, revokedOnTelegram: true }, "Zone")).toBe(
      "Lien « Post » désactivé : il ne fonctionne plus dans Telegram. Les demandes déjà reçues restent.",
    );
    expect(
      sl.disabledMessage({ ...base, revokedOnTelegram: true, alreadyDisabled: true }, "Zone"),
    ).toBe("Le lien « Post » était déjà désactivé.");
    expect(sl.disabledMessage({ ...base, revokedOnTelegram: false, error: "400" }, "Zone")).toMatch(
      /désactivé ici, mais Telegram n'a pas pu le retirer \(@zone_bot.*Gérer le canal → Liens d'invitation/,
    );
  });
});

describe("liens de partage : création et désactivation (base et Telegram simulés)", () => {
  const zone = { id: "zone", title: "Zone Interdite", telegramChatId: -1001n, language: "fr" };
  const tir = { id: "tir", title: "Tir Cadré", telegramChatId: -1002n, language: "fr" };
  const principal = bot("b1", "zone_bot");
  const secours = bot("b2", "secours_bot");
  let n = 0;
  const ok = () => ({ invite_link: `https://t.me/+share${++n}`, creates_join_request: true });

  beforeEach(() => {
    db.channels = [zone, tir];
    db.admins = [
      { channelId: "zone", botId: "b1", rights: { can_invite_users: true }, bot: principal },
      { channelId: "zone", botId: "b2", rights: { can_invite_users: true }, bot: secours },
    ];
    db.links = [];
    db.audits = [];
    db.calls = [];
    db.acting = principal;
    db.telegram = new Map([
      ["b1", ok],
      ["b2", ok],
    ]);
  });

  it("créé par le bot qui agit pour le canal, AVEC demande d'adhésion, nommé, à poster dans un canal ; journal", async () => {
    const r = await sl.createShareLink({
      channelId: "zone",
      name: "Post Tir Cadré",
      sourceChannelId: "tir",
      userId: "u-manager",
    });
    expect(db.calls).toEqual([
      {
        bot: "zone_bot",
        method: "createChatInviteLink",
        payload: { chat_id: -1001, name: "Post Tir Cadré", creates_join_request: true },
      },
    ]);
    expect(db.links[0]).toMatchObject({
      channelId: "zone",
      botId: "b1",
      kind: "SHARE",
      createsJoinRequest: true,
      name: "Post Tir Cadré",
      sourceChannelId: "tir",
      createdById: "u-manager",
      telegramInviteLink: r.url,
    });
    expect(db.audits).toEqual([
      {
        userId: "u-manager",
        action: "invite_link.share_created",
        entityType: "InviteLink",
        entityId: r.id,
        metadata: {
          channelId: "zone",
          name: "Post Tir Cadré",
          sourceChannelId: "tir",
          botId: "b1",
        },
      },
    ]);
  });

  it("le bot principal n'a pas le droit : un autre de nos bots administrateurs crée le lien", async () => {
    db.telegram.set("b1", () => {
      throw refused();
    });
    await sl.createShareLink({
      channelId: "zone",
      name: "Story",
      sourceChannelId: null,
      userId: "u",
    });
    expect(db.calls.map((c) => c.bot)).toEqual(["zone_bot", "secours_bot"]);
    expect(db.links[0]).toMatchObject({ botId: "b2", sourceChannelId: null });
  });

  it("refus : rien n'est créé, message en français ; Telegram injoignable : pas d'autre essai", async () => {
    db.telegram.set("b1", () => {
      throw refused();
    });
    db.telegram.set("b2", () => {
      throw refused();
    });
    await expect(
      sl.createShareLink({ channelId: "zone", name: "Story", sourceChannelId: null, userId: "u" }),
    ).rejects.toThrow(
      /Ajoutez @zone_bot comme administrateur de « Zone Interdite » avec le droit « Inviter via un lien »/,
    );
    expect(db.links).toEqual([]);
    expect(db.audits).toEqual([]);

    db.calls = [];
    db.telegram.set("b1", () => {
      throw new HttpError("réseau", new Error("ETIMEDOUT"));
    });
    await expect(
      sl.createShareLink({ channelId: "zone", name: "Story", sourceChannelId: null, userId: "u" }),
    ).rejects.toThrow(/réessayez dans une minute/);
    expect(db.calls).toHaveLength(1);
  });

  it("garde-fous : aucun bot administrateur, canal d'origine = ce canal, nom déjà pris", async () => {
    db.acting = null;
    db.admins = [];
    await expect(
      sl.createShareLink({ channelId: "zone", name: "Story", sourceChannelId: null, userId: "u" }),
    ).rejects.toThrow(/Aucun de nos bots n'est administrateur de « Zone Interdite »/);
    await expect(
      sl.createShareLink({
        channelId: "zone",
        name: "Story",
        sourceChannelId: "zone",
        userId: "u",
      }),
    ).rejects.toThrow(/autre canal que celui-ci/);
    db.links = [{ id: "old", channelId: "zone", kind: "SHARE", isActive: true, name: "story" }];
    await expect(
      sl.createShareLink({ channelId: "zone", name: "Story", sourceChannelId: null, userId: "u" }),
    ).rejects.toThrow(/s'appelle déjà « Story »/);
  });

  it("désactivation : révoqué par le bot qui l'a créé, puis inactif ; journal", async () => {
    const r = await sl.createShareLink({
      channelId: "zone",
      name: "Post",
      sourceChannelId: null,
      userId: "u",
    });
    db.calls = [];
    db.audits = [];
    const d = await sl.disableShareLink({ channelId: "zone", linkId: r.id, userId: "u2" });
    expect(d).toMatchObject({ revokedOnTelegram: true, error: null, alreadyDisabled: false });
    expect(db.calls).toEqual([
      {
        bot: "zone_bot",
        method: "revokeChatInviteLink",
        payload: { chat_id: -1001, invite_link: r.url },
      },
    ]);
    expect(db.links[0]!.isActive).toBe(false);
    expect(db.audits[0]).toMatchObject({
      userId: "u2",
      action: "invite_link.share_disabled",
      entityId: r.id,
      metadata: { revokedOnTelegram: true, error: null },
    });
    // Deuxième clic : rien de plus chez Telegram.
    expect(
      await sl.disableShareLink({ channelId: "zone", linkId: r.id, userId: "u2" }),
    ).toMatchObject({
      alreadyDisabled: true,
    });
    expect(db.calls).toHaveLength(1);
  });

  it("désactivation : Telegram injoignable → rien ne change ; refus définitif → désactivé ici, et dit", async () => {
    const r = await sl.createShareLink({
      channelId: "zone",
      name: "Post",
      sourceChannelId: null,
      userId: "u",
    });
    db.telegram.set("b1", () => {
      throw new HttpError("réseau", new Error("ECONNRESET"));
    });
    await expect(
      sl.disableShareLink({ channelId: "zone", linkId: r.id, userId: "u" }),
    ).rejects.toThrow(/Le lien fonctionne encore/);
    expect(db.links[0]!.isActive).toBe(true);
    db.telegram.set("b1", () => {
      throw refused("Bad Request: CHAT_ADMIN_REQUIRED");
    });
    const d = await sl.disableShareLink({ channelId: "zone", linkId: r.id, userId: "u" });
    expect(d).toMatchObject({
      revokedOnTelegram: false,
      error: "400 : Bad Request: CHAT_ADMIN_REQUIRED",
    });
    expect(db.links[0]!.isActive).toBe(false);
    // Lien déjà retiré chez Telegram : la désactivation est acquise.
    const r2 = await sl.createShareLink({
      channelId: "zone",
      name: "Autre",
      sourceChannelId: null,
      userId: "u",
    });
    db.telegram.set("b1", () => {
      throw refused("Bad Request: INVITE_HASH_EXPIRED");
    });
    expect(
      await sl.disableShareLink({ channelId: "zone", linkId: r2.id, userId: "u" }),
    ).toMatchObject({
      revokedOnTelegram: true,
    });
    await expect(
      sl.disableShareLink({ channelId: "tir", linkId: r2.id, userId: "u" }),
    ).rejects.toThrow(/n'existe plus/);
  });
});
