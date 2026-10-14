/**
 * Phase 13 : API d'intégration appelée par Link Affi (`/api/integrations/linkaffi/v1`) et sous-section « Campagnes
 * Telegram des affiliés » de Réglages → Connexions, sur base réelle (Telegram simulé, Link Affi simulé par un petit
 * serveur HTTP local qui vérifie la signature ; aucun appel réseau réel).
 *
 * Parcours : un ADMIN génère la clé de connexion et le secret de signature (montrés une seule fois, stockés en empreinte
 * et chiffré) ; Link Affi lit les canaux proposables, crée le lien d'une campagne d'affilié (avec demande d'adhésion,
 * par le bot du canal ou un bot de repli), le redemande (même lien, aucun nouvel appel à Telegram), en crée un pour un
 * autre canal, le désactive (révocation par le bot créateur), puis rattrape membres et événements ; clé absente ou
 * fausse → 401, 61e appel de la minute → 429, corps invalide → 400 en français ; chaque appel au journal, sans la clé.
 * Enfin l'événement de test signé vers la fonction Link Affi simulée : reçu / signature refusée / injoignable.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Api } from "grammy";
import {
  buildLinkaffiEvent,
  decrypt,
  hashIntegrationApiKey,
  verifyLinkaffiSignature,
} from "@linkaffipro/core";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { capturedJobs, createTestBot, ctx, resetDb, type TelegramCall } from "./helpers";

const session = vi.hoisted(() => {
  class ForbiddenError extends Error {}
  return {
    ForbiddenError,
    user: null as null | {
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "MANAGER";
      telegramUserId: bigint | null;
    },
  };
});
vi.mock("@/lib/session", () => ({
  ForbiddenError: session.ForbiddenError,
  requireUser: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  },
  requireAdmin: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    if (session.user.role !== "ADMIN") throw new session.ForbiddenError("réservé");
    return session.user;
  },
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const channelsRoute = await import("@/app/api/integrations/linkaffi/v1/channels/route");
const inviteLinksRoute = await import("@/app/api/integrations/linkaffi/v1/invite-links/route");
const inviteLinkRoute =
  await import("@/app/api/integrations/linkaffi/v1/invite-links/[inviteLinkId]/route");
const membersRoute = await import("@/app/api/integrations/linkaffi/v1/members/route");
const unknownRoute = await import("@/app/api/integrations/linkaffi/v1/[...path]/route");
const rootRoute = await import("@/app/api/integrations/linkaffi/v1/route");
const actions = await import("@/app/(admin)/settings/connectors/affiliates-actions");
const { loadLinkaffiIntegrationState } = await import("@/lib/integrations/linkaffi/settings");

const BASE = "https://app.linkaffipro.com/api/integrations/linkaffi/v1";
const ZONE = -1001830000001n;
const TIR = -1001830000002n;
const NO_RIGHT = -1001830000003n;
const OFF = -1001830000004n;
const MEDIA = -1001830000005n;
const REVOKED = -1001830000006n;

/** Telegram simulé par bot : liens uniques avec demande d'adhésion, refus et pannes à la demande. */
class FakeTelegram {
  refuse = new Set<number>();
  down = new Set<number>();
  private n = 0;
  install(api: Api, selfId: number): TelegramCall[] {
    const calls: TelegramCall[] = [];
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (this.down.has(selfId))
        return { ok: false, error_code: 502, description: "Bad Gateway" } as never;
      if (this.refuse.has(selfId))
        return {
          ok: false,
          error_code: 400,
          description: "Bad Request: not enough rights to manage chat invite links",
        } as never;
      if (method === "revokeChatInviteLink")
        return {
          ok: true,
          result: { invite_link: p.invite_link, is_revoked: true, creates_join_request: true },
        } as never;
      if (method === "createChatInviteLink")
        return {
          ok: true,
          result: {
            invite_link: `https://t.me/+aff${selfId}x${++this.n}`,
            creator: { id: selfId, is_bot: true, first_name: "bot" },
            creates_join_request: p.creates_join_request === true,
            is_primary: false,
            is_revoked: false,
            name: p.name,
          },
        } as never;
      return { ok: true, result: true } as never;
    });
    return calls;
  }
}

