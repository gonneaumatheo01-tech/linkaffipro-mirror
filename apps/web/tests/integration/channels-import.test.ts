import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  ChannelImportError,
  getOrCreateBot,
  importChannelByChatId,
  importChannelByUsername,
  importedChannelMessage,
  prismaTelegramDeps,
  recheckChannelRights,
} from "@linkaffipro/telegram";
import { createTestBot, FakeTelegramWorld, resetDb, type TelegramCall } from "./helpers";

/**
 * Canaux existants côté serveur (base réelle, API grammY interceptée comme pour le webhook) :
 * méthode 2 (lien public), re-vérification des droits, import depuis le compte Telegram.
 */
describe("ajout de canaux existants et re-vérification des droits (base réelle)", () => {
  let world: FakeTelegramWorld;
  let bots: Awaited<ReturnType<typeof createTestBot>>[] = [];
  const calls = new Map<string, TelegramCall[]>();

  beforeAll(async () => {
    await resetDb();
    bots = [
      await createTestBot(111, "CASINO"),
      await createTestBot(222, "SPORTS"),
      await createTestBot(333, "DATING"),
    ];
  });

  beforeEach(() => {
    // Monde neuf à chaque test ; les instances grammY restent en cache, on y rebranche un nouveau monde.
    world = new FakeTelegramWorld();
    for (const b of bots) {
      const api = getOrCreateBot(b, prismaTelegramDeps).api;
      // Les transformateurs s'empilent : le plus récent répond en premier et ne rappelle jamais le précédent.
      calls.set(b.id, world.install(api, b));
    }
  });

  const audits = (entityId: string, action: string) =>
    prisma.auditLog.count({ where: { entityId, action } });

  describe("importChannelByUsername (méthode 2)", () => {
    it("canal public : créé, droits de nos bots administrateurs (return_bots), bot principal posé, audit", async () => {
      world.addChat({
        id: -1009100001,
        title: "Paris VIP",
        username: "paris_vip",
        admins: [111, 222, 9001],
      });
      const r = await importChannelByUsername("https://t.me/paris_vip", { userId: null });
      expect(r.created).toBe(true);
      expect(r.title).toBe("Paris VIP");
      expect(r.admins.map((a) => a.username).sort()).toEqual(["bot_111", "bot_222"]);
      const channel = await prisma.channel.findUniqueOrThrow({
        where: { id: r.channelId },
        include: { botAdmins: { where: { revokedAt: null } } },
      });
      expect(channel.username).toBe("paris_vip");
      expect(channel.botAdmins.map((a) => a.botId).sort()).toEqual(
        [bots[0]!.id, bots[1]!.id].sort(),
      );
      expect([bots[0]!.id, bots[1]!.id]).toContain(channel.primaryBotId);
      expect(await audits(r.channelId, "channel.imported_by_link")).toBe(1);
      // Un seul appel réussi suffit : la liste a été lue par le premier bot qui y a accès, avec return_bots.
      const reads = [...calls.values()].flat().filter((c) => c.method === "getChatAdministrators");
      expect(reads).toHaveLength(1);
      expect(reads[0]!.payload.return_bots).toBe(true);
    });

    it("le même canal collé une seconde fois (t.me/s/…) : « déjà connu », rien n'est dupliqué", async () => {
      world.addChat({
        id: -1009100001,
        title: "Paris VIP",
        username: "paris_vip",
        admins: [111, 222, 9001],
      });
      const r = await importChannelByUsername("https://t.me/s/paris_vip/42");
      expect(r.created).toBe(false);
      expect(await prisma.channel.count({ where: { telegramChatId: -1009100001n } })).toBe(1);
      expect(await prisma.sequence.count({ where: { channelId: r.channelId } })).toBe(5);
    });

    it("lien d'invitation privé ou lien t.me/c/… : erreur qui oriente vers la méthode 1, rien n'est créé", async () => {
      const before = await prisma.channel.count();
      for (const [input, code] of [
        ["https://t.me/+AbCdEf123", "invite"],
        ["https://t.me/c/1234567890/12", "private"],
      ] as const) {
        const err = await importChannelByUsername(input).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ChannelImportError);
        expect((err as ChannelImportError).code).toBe(code);
        expect((err as Error).message).toContain("méthode 1");
      }
      expect(await prisma.channel.count()).toBe(before);
    });

    it("nom introuvable : « Ce canal est privé ou le nom est faux » ; panne de tous les bots : « réessayez dans une minute »", async () => {
      const notFound = await importChannelByUsername("@canal_inexistant").catch((e: unknown) => e);
      expect((notFound as ChannelImportError).code).toBe("not_found");
      expect((notFound as Error).message).toContain("Ce canal est privé ou le nom est faux");
      // 400 : la réponse serait la même avec nos autres bots, un seul essai.
      expect([...calls.values()].flat().filter((c) => c.method === "getChat")).toHaveLength(1);

      world.addChat({ id: -1009100002, title: "Lent", username: "canal_lent", admins: [111] });
      for (const b of bots)
        world.down.set(Number(b.telegramBotId), {
          error_code: 500,
          description: "Internal Server Error",
        });
      const down = await importChannelByUsername("t.me/canal_lent").catch((e: unknown) => e);
      expect((down as ChannelImportError).code).toBe("unavailable");
      expect((down as Error).message).toBe(
        "Vérification impossible pour le moment, réessayez dans une minute.",
      );
      expect(
        await prisma.channel.findUnique({ where: { telegramChatId: -1009100002n } }),
      ).toBeNull();
    });
  });

  describe("recheckChannelRights", () => {
    const CHAT = -1009200001;
    let channelId = "";

    beforeAll(async () => {
      const ch = await prisma.channel.create({
        data: { telegramChatId: BigInt(CHAT), title: "Canal suivi", type: "CHANNEL" },
      });
      channelId = ch.id;
      await prisma.channelBotAdmin.create({
        data: { channelId, botId: bots[0]!.id, rights: { status: "administrator" } },
      });
    });

    const active = async () =>
      (
        await prisma.channelBotAdmin.findMany({
          where: { channelId, revokedAt: null },
          select: { botId: true },
        })
      )
        .map((a) => a.botId)
        .sort();

    it("ajout : un bot devenu administrateur est enregistré, audit", async () => {
      world.addChat({ id: CHAT, title: "Canal suivi", admins: [111, 222, 9001] });
      const r = await recheckChannelRights(channelId, { userId: null });
      expect(r.status).toBe("ok");
      expect(r.admins.map((a) => a.username).sort()).toEqual(["bot_111", "bot_222"]);
      expect(r.revoked).toEqual([]);
      expect(await active()).toEqual([bots[0]!.id, bots[1]!.id].sort());
      expect(await audits(channelId, "channel.rights_rechecked")).toBeGreaterThanOrEqual(1);
    });

    it("retrait confirmé : absent de la liste ET getChatMember « left » → droits retirés", async () => {
      world.addChat({ id: CHAT, title: "Canal suivi", admins: [111, 9001] });
      const r = await recheckChannelRights(channelId, { audit: false });
      expect(r.status).toBe("ok");
      expect(r.revoked).toEqual(["bot_222"]);
      expect(await active()).toEqual([bots[0]!.id]);
      const confirm = [...calls.values()].flat().filter((c) => c.method === "getChatMember");
      expect(confirm.map((c) => c.payload.user_id)).toEqual([222]);
    });

    it("500 sur tous les bots : vérification impossible, droits enregistrés conservés", async () => {
      world.addChat({ id: CHAT, title: "Canal suivi", admins: [] });
      for (const b of bots)
        world.down.set(Number(b.telegramBotId), {
          error_code: 500,
          description: "Internal Server Error",
        });
      const r = await recheckChannelRights(channelId, { audit: false });
      expect(r.status).toBe("unavailable");
      expect(r.revoked).toEqual([]);
      expect(r.warning).toContain("Vérification impossible pour le moment");
      expect(await active()).toEqual([bots[0]!.id]);
    });

    it("403 sur tous les bots : aucun n'est plus administrateur, tout est retiré", async () => {
      world.addChat({ id: CHAT, title: "Canal suivi", admins: [9001] });
      const r = await recheckChannelRights(channelId, { audit: false });
      expect(r.status).toBe("not_admin");
      expect(r.revoked).toEqual(["bot_111"]);
      expect(r.warning).toBe("Aucun de nos bots n'est administrateur de ce canal.");
      expect(await active()).toEqual([]);
    });
  });

  describe("importChannelByChatId (« Importer tous mes canaux »)", () => {
    it("canal privé où un seul de nos bots est administrateur : titre à jour lu par ce bot, droits, bot principal = ce bot", async () => {
      world.addChat({ id: -1009300001, title: "Privé (titre Telegram)", admins: [333, 9001] });
      const r = await importChannelByChatId(
        {
          telegramChatId: -1009300001n,
          title: "Privé (titre du compte)",
          username: null,
          isBroadcast: true,
        },
        { userId: null },
      );
      expect(r.created).toBe(true);
      expect(r.title).toBe("Privé (titre Telegram)");
      expect(r.admins.map((a) => a.username)).toEqual(["bot_333"]);
      const channel = await prisma.channel.findUniqueOrThrow({ where: { id: r.channelId } });
      expect(channel.primaryBotId).toBe(bots[2]!.id);
      expect(await audits(r.channelId, "channel.imported_from_account")).toBe(1);
    });

    it("aucun de nos bots n'y a accès : canal créé avec les informations du compte, sans bot, explication", async () => {
      world.addChat({ id: -1009300002, title: "Inaccessible", admins: [9001] });
      const r = await importChannelByChatId({
        telegramChatId: -1009300002n,
        title: "Groupe du compte",
        username: null,
        isBroadcast: false,
      });
      expect(r.created).toBe(true);
      expect(r.admins).toEqual([]);
      expect(r.status).toBe("not_admin");
      expect(r.warning).toBe("Aucun de nos bots n'est administrateur de ce canal.");
      expect(importedChannelMessage(r)).toContain("aucun de nos bots n'est administrateur");
      const channel = await prisma.channel.findUniqueOrThrow({ where: { id: r.channelId } });
      expect(channel.title).toBe("Groupe du compte");
      expect(channel.type).toBe("GROUP");
    });

    it("panne ou 429 sur tous nos bots pendant l'import : canal créé, statut « unavailable », jamais annoncé « sans bot »", async () => {
      world.addChat({ id: -1009300003, title: "Canal lent", admins: [111, 9001] });
      for (const b of bots)
        world.down.set(Number(b.telegramBotId), {
          error_code: 429,
          description: "Too Many Requests: retry after 5",
        });
      const r = await importChannelByChatId({
        telegramChatId: -1009300003n,
        title: "Canal lent",
        username: null,
        isBroadcast: true,
      });
      expect(r.created).toBe(true);
      expect(r.admins).toEqual([]);
      expect(r.status).toBe("unavailable");
      const message = importedChannelMessage(r);
      expect(message).toContain("non vérifiables pour le moment");
      expect(message).not.toContain("aucun de nos bots n'est administrateur");
    });
  });
});