function fd(values: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

function api(
  path: string,
  init: { method?: string; key?: string | null; body?: unknown; raw?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const routeCtx = ctx({});

describe("API d'intégration Link Affi et réglages (base réelle, Telegram et Link Affi simulés)", () => {
  const tg = new FakeTelegram();
  const calls: Record<string, TelegramCall[]> = {};
  const ids = {
    zone: "",
    tir: "",
    noRight: "",
    off: "",
    media: "",
    revoked: "",
    main: "",
    backup: "",
    sports: "",
    admin: "",
    manager: "",
  };
  let key = "";
  let secret = "";
  let zoneLink = { inviteLinkId: "", url: "" };

  beforeAll(async () => {
    await resetDb();
    await prisma.linkaffiEvent.deleteMany();
    await prisma.integrationKey.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "integration." } } });
    const main = await createTestBot(831, "DATING");
    const backup = await createTestBot(832, "DATING");
    const sports = await createTestBot(833, "SPORTS");
    ids.main = main.id;
    ids.backup = backup.id;
    ids.sports = sports.id;
    calls.main = tg.install(getOrCreateBot(main, prismaTelegramDeps).api, 831);
    calls.backup = tg.install(getOrCreateBot(backup, prismaTelegramDeps).api, 832);
    calls.sports = tg.install(getOrCreateBot(sports, prismaTelegramDeps).api, 833);
    const channel = async (
      chatId: bigint,
      title: string,
      opts: {
        primary?: string;
        admins: Array<{ botId: string; rights: unknown; revoked?: boolean }>;
        isActive?: boolean;
        isMediaLibrary?: boolean;
        username?: string;
        vertical?: "CASINO" | "SPORTS" | "DATING";
      },
    ) => {
      const c = await prisma.channel.create({
        data: {
          telegramChatId: chatId,
          title,
          language: "fr",
          primaryBotId: opts.primary,
          isTest: true,
          isActive: opts.isActive ?? true,
          isMediaLibrary: opts.isMediaLibrary ?? false,
          username: opts.username,
          vertical: opts.vertical,
        },
      });
      for (const a of opts.admins)
        await prisma.channelBotAdmin.create({
          data: {
            channelId: c.id,
            botId: a.botId,
            rights: a.rights as never,
            revokedAt: a.revoked ? new Date() : null,
          },
        });
      return c.id;
    };
    const invite = { status: "administrator", can_invite_users: true };
    ids.zone = await channel(ZONE, "Zone Interdite 🔞", {
      primary: main.id,
      admins: [
        { botId: main.id, rights: invite },
        { botId: backup.id, rights: invite },
      ],
      vertical: "DATING",
      username: "zoneinterdite",
    });
    // Droits pas encore relus : proposé (la création essaiera le bot).
    ids.tir = await channel(TIR, "Tir Cadré", {
      primary: sports.id,
      admins: [{ botId: sports.id, rights: {} }],
      vertical: "SPORTS",
    });
    ids.noRight = await channel(NO_RIGHT, "Sans droit d'inviter", {
      admins: [{ botId: main.id, rights: { status: "administrator", can_invite_users: false } }],
    });
    ids.off = await channel(OFF, "Canal arrêté", {
      admins: [{ botId: main.id, rights: invite }],
      isActive: false,
    });
    ids.media = await channel(MEDIA, "Bibliothèque de médias", {
      admins: [{ botId: main.id, rights: invite }],
      isMediaLibrary: true,
    });
    ids.revoked = await channel(REVOKED, "Bot retiré", {
      admins: [{ botId: main.id, rights: invite, revoked: true }],
    });
    const stamp = Date.now();
    ids.admin = (
      await prisma.user.create({
        data: {
          email: `lai-a-${stamp}@test.local`,
          passwordHash: "x",
          name: "Admin",
          role: "ADMIN",
        },
      })
    ).id;
    ids.manager = (
      await prisma.user.create({
        data: {
          email: `lai-m-${stamp}@test.local`,
          passwordHash: "x",
          name: "Resp",
          role: "MANAGER",
        },
      })
    ).id;
  });

  beforeEach(() => {
    tg.refuse.clear();
    tg.down.clear();
    session.user = {
      id: ids.admin,
      email: "a@test.local",
      name: "Admin",
      role: "ADMIN",
      telegramUserId: null,
    };
  });

  describe("réglages : clé de connexion et secret de signature", () => {
    it("un responsable ne peut rien générer", async () => {
      session.user = { ...session.user!, id: ids.manager, role: "MANAGER" };
      expect(await actions.generateLinkaffiKeyAction(null, fd())).toEqual({
        error: "Réservé aux administrateurs.",
      });
      expect(await actions.generateLinkaffiSecretAction(null, fd())).toEqual({
        error: "Réservé aux administrateurs.",
      });
      expect(await actions.sendLinkaffiTestEventAction(null, fd())).toEqual({
        error: "Réservé aux administrateurs.",
      });
      expect(await prisma.integrationKey.count()).toBe(0);
    });

    it("un ADMIN génère la clé : montrée une fois, stockée en empreinte, jamais au journal ni dans la page", async () => {
      const r = await actions.generateLinkaffiKeyAction(null, fd());
      expect(r?.value).toMatch(/^lap_live_[A-Za-z0-9]{40}$/);
      expect(r?.regenerated).toBe(false);
      key = r!.value!;
      const row = await prisma.integrationKey.findUniqueOrThrow({
        where: { provider: "linkaffi" },
      });
      expect(row.apiKeyHash).toBe(hashIntegrationApiKey(key));
      expect(row.apiKeyPrefix).toBe(`${key.slice(0, 13)}…`);
      expect(row.apiKeyCreatedById).toBe(ids.admin);
      expect(JSON.stringify(row)).not.toContain(key);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "integration.linkaffi_key_generated" },
      });
      expect(audit).toMatchObject({ userId: ids.admin, entityType: "IntegrationKey" });
      expect(JSON.stringify(audit)).not.toContain(key);
      const state = await loadLinkaffiIntegrationState();
      expect(state.keyPrefix).toBe(row.apiKeyPrefix);
      expect(state.keyCreatedBy).toBe("Admin");
      expect(JSON.stringify(state)).not.toContain(key);
    });

    it("un ADMIN génère le secret : montré une fois, stocké chiffré", async () => {
      const r = await actions.generateLinkaffiSecretAction(null, fd());
      expect(r?.value).toMatch(/^lap_whsec_[A-Za-z0-9]{40}$/);
      secret = r!.value!;
      const row = await prisma.integrationKey.findUniqueOrThrow({
        where: { provider: "linkaffi" },
      });
      expect(row.webhookSecretEncrypted).not.toContain(secret);
      expect(decrypt(row.webhookSecretEncrypted!)).toBe(secret);
      const state = await loadLinkaffiIntegrationState();
      expect(state.hasSecret).toBe(true);
      expect(JSON.stringify(state)).not.toContain(secret);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "integration.linkaffi_secret_generated" },
      });
      expect(JSON.stringify(audit)).not.toContain(secret);
    });
  });

  describe("appels de Link Affi", () => {
    it("sans clé ou avec une fausse clé : 401 en français", async () => {
      const none = await channelsRoute.GET(api("/channels"), routeCtx);
      expect(none.status).toBe(401);
      expect(await none.json()).toEqual({
        error: "unauthorized",
        message: expect.stringMatching(/^Clé de connexion absente/),
      });
      const wrong = await channelsRoute.GET(api("/channels", { key: `${key}x` }), routeCtx);
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).message).toMatch(/^Clé de connexion refusée/);
    });

    it("GET /channels : canaux actifs où un de nos bots peut créer des liens", async () => {
      const res = await channelsRoute.GET(api("/channels", { key }), routeCtx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { id: ids.tir, title: "Tir Cadré", username: null, vertical: "SPORTS", isActive: true },
        {
          id: ids.zone,
          title: "Zone Interdite 🔞",
          username: "zoneinterdite",
          vertical: "DATING",
          isActive: true,
        },
      ]);
      const row = await prisma.integrationKey.findUniqueOrThrow({
        where: { provider: "linkaffi" },
      });
      expect(row.lastApiCallAt).toBeInstanceOf(Date);
    });

    it("POST /invite-links : corps invalide → 400 en français, rien n'est créé", async () => {
      const bad = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: { campaignKey: "a b", channelId: ids.zone },
        }),
        routeCtx,
      );
      expect(bad.status).toBe(400);
      const body = await bad.json();
      expect(body.error).toBe("invalid_body");
      expect(body.message).toMatch(/^Requête invalide : « campaignKey » doit faire de 1 à 64/);
      expect(body.details.map((d: { field: string }) => d.field)).toEqual([
        "campaignKey",
        "campaignName",
        "affiliateId",
      ]);
      const notJson = await inviteLinksRoute.POST(
        api("/invite-links", { method: "POST", key, raw: "{oups" }),
        routeCtx,
      );
      expect(notJson.status).toBe(400);
      expect((await notJson.json()).message).toBe(
        "Le corps de la requête n'est pas du JSON valide.",
      );
      const unknown = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "k",
            campaignName: "n",
            affiliateId: "a",
            affiliateName: "A",
            channelId: ids.off,
          },
        }),
        routeCtx,
      );
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error).toBe("channel_not_found");
      expect(await prisma.inviteLink.count({ where: { kind: "LINKAFFI" } })).toBe(0);
    });

    it("POST /invite-links : lien créé avec demande d'adhésion par le bot du canal (201)", async () => {
      const res = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Paul · Zone Interdite",
            affiliateId: "aff-paul",
            affiliateName: "Paul",
            channelId: ids.zone,
            attributionDays: 30,
          },
        }),
        routeCtx,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({
        inviteLinkId: expect.any(String),
        url: expect.stringMatching(/^https:\/\/t\.me\/\+aff831x\d+$/),
        isActive: true,
        channelId: ids.zone,
        campaignKey: "paul_zone1",
      });
      zoneLink = { inviteLinkId: body.inviteLinkId, url: body.url };
      const create = calls.main!.filter((c) => c.method === "createChatInviteLink");
      expect(create).toHaveLength(1);
      expect(create[0]!.payload).toMatchObject({
        chat_id: Number(ZONE),
        name: "Paul · Zone Interdite",
        creates_join_request: true,
      });
      const row = await prisma.inviteLink.findUniqueOrThrow({ where: { id: body.inviteLinkId } });
      expect(row).toMatchObject({
        kind: "LINKAFFI",
        channelId: ids.zone,
        botId: ids.main,
        createsJoinRequest: true,
        telegramInviteLink: body.url,
        linkaffiCampaignKey: "paul_zone1",
        linkaffiCampaignName: "Paul · Zone Interdite",
        linkaffiAffiliateId: "aff-paul",
        linkaffiAffiliateName: "Paul",
        attributionDays: 30,
        isActive: true,
        createdById: null,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "integration.linkaffi.post_invite_links", entityId: body.inviteLinkId },
      });
      expect(audit).toMatchObject({ userId: null, entityType: "InviteLink" });
      expect(audit.metadata).toMatchObject({
        method: "POST",
        status: 201,
        campaignKey: "paul_zone1",
        channelId: ids.zone,
        affiliateId: "aff-paul",
        created: true,
        botId: ids.main,
      });
    });

    it("POST /invite-links une 2e fois : même lien (200), aucun nouvel appel à Telegram", async () => {
      const before = calls.main!.length;
      const res = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Paul · Zone Interdite",
            affiliateId: "aff-paul",
            affiliateName: "Paul",
            channelId: ids.zone,
            attributionDays: 30,
          },
        }),
        routeCtx,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject(zoneLink);
      expect(calls.main!.length).toBe(before);
      expect(
        await prisma.inviteLink.count({
          where: { kind: "LINKAFFI", linkaffiCampaignKey: "paul_zone1" },
        }),
      ).toBe(1);
      // Relance sans les champs facultatifs (nom de l'affilié, durée) : rien n'est effacé.
      const relaunch = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Paul · Zone Interdite",
            affiliateId: "aff-paul",
            channelId: ids.zone,
          },
        }),
        routeCtx,
      );
      expect(relaunch.status).toBe(200);
      expect(
        await prisma.inviteLink.findUniqueOrThrow({
          where: { id: zoneLink.inviteLinkId },
          select: { linkaffiAffiliateName: true, attributionDays: true },
        }),
      ).toEqual({ linkaffiAffiliateName: "Paul", attributionDays: 30 });
      expect(calls.main!.length).toBe(before);
    });

    it("même clé, autre canal : un autre lien, créé par le bot de ce canal ; autre affilié : 409", async () => {
      const res = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Paul · Tir",
            affiliateId: "aff-paul",
            affiliateName: "Paul",
            channelId: ids.tir,
          },
        }),
        routeCtx,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.inviteLinkId).not.toBe(zoneLink.inviteLinkId);
      expect(body.url).toMatch(/^https:\/\/t\.me\/\+aff833x/);
      const mismatch = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Marc",
            affiliateId: "aff-marc",
            affiliateName: "Marc",
            channelId: ids.zone,
          },
        }),
        routeCtx,
      );
      expect(mismatch.status).toBe(409);
      expect((await mismatch.json()).error).toBe("affiliate_mismatch");
    });

    it("le bot du canal refuse : repli sur un autre de nos bots administrateurs", async () => {
      tg.refuse.add(831);
      const res = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "lea_zone",
            campaignName: "Léa",
            affiliateId: "aff-lea",
            affiliateName: "Léa",
            channelId: ids.zone,
          },
        }),
        routeCtx,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.url).toMatch(/^https:\/\/t\.me\/\+aff832x/);
      expect(
        (await prisma.inviteLink.findUniqueOrThrow({ where: { id: body.inviteLinkId } })).botId,
      ).toBe(ids.backup);
    });

    it("Telegram injoignable : 503 avec Retry-After, rien n'est créé", async () => {
      tg.down.add(833);
      const res = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "zoe_tir",
            campaignName: "Zoé",
            affiliateId: "aff-zoe",
            affiliateName: "Zoé",
            channelId: ids.tir,
          },
        }),
        routeCtx,
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(await res.json()).toEqual({
        error: "telegram_unavailable",
        message: expect.stringMatching(/Telegram ne répond pas/),
      });
      expect(await prisma.inviteLink.count({ where: { linkaffiCampaignKey: "zoe_tir" } })).toBe(0);
    });

    it("GET /members : membres de la campagne (statut, dates) et événements depuis `since`", async () => {
      const link = await prisma.inviteLink.findUniqueOrThrow({
        where: { id: zoneLink.inviteLinkId },
      });
      const t0 = new Date("2026-10-14T08:00:00.000Z");
      const attrib = (n: number, extra: Record<string, unknown> = {}) =>
        prisma.member.create({
          data: {
            telegramUserId: BigInt(830_000 + n),
            firstName: `Membre${n}`,
            lastName: "Secret",
            username: `membre${n}`,
            languageCode: "fr",
            linkaffiCampaignKey: "paul_zone1",
            linkaffiAffiliateId: "aff-paul",
            affiliateAttributedAt: new Date(t0.getTime() + n * 60_000),
            affiliateAttributionEndsAt: new Date(t0.getTime() + 30 * 86_400_000),
            affiliateInviteLinkId: link.id,
            ...extra,
          },
        });
      const joined = await attrib(1);
      const waiting = await attrib(2);
      const gone = await attrib(3, { anonymizedAt: new Date() });
      const other = await prisma.member.create({
        data: { telegramUserId: 830_099n, firstName: "Autre", linkaffiCampaignKey: "autre" },
      });
      await prisma.membership.create({
        data: {
          code: "lai-m1",
          memberId: joined.id,
          channelId: ids.zone,
          inviteLinkId: link.id,
          status: "APPROVED",
          requestedAt: new Date(t0.getTime() + 60_000),
          approvedAt: new Date(t0.getTime() + 120_000),
          joinedAt: new Date(t0.getTime() + 121_000),
        },
      });
      await prisma.membership.create({
        data: {
          code: "lai-m2",
          memberId: waiting.id,
          channelId: ids.zone,
          inviteLinkId: link.id,
          status: "REQUESTED",
          requestedAt: new Date(t0.getTime() + 180_000),
        },
      });
      const event = async (
        member: {
          id: string;
          telegramUserId: bigint;
          username: string | null;
          firstName: string | null;
        },
        type: "join_requested" | "join_approved" | "joined",
        minutes: number,
        campaignKey = "paul_zone1",
      ) => {
        const body = buildLinkaffiEvent({
          type,
          sourceId: `${member.id}-${type}`,
          occurredAt: new Date(t0.getTime() + minutes * 60_000),
          campaignKey,
          channel: { id: ids.zone, title: "Zone Interdite 🔞" },
          member: { ...member, languageCode: "fr" },
        });
        await prisma.linkaffiEvent.create({
          data: {
            eventId: body.eventId,
            type,
            occurredAt: new Date(body.occurredAt),
            campaignKey,
            memberId: member.id,
            channelId: ids.zone,
            body: toJsonValue(body),
            status: "SENT",
            sentAt: new Date(),
          },
        });
        return body;
      };
      await event(joined, "join_requested", 1);
      const approved = await event(joined, "join_approved", 2);
      const enteredZone = await event(joined, "joined", 2.5);
      const requested2 = await event(waiting, "join_requested", 3);
      await event(gone, "join_requested", 4);
      await event(other, "join_requested", 5, "autre");

      const res = await membersRoute.GET(
        api(
          `/members?campaignKey=paul_zone1&since=${encodeURIComponent(new Date(t0.getTime() + 90_000).toISOString())}`,
          {
            key,
          },
        ),
        routeCtx,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        campaignKey: "paul_zone1",
        since: new Date(t0.getTime() + 90_000).toISOString(),
        membersTruncated: false,
        hasMoreEvents: false,
        nextSince: null,
      });
      expect(body.members).toEqual([
        {
          telegramUserId: "830001",
          username: "membre1",
          firstName: "Membre1",
          languageCode: "fr",
          channel: { id: ids.zone, title: "Zone Interdite 🔞" },
          inviteLinkId: link.id,
          status: "joined",
          attributedAt: new Date(t0.getTime() + 60_000).toISOString(),
          attributionEndsAt: new Date(t0.getTime() + 30 * 86_400_000).toISOString(),
          requestedAt: new Date(t0.getTime() + 60_000).toISOString(),
          approvedAt: new Date(t0.getTime() + 120_000).toISOString(),
          joinedAt: new Date(t0.getTime() + 121_000).toISOString(),
          leftAt: null,
          declinedAt: null,
        },
        expect.objectContaining({
          telegramUserId: "830002",
          status: "requested",
          approvedAt: null,
        }),
      ]);
      // Jamais le nom de famille ; le membre anonymisé et l'autre campagne n'apparaissent pas.
      expect(JSON.stringify(body)).not.toContain("Secret");
      expect(JSON.stringify(body)).not.toContain("830003");
      expect(JSON.stringify(body)).not.toContain("830099");
      // Événements depuis `since` (inclus), corps exactement tels qu'enregistrés, du plus ancien au plus récent.
      expect(body.events).toEqual([approved, enteredZone, requested2]);

      const all = await membersRoute.GET(api("/members?campaignKey=paul_zone1", { key }), routeCtx);
      expect((await all.json()).events).toHaveLength(4);
    });

    it("GET /members : affilié changé ou retiré par un ADMIN → ses événements jamais envoyés ne sont plus rendus", async () => {
      const paulLink = await prisma.inviteLink.findUniqueOrThrow({
        where: { id: zoneLink.inviteLinkId },
      });
      const marcLink = await prisma.inviteLink.create({
        data: {
          channelId: ids.zone,
          botId: ids.main,
          telegramInviteLink: "https://t.me/+affmarczone",
          name: "Marc · zone",
          kind: "LINKAFFI",
          linkaffiCampaignKey: "marc_zone",
          linkaffiCampaignName: "Marc zone",
          linkaffiAffiliateId: "aff-marc",
          linkaffiAffiliateName: "Marc",
          attributionDays: 30,
        },
      });
      // Après les événements du test précédent : `since` isole ce scénario.
      const t1 = new Date("2026-10-15T08:00:00.000Z");
      const attrib = (n: number) =>
        prisma.member.create({
          data: {
            telegramUserId: BigInt(840_000 + n),
            firstName: `Suivi${n}`,
            username: `suivi${n}`,
            languageCode: "fr",
            linkaffiCampaignKey: "paul_zone1",
            linkaffiAffiliateId: "aff-paul",
            affiliateAttributedAt: t1,
            affiliateAttributionEndsAt: new Date(t1.getTime() + 30 * 86_400_000),
            affiliateInviteLinkId: paulLink.id,
          },
        });
      const moved = await attrib(1);
      const stays = await attrib(2);
      const removed = await attrib(3);
      // Scénario isolé : les tests suivants comptent les membres du lien de Paul et les événements de la file.
      onTestFinished(async () => {
        const memberIds = [moved.id, stays.id, removed.id];
        await prisma.linkaffiEvent.deleteMany({ where: { memberId: { in: memberIds } } });
        await prisma.event.deleteMany({ where: { memberId: { in: memberIds } } });
        await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
        await prisma.inviteLink.delete({ where: { id: marcLink.id } });
      });
      const event = async (
        member: {
          id: string;
          telegramUserId: bigint;
          username: string | null;
          firstName: string | null;
        },
        type: "join_requested" | "join_approved" | "offer_clicked",
        minutes: number,
        row: { status: "PENDING" | "SENT" | "FAILED"; lastError?: string },
      ) => {
        const body = buildLinkaffiEvent({
          type,
          sourceId: `${member.id}-${type}`,
          occurredAt: new Date(t1.getTime() + minutes * 60_000),
          campaignKey: "paul_zone1",
          channel: { id: ids.zone, title: "Zone Interdite 🔞" },
          member: { ...member, languageCode: "fr" },
          data:
            type === "offer_clicked"
              ? { subId: `sub-${member.id}`, offerCampaignKey: "offre" }
              : {},
        });
        await prisma.linkaffiEvent.create({
          data: {
            eventId: body.eventId,
            type,
            occurredAt: new Date(body.occurredAt),
            campaignKey: "paul_zone1",
            memberId: member.id,
            channelId: ids.zone,
            body: toJsonValue(body),
            status: row.status,
            lastError: row.lastError ?? null,
            sentAt: row.status === "SENT" ? new Date() : null,
          },
        });
        return body;
      };
      // Déjà reçu par Link Affi avant la correction : le renvoyer ne lui apprend rien.
      const movedRequested = await event(moved, "join_requested", 1, { status: "SENT" });
      // En attente au moment de la correction (le worker n'est pas encore passé) : jamais envoyé.
      const movedOffer = await event(moved, "offer_clicked", 2, { status: "PENDING" });
      // Déjà annulé par le worker après la correction.
      const movedApproved = await event(moved, "join_approved", 3, {
        status: "FAILED",
        lastError:
          "Affilié retiré ou changé par un administrateur : événement plus envoyé à Link Affi.",
      });
      // Membre toujours rattaché : abandonné après 24 h (clés pas encore posées) → rattrapable par cette route.
      const staysRequested = await event(stays, "join_requested", 4, {
        status: "FAILED",
        lastError: "Clés de connexion pas encore configurées.",
      });
      const staysOffer = await event(stays, "offer_clicked", 5, { status: "PENDING" });
      const removedOffer = await event(removed, "offer_clicked", 6, { status: "PENDING" });

      const read = async (campaignKey: string) => {
        const res = await membersRoute.GET(
          api(`/members?campaignKey=${campaignKey}&since=${encodeURIComponent(t1.toISOString())}`, {
            key,
          }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        return res.json();
      };
      // Avant la correction : tout est rendu (les trois membres sont à Paul).
      expect((await read("paul_zone1")).events).toEqual([
        movedRequested,
        movedOffer,
        movedApproved,
        staysRequested,
        staysOffer,
        removedOffer,
      ]);

      const { changeMemberAffiliate, removeMemberAffiliate } =
        await import("@/lib/affiliates/attribution-server");
      expect(
        await changeMemberAffiliate({
          memberId: moved.id,
          inviteLinkId: marcLink.id,
          reason: "Venu en réalité par Marc",
          userId: ids.admin,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await removeMemberAffiliate({
          memberId: removed.id,
          reason: "Pas amené par un affilié",
          userId: ids.admin,
        }),
      ).toMatchObject({ ok: true });

      // Après : ni l'offre en attente (avec son identifiant de suivi) ni l'événement annulé ne partent chez Paul.
      const paul = await read("paul_zone1");
      expect(paul.events).toEqual([movedRequested, staysRequested, staysOffer]);
      expect(JSON.stringify(paul)).not.toContain(`sub-${moved.id}`);
      expect(JSON.stringify(paul)).not.toContain(`sub-${removed.id}`);
      expect(paul.members.map((m: { telegramUserId: string }) => m.telegramUserId)).not.toContain(
        String(moved.telegramUserId),
      );
      // Ni chez Marc : ces événements ont été émis pour la campagne de Paul.
      const marc = await read("marc_zone");
      expect(marc.events).toEqual([]);
      expect(marc.members.map((m: { telegramUserId: string }) => m.telegramUserId)).toEqual([
        String(moved.telegramUserId),
      ]);
    });

    it("GET /members : clé manquante ou date illisible → 400 ; campagne inconnue → 404", async () => {
      const missing = await membersRoute.GET(api("/members", { key }), routeCtx);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({
        error: "invalid_query",
        message: expect.stringMatching(/« campaignKey » est obligatoire/),
      });
      const badDate = await membersRoute.GET(
        api("/members?campaignKey=paul_zone1&since=hier", { key }),
        routeCtx,
      );
      expect((await badDate.json()).message).toMatch(/« since » doit être une date ISO 8601/);
      const unknown = await membersRoute.GET(
        api("/members?campaignKey=inconnue", { key }),
        routeCtx,
      );
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error).toBe("campaign_not_found");
    });

    it("PATCH /invite-links/{id} : désactivé et révoqué par le bot créateur ; réactivation refusée", async () => {
      const bad = await inviteLinkRoute.PATCH(
        api(`/invite-links/${zoneLink.inviteLinkId}`, {
          method: "PATCH",
          key,
          body: { isActive: "non" },
        }),
        ctx({ inviteLinkId: zoneLink.inviteLinkId }),
      );
      expect(bad.status).toBe(400);
      expect((await bad.json()).message).toMatch(/« isActive » doit être un booléen/);

      const res = await inviteLinkRoute.PATCH(
        api(`/invite-links/${zoneLink.inviteLinkId}`, {
          method: "PATCH",
          key,
          body: { isActive: false },
        }),
        ctx({ inviteLinkId: zoneLink.inviteLinkId }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        inviteLinkId: zoneLink.inviteLinkId,
        url: zoneLink.url,
        isActive: false,
        revokedOnTelegram: true,
        message: expect.stringMatching(/restent à l'affilié/),
      });
      const revoke = calls.main!.filter((c) => c.method === "revokeChatInviteLink");
      expect(revoke).toHaveLength(1);
      expect(revoke[0]!.payload).toMatchObject({
        chat_id: Number(ZONE),
        invite_link: zoneLink.url,
      });
      expect(
        (await prisma.inviteLink.findUniqueOrThrow({ where: { id: zoneLink.inviteLinkId } }))
          .isActive,
      ).toBe(false);
      // Relance de la désactivation : rien de nouveau chez Telegram, et le résultat de la révocation est redit
      // d'après le journal (jamais inventé).
      const relaunch = await inviteLinkRoute.PATCH(
        api(`/invite-links/${zoneLink.inviteLinkId}`, {
          method: "PATCH",
          key,
          body: { isActive: false },
        }),
        ctx({ inviteLinkId: zoneLink.inviteLinkId }),
      );
      expect(relaunch.status).toBe(200);
      expect(await relaunch.json()).toMatchObject({
        isActive: false,
        revokedOnTelegram: true,
        message: "Le lien était déjà désactivé et retiré de Telegram.",
      });
      expect(calls.main!.filter((c) => c.method === "revokeChatInviteLink")).toHaveLength(1);
      // Les attributions passées restent.
      expect(
        await prisma.member.count({ where: { affiliateInviteLinkId: zoneLink.inviteLinkId } }),
      ).toBe(3);

      const reactivate = await inviteLinkRoute.PATCH(
        api(`/invite-links/${zoneLink.inviteLinkId}`, {
          method: "PATCH",
          key,
          body: { isActive: true },
        }),
        ctx({ inviteLinkId: zoneLink.inviteLinkId }),
      );
      expect(reactivate.status).toBe(409);
      expect(await reactivate.json()).toMatchObject({
        error: "reactivation_refused",
        message: expect.stringMatching(/ne peut pas être réactivé/),
      });
      // Redemander le lien de cette clé sur ce canal : refusé clairement (nouvelle campagne = nouvelle clé).
      const again = await inviteLinksRoute.POST(
        api("/invite-links", {
          method: "POST",
          key,
          body: {
            campaignKey: "paul_zone1",
            campaignName: "Paul · Zone Interdite",
            affiliateId: "aff-paul",
            affiliateName: "Paul",
            channelId: ids.zone,
          },
        }),
        routeCtx,
      );
      expect(again.status).toBe(409);
      expect((await again.json()).error).toBe("invite_link_disabled");

      const unknown = await inviteLinkRoute.PATCH(
        api("/invite-links/inconnu", { method: "PATCH", key, body: { isActive: false } }),
        ctx({ inviteLinkId: "inconnu" }),
      );
      expect(unknown.status).toBe(404);
    });

    it("adresse inconnue : 404 en JSON ; méthode non prévue : 405 en JSON avec Allow (jamais une réponse vide)", async () => {
      for (const [route, path] of [
        [unknownRoute, "/inconnue/x"],
        [rootRoute, ""],
      ] as const) {
        const res = await route.GET(api(path, { key }), routeCtx as never);
        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toMatch(/^application\/json/);
        expect(await res.json()).toMatchObject({
          error: "not_found",
          message: expect.stringMatching(/^Adresse inconnue/),
        });
      }
      const routes = [
        [channelsRoute, "/channels", "GET"],
        [membersRoute, "/members", "GET"],
        [inviteLinksRoute, "/invite-links", "POST"],
        [inviteLinkRoute, `/invite-links/${zoneLink.inviteLinkId}`, "PATCH"],
      ] as const;
      for (const [mod, path, allowed] of routes)
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
          if (method === allowed) continue;
          const handler = (mod as unknown as Record<string, unknown>)[method] as
            ((req: Request, c: unknown) => Promise<Response>) | undefined;
          expect(handler, `${method} ${path}`).toBeTypeOf("function");
          const res = await handler!(api(path, { method, key }), routeCtx);
          expect(res.status, `${method} ${path}`).toBe(405);
          expect(res.headers.get("allow")).toBe(allowed);
          expect(await res.json()).toEqual({
            error: "method_not_allowed",
            message: `Méthode ${method} non prévue sur cette adresse : utilisez ${allowed}.`,
          });
        }
    });

    it("chaque appel est au journal (sans la clé, ni son empreinte)", async () => {
      const logs = await prisma.auditLog.findMany({
        where: { action: { startsWith: "integration.linkaffi." } },
      });
      expect(new Set(logs.map((l) => l.action))).toEqual(
        new Set([
          "integration.linkaffi.get_channels",
          "integration.linkaffi.post_invite_links",
          "integration.linkaffi.patch_invite_link",
          "integration.linkaffi.get_members",
          "integration.linkaffi.unknown_route",
        ]),
      );
      expect(logs.every((l) => l.userId === null)).toBe(true);
      const text = JSON.stringify(logs);
      expect(text).not.toContain(key);
      expect(text).not.toContain(hashIntegrationApiKey(key));
      expect(logs.filter((l) => (l.metadata as { status?: number }).status === 401)).toHaveLength(
        2,
      );
    });

    it("régénérer la clé : l'ancienne est refusée aussitôt ; 61e appel de la minute → 429", async () => {
      const old = key;
      const r = await actions.generateLinkaffiKeyAction(null, fd());
      expect(r?.regenerated).toBe(true);
      key = r!.value!;
      expect((await channelsRoute.GET(api("/channels", { key: old }), routeCtx)).status).toBe(401);
      for (let i = 0; i < 60; i++)
        expect((await channelsRoute.GET(api("/channels", { key }), routeCtx)).status).toBe(200);
      const refused = await channelsRoute.GET(api("/channels", { key }), routeCtx);
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(await refused.json()).toEqual({
        error: "rate_limited",
        message: expect.stringMatching(/^Trop de requêtes : 60 par minute au plus/),
      });
      expect(
        await prisma.auditLog.count({
          where: {
            action: "integration.linkaffi.get_channels",
            metadata: { path: ["status"], equals: 429 },
          },
        }),
      ).toBe(1);
    });
  });

  describe("réglages : adresse de Link Affi et événement de test", () => {
    let server: Server;
    let port = 0;
    const received: Array<{ headers: IncomingMessage["headers"]; raw: string }> = [];
    let receiverSecret = "";

    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = "";
        req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
        req.on("end", () => {
          received.push({ headers: req.headers, raw });
          const sig = req.headers["x-signature"];
          const ok =
            req.headers.apikey === "anon-test" &&
            req.headers.authorization === "Bearer anon-test" &&
            verifyLinkaffiSignature(raw, receiverSecret, Array.isArray(sig) ? sig[0] : sig);
          res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
          res.end(ok ? '{"ok":true}' : '{"error":"invalid signature"}');
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      delete process.env.LINKAFFI_ANON_KEY;
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("adresse : refusée si elle n'est pas en https, enregistrée sinon (journal)", async () => {
      expect(
        await actions.saveLinkaffiEventsUrlAction(
          null,
          fd({ eventsUrl: "http://linkaffi.example/x" }),
        ),
      ).toEqual({
        error: "L'adresse doit commencer par https:// (connexion chiffrée).",
        // La saisie refusée revient pour rester dans le champ.
        value: "http://linkaffi.example/x",
        attempt: 1,
      });
      // Adresse avec identifiants : refusée, et rien n'est enregistré (l'adresse d'origine reste).
      expect(
        await actions.saveLinkaffiEventsUrlAction(
          null,
          fd({ eventsUrl: "https://user:pw@x.example.com/" }),
        ),
      ).toMatchObject({
        error: expect.stringMatching(/identifiant/),
        value: "https://user:pw@x.example.com/",
      });
      expect((await loadLinkaffiIntegrationState()).eventsUrlIsDefault).toBe(true);
      const r = await actions.saveLinkaffiEventsUrlAction(
        null,
        fd({ eventsUrl: `http://127.0.0.1:${port}/functions/v1/telegram-events` }),
      );
      expect(r).toEqual({
        ok: "Adresse enregistrée : les prochains événements partiront vers elle.",
      });
      const state = await loadLinkaffiIntegrationState();
      expect(state.eventsUrl).toBe(`http://127.0.0.1:${port}/functions/v1/telegram-events`);
      expect(state.eventsUrlIsDefault).toBe(false);
      expect(
        await prisma.auditLog.findFirst({
          where: { action: "integration.linkaffi_events_url_changed" },
        }),
      ).toMatchObject({ userId: ids.admin });
    });

    it("sans la clé anon de Link Affi sur le site : test impossible, message clair", async () => {
      delete process.env.LINKAFFI_ANON_KEY;
      const r = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(r?.error).toMatch(/clé d'accès publique de Link Affi/);
      expect(received).toHaveLength(0);
    });

    it("test signé reçu par Link Affi (simulé) : « Reçu », même en-têtes que les vrais événements", async () => {
      process.env.LINKAFFI_ANON_KEY = "anon-test";
      receiverSecret = secret;
      const r = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(r).toMatchObject({
        outcome: "received",
        message: expect.stringMatching(/^Link Affi a accepté l'événement de test/),
      });
      expect(received).toHaveLength(1);
      const got = received[0]!;
      const body = JSON.parse(got.raw);
      expect(body).toMatchObject({
        type: "test",
        campaignKey: "test",
        eventId: expect.stringMatching(/^lap_test_/),
        member: { telegramUserId: "0" },
      });
      expect(got.headers["x-event-id"]).toBe(body.eventId);
      expect(got.headers["content-type"]).toBe("application/json");
      expect(verifyLinkaffiSignature(got.raw, secret, got.headers["x-signature"] as string)).toBe(
        true,
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "integration.linkaffi_test_sent" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit.metadata).toMatchObject({ outcome: "received", status: 200 });
      expect(JSON.stringify(audit)).not.toContain(secret);
    });

    it("secret régénéré mais pas recollé dans Link Affi : « Signature refusée »", async () => {
      await actions.generateLinkaffiSecretAction(null, fd());
      const r = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(r).toMatchObject({
        outcome: "signature_refused",
        message: expect.stringMatching(/^Link Affi refuse la signature \(réponse 401\)/),
      });
    });

    it("Link Affi injoignable : « Injoignable »", async () => {
      await actions.saveLinkaffiEventsUrlAction(
        null,
        fd({ eventsUrl: "http://127.0.0.1:1/telegram-events" }),
      );
      const r = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(r).toMatchObject({
        outcome: "unreachable",
        message: expect.stringMatching(/^Link Affi est injoignable/),
      });
      // Vide = retour à l'adresse d'origine.
      expect(await actions.saveLinkaffiEventsUrlAction(null, fd({ eventsUrl: "" }))).toEqual({
        ok: "Adresse d'origine de Link Affi enregistrée.",
      });
      expect((await loadLinkaffiIntegrationState()).eventsUrlIsDefault).toBe(true);
    });

    it("état de la file : en attente, envoyés 24 h, abandonnés, plus ancien en attente", async () => {
      const now = new Date();
      const pending = buildLinkaffiEvent({
        type: "left",
        sourceId: "file-1",
        occurredAt: now,
        campaignKey: "paul_zone1",
        channel: { id: ids.zone, title: "Zone" },
        member: { telegramUserId: 1n },
      });
      await prisma.linkaffiEvent.create({
        data: {
          eventId: pending.eventId,
          type: "left",
          occurredAt: now,
          campaignKey: "paul_zone1",
          body: toJsonValue(pending),
          createdAt: new Date(now.getTime() - 2 * 3_600_000),
        },
      });
      await prisma.linkaffiEvent.create({
        data: {
          eventId: "lap_left_file-2",
          type: "left",
          occurredAt: now,
          campaignKey: "paul_zone1",
          body: toJsonValue({ ...pending, eventId: "lap_left_file-2" }),
          status: "FAILED",
        },
      });
      const state = await loadLinkaffiIntegrationState(now);
      expect(state.queue).toMatchObject({
        pending: 1,
        sent24h: 6,
        failed7d: 1,
        oldestPendingAt: new Date(now.getTime() - 2 * 3_600_000),
        stuck: true,
      });
    });

    it("réglage corrigé (adresse, nouveau secret, test reçu) : les événements en attente repartent aussitôt", async () => {
      await prisma.linkaffiEvent.deleteMany();
      const now = Date.now();
      const make = async (eventId: string, nextAttemptAt: Date, attempts: number) => {
        const body = buildLinkaffiEvent({
          type: "left",
          sourceId: eventId,
          occurredAt: new Date(now),
          campaignKey: "paul_zone1",
          channel: { id: ids.zone, title: "Zone" },
          member: { telegramUserId: 1n },
        });
        await prisma.linkaffiEvent.create({
          data: {
            eventId: body.eventId,
            type: "left",
            occurredAt: new Date(now),
            campaignKey: "paul_zone1",
            body: toJsonValue(body),
            attempts,
            nextAttemptAt,
            lastStatus: 401,
            createdAt: new Date(now - 3 * 3_600_000),
          },
        });
        return body.eventId;
      };
      // En attente de son prochain essai dans 2 h (Link Affi refusait la signature) ; un autre en cours d'envoi
      // (réservé par le service d'arrière-plan pour 2 minutes) : celui-là n'est jamais touché (aucun doublon).
      const waiting = await make("reprise-1", new Date(now + 2 * 3_600_000), 6);
      const inFlight = await make("reprise-2", new Date(now + 60_000), 6);
      const next = async (eventId: string) =>
        (await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } })).nextAttemptAt;
      const ticks = () => capturedJobs("linkaffi-events").filter((j) => j.data.type === "tick");
      const backoff = () =>
        prisma.linkaffiEvent.update({
          where: { eventId: waiting },
          data: { nextAttemptAt: new Date(Date.now() + 2 * 3_600_000) },
        });

      // 1. Adresse corrigée.
      let before = ticks().length;
      await actions.saveLinkaffiEventsUrlAction(
        null,
        fd({ eventsUrl: `http://127.0.0.1:${port}/functions/v1/telegram-events` }),
      );
      expect((await next(waiting)).getTime()).toBeLessThanOrEqual(Date.now());
      expect((await next(inFlight)).getTime()).toBe(now + 60_000);
      expect(ticks().length).toBe(before + 1);

      // 2. Nouveau secret (collé ensuite dans Link Affi).
      await backoff();
      before = ticks().length;
      const generated = await actions.generateLinkaffiSecretAction(null, fd());
      secret = generated!.value!;
      expect((await next(waiting)).getTime()).toBeLessThanOrEqual(Date.now());
      expect(ticks().length).toBe(before + 1);

      // 3. Test refusé (secret pas encore collé) : rien ne repart ; test reçu : tout repart, et l'écran le dit.
      await backoff();
      receiverSecret = "ancien-secret";
      before = ticks().length;
      const refused = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(refused?.outcome).toBe("signature_refused");
      expect((await next(waiting)).getTime()).toBeGreaterThan(Date.now() + 3_600_000);
      expect(ticks().length).toBe(before);
      receiverSecret = secret;
      const ok = await actions.sendLinkaffiTestEventAction(null, fd());
      expect(ok).toMatchObject({
        outcome: "received",
        message: expect.stringMatching(/1 événement en attente repart maintenant/),
      });
      expect((await next(waiting)).getTime()).toBeLessThanOrEqual(Date.now());
      expect((await next(inFlight)).getTime()).toBe(now + 60_000);
      expect(ticks().length).toBe(before + 1);
      await prisma.linkaffiEvent.deleteMany();
    });
  });
});
