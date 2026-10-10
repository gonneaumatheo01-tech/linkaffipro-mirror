/**
 * Reprise de la phase 8 (packages/db/prisma/phase8-data.ts) sur base réelle : NGR réconcilié et daté (jamais à la date
 * d'import), idempotent même si la synchro tourne en même temps ; catégories créées d'office retirées sans élargir une
 * automatisation ou un envoi programmé.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@linkaffipro/db";
import {
  BACKFILL_PREFIX,
  CATEGORIES_DONE_KEY,
  cleanOfficeCategories,
  reconcileNgr,
} from "../../../../packages/db/prisma/phase8-data";
import { createBotAndChannel, resetDb } from "./helpers";

const db = prisma as unknown as PrismaClient;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function cleanExtra() {
  await prisma.broadcast.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.post.updateMany({ data: { categoryId: null } });
  await prisma.messageCategory.deleteMany();
  await prisma.auditLog.deleteMany({ where: { entityType: "MessageCategory" } });
  await prisma.setting.deleteMany({ where: { key: CATEGORIES_DONE_KEY } });
}

describe("reprise phase 8 : NGR réconcilié et daté", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await resetDb();
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino P8", externalId: "prog-p8" },
    });
    const off = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "OFF-P8",
        name: "Offre",
        trackingUrlTemplate: "https://linkaffi.me/go/OFF-P8?sub_id={subid}",
      },
    });
    const mk = async (
      key: string,
      data: { ngr: number; lastEventAt?: Date | null; registeredAt?: Date | null },
    ) => {
      const p = await prisma.player.create({
        data: {
          affiliateCampaignId: off.id,
          externalPlayerId: key,
          ngr: data.ngr,
          lastEventAt: data.lastEventAt ?? null,
          registeredAt: data.registeredAt ?? null,
        },
      });
      ids[key] = p.id;
      return p;
    };
    // A : cumul 100, aucun événement → +100 daté de la dernière activité.
    await mk("A", { ngr: 100, lastEventAt: daysAgo(30), registeredAt: daysAgo(90) });
    // B : cumul 120, la synchro a déjà daté +20 → l'écart de 100 est daté de l'inscription (pas d'activité connue).
    const b = await mk("B", { ngr: 120, registeredAt: daysAgo(60) });
    await prisma.playerEvent.create({
      data: {
        playerId: b.id,
        type: "NGR",
        amount: 20,
        currency: "EUR",
        occurredAt: daysAgo(2),
        raw: { source: "revshare_snapshots" },
      },
    });
    // C : ancienne reprise (cumul complet sans identifiant, daté à l'import) → remplacée par un écart daté.
    const c = await mk("C", { ngr: 50, lastEventAt: daysAgo(10) });
    await prisma.playerEvent.create({
      data: {
        playerId: c.id,
        type: "NGR",
        amount: 50,
        currency: "EUR",
        occurredAt: new Date(),
        raw: { source: "phase8-backfill" },
      },
    });
    // D : un « revenue » importé de player_events (ligne brute, sans source) ne compte plus comme NGR.
    const d = await mk("D", { ngr: 0, lastEventAt: daysAgo(5) });
    await prisma.playerEvent.create({
      data: {
        playerId: d.id,
        type: "NGR",
        amount: 12,
        occurredAt: daysAgo(5),
        externalId: "rev:1",
        raw: { id: "rev1", player_id: "la-d", event: "revenue" },
      },
    });
    // E : cumul sans aucune date connue → laissé de côté (jamais daté à l'import).
    await mk("E", { ngr: 30 });
  });
  afterAll(resetDb);

  const ngrOf = async (key: string) =>
    prisma.playerEvent.findMany({
      where: { playerId: ids[key]!, type: "NGR" },
      orderBy: { occurredAt: "asc" },
      select: { amount: true, occurredAt: true, externalId: true },
    });
  const sum = (rows: Array<{ amount: unknown }>) => rows.reduce((a, r) => a + Number(r.amount), 0);

  it("crée un événement de l'écart, daté de la dernière activité ou de l'inscription, et convertit les « revenue » bruts", async () => {
    const r = await reconcileNgr(db);
    expect(r).toMatchObject({ converted: 1, removedOld: 1, created: 3, adjusted: 0, undatable: 1 });
    const a = await ngrOf("A");
    expect(a).toHaveLength(1);
    expect(Number(a[0]!.amount)).toBe(100);
    expect(a[0]!.externalId).toBe(`${BACKFILL_PREFIX}${ids.A}`);
    expect(Math.abs(a[0]!.occurredAt.getTime() - daysAgo(30).getTime())).toBeLessThan(60_000);
    const b = await ngrOf("B");
    expect(sum(b)).toBe(120);
    expect(Math.abs(b[0]!.occurredAt.getTime() - daysAgo(60).getTime())).toBeLessThan(60_000);
    const c = await ngrOf("C");
    expect(c).toHaveLength(1);
    expect(Math.abs(c[0]!.occurredAt.getTime() - daysAgo(10).getTime())).toBeLessThan(60_000);
    expect(await ngrOf("D")).toHaveLength(0);
    expect(await prisma.playerEvent.count({ where: { playerId: ids.D!, type: "OTHER" } })).toBe(1);
    expect(await ngrOf("E")).toHaveLength(0);
  });

  it("une variation enregistrée par la synchro pendant la reprise n'est pas comptée deux fois", async () => {
    const f = await prisma.player.create({
      data: {
        affiliateCampaignId: (await prisma.player.findUniqueOrThrow({ where: { id: ids.A! } }))
          .affiliateCampaignId,
        externalPlayerId: "F",
        ngr: 40,
        lastEventAt: daysAgo(8),
      },
    });
    ids.F = f.id;
    // La synchro (événement +6 et cumul 46 dans une même transaction) passe juste après la lecture des sommes.
    let synced = false;
    const simulateSync = async () => {
      if (synced) return;
      synced = true;
      await prisma.$transaction([
        prisma.playerEvent.create({
          data: {
            playerId: f.id,
            type: "NGR",
            amount: 6,
            currency: "EUR",
            occurredAt: new Date(),
            raw: { source: "revshare_snapshots" },
          },
        }),
        prisma.player.update({ where: { id: f.id }, data: { ngr: 46 } }),
      ]);
    };
    const racing = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "playerEvent") {
          const delegate = target.playerEvent;
          return new Proxy(delegate, {
            get(d, k) {
              if (k === "groupBy")
                return async (...args: unknown[]) => {
                  const r = await (d.groupBy as (...a: unknown[]) => Promise<unknown>)(...args);
                  await simulateSync();
                  return r;
                };
              const v = Reflect.get(d, k) as unknown;
              return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(d) : v;
            },
          });
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as PrismaClient;
    await reconcileNgr(racing);
    expect(synced).toBe(true);
    // Somme des événements = cumul (46) : l'écart repris vaut 40, pas 46.
    expect(sum(await ngrOf("F"))).toBe(46);
    expect(await reconcileNgr(db)).toMatchObject({ created: 0, adjusted: 0 });
  });

  it("idempotent, et rattrape une variation non datée par l'ancien worker en ajustant le même événement", async () => {
    expect(await reconcileNgr(db)).toMatchObject({
      converted: 0,
      removedOld: 0,
      created: 0,
      adjusted: 0,
    });
    await prisma.player.update({ where: { id: ids.B! }, data: { ngr: 130 } });
    expect(await reconcileNgr(db)).toMatchObject({ created: 0, adjusted: 1 });
    expect(sum(await ngrOf("B"))).toBe(130);
    expect(
      await prisma.playerEvent.count({
        where: { playerId: ids.B!, externalId: { startsWith: BACKFILL_PREFIX } },
      }),
    ).toBe(1);
  });
});

describe("reprise phase 8 : catégories créées d'office", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await cleanExtra();
    await resetDb();
    const { bot, channel: testChannel } = await createBotAndChannel({
      chatId: -1009998887771n,
      title: "Canal de test",
    });
    const real = await prisma.channel.create({
      data: { telegramChatId: -1009998887772n, title: "Vrai canal", primaryBotId: bot.id },
    });
    const cat = async (slug: string, name: string) =>
      (ids[slug] = (await prisma.messageCategory.create({ data: { slug, name } })).id);
    await cat("bonus", "Bonus");
    await cat("rappel", "Rappel");
    await cat("mes-gains", "Mes gains");
    const post = (
      code: string,
      data: {
        channelId: string;
        categoryId: string;
        status?: "DRAFT" | "SENT" | "SCHEDULED" | "FAILED";
        isTemplate?: boolean;
      },
    ) =>
      prisma.post.create({
        data: {
          code,
          botId: bot.id,
          channelId: data.channelId,
          categoryId: data.categoryId,
          status: data.status ?? "DRAFT",
          isTemplate: data.isTemplate ?? false,
        },
      });
    ids.template = (
      await post("p8t1", { channelId: testChannel.id, categoryId: ids.bonus!, isTemplate: true })
    ).id;
    ids.draft = (
      await post("p8d1", { channelId: real.id, categoryId: ids.bonus!, status: "DRAFT" })
    ).id;
    ids.testSent = (
      await post("p8s0", { channelId: testChannel.id, categoryId: ids.bonus!, status: "SENT" })
    ).id;
    ids.realSent = (
      await post("p8s1", { channelId: real.id, categoryId: ids.rappel!, status: "SENT" })
    ).id;
    ids.rappelTemplate = (
      await post("p8t2", { channelId: testChannel.id, categoryId: ids.rappel!, isTemplate: true })
    ).id;
    ids.clientPost = (
      await post("p8c1", { channelId: real.id, categoryId: ids["mes-gains"]!, status: "DRAFT" })
    ).id;
    ids.rule = (
      await prisma.automationRule.create({
        data: {
          name: "Relance bonus",
          trigger: "OFFER_CLICKED",
          conditions: { categoryIds: [ids.bonus!] },
          actions: [],
          isActive: true,
        },
      })
    ).id;
    ids.broadcast = (
      await prisma.broadcast.create({
        data: {
          name: "Envoi",
          botId: bot.id,
          text: "x",
          status: "SCHEDULED",
          segment: { clickedCategoryIds: [ids.bonus!, ids.rappel!] },
        },
      })
    ).id;
    ids.broadcastOnlyBonus = (
      await prisma.broadcast.create({
        data: {
          name: "Envoi bonus",
          botId: bot.id,
          text: "x",
          status: "SCHEDULED",
          segment: { clickedCategoryIds: [ids.bonus!] },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await cleanExtra();
    await resetDb();
  });

  it("supprime les catégories d'office non portées par un vrai message, garde les autres, sans élargir les ciblages", async () => {
    const r = await cleanOfficeCategories(db);
    expect(r.removed).toEqual(["Bonus"]);
    expect(r.kept).toHaveLength(1);
    expect(await prisma.messageCategory.findUnique({ where: { id: ids.bonus! } })).toBeNull();
    expect(await prisma.messageCategory.findUnique({ where: { id: ids.rappel! } })).not.toBeNull();
    expect(
      await prisma.messageCategory.findUnique({ where: { id: ids["mes-gains"]! } }),
    ).not.toBeNull();
    const cat = async (id: string) =>
      (await prisma.post.findUnique({ where: { id }, select: { categoryId: true } }))?.categoryId ??
      null;
    expect(await cat(ids.template!)).toBeNull();
    expect(await cat(ids.draft!)).toBeNull();
    expect(await cat(ids.testSent!)).toBeNull();
    expect(await cat(ids.rappelTemplate!)).toBeNull(); // modèle détaché même si la catégorie reste
    expect(await cat(ids.realSent!)).toBe(ids.rappel);
    expect(await cat(ids.clientPost!)).toBe(ids["mes-gains"]);
    const rule = await prisma.automationRule.findUnique({ where: { id: ids.rule! } });
    expect(rule?.isActive).toBe(false);
    expect((rule?.conditions as Record<string, unknown>).categoryIds).toBeUndefined();
    const b = await prisma.broadcast.findUnique({ where: { id: ids.broadcast! } });
    expect(b).toMatchObject({ status: "SCHEDULED", segment: { clickedCategoryIds: [ids.rappel] } });
    expect(
      (await prisma.broadcast.findUnique({ where: { id: ids.broadcastOnlyBonus! } }))?.status,
    ).toBe("DRAFT");
    // Deuxième passage : rien à faire.
    expect(await cleanOfficeCategories(db)).toMatchObject({
      removed: [],
      rulesUpdated: 0,
      broadcastsUpdated: 0,
    });
  });

  it("relancé après que le client a recréé « Bonus » : sa catégorie, ses messages, ses automatisations et ses envois restent intacts", async () => {
    const channel = await prisma.channel.findFirstOrThrow({ where: { isTest: false } });
    const bot = await prisma.bot.findFirstOrThrow();
    // Création comme dans le site (même identifiant court « bonus », action journalisée).
    const mine = await prisma.messageCategory.create({ data: { slug: "bonus", name: "Bonus" } });
    await prisma.auditLog.create({
      data: {
        action: "category.created",
        entityType: "MessageCategory",
        entityId: mine.id,
        metadata: { name: "Bonus", inline: true },
      },
    });
    const draft = await prisma.post.create({
      data: { code: "p8d9", botId: bot.id, channelId: channel.id, categoryId: mine.id },
    });
    const rule = await prisma.automationRule.create({
      data: {
        name: "Relance de mes bonus",
        trigger: "OFFER_CLICKED",
        conditions: { categoryIds: [mine.id] },
        actions: [],
        isActive: true,
      },
    });
    const broadcast = await prisma.broadcast.create({
      data: {
        name: "Mes bonus",
        botId: bot.id,
        text: "x",
        status: "SCHEDULED",
        segment: { clickedCategoryIds: [mine.id] },
      },
    });
    expect(await cleanOfficeCategories(db)).toMatchObject({ removed: [], detached: 0 });
    expect(await prisma.messageCategory.findUnique({ where: { id: mine.id } })).not.toBeNull();
    expect(
      (await prisma.post.findUnique({ where: { id: draft.id }, select: { categoryId: true } }))
        ?.categoryId,
    ).toBe(mine.id);
    expect(await prisma.automationRule.findUnique({ where: { id: rule.id } })).toMatchObject({
      isActive: true,
      conditions: { categoryIds: [mine.id] },
    });
    expect(await prisma.broadcast.findUnique({ where: { id: broadcast.id } })).toMatchObject({
      status: "SCHEDULED",
      segment: { clickedCategoryIds: [mine.id] },
    });
  });

  it("premier passage : une catégorie créée par le client avec un nom d'origine (« Rappel ») n'est pas visée", async () => {
    await cleanExtra();
    const created = await prisma.messageCategory.create({
      data: { slug: "rappel", name: "Rappel" },
    });
    await prisma.auditLog.create({
      data: {
        action: "category.created",
        entityType: "MessageCategory",
        entityId: created.id,
        metadata: { name: "Rappel" },
      },
    });
    const office = await prisma.messageCategory.create({
      data: { slug: "sondage", name: "Sondage" },
    });
    const r = await cleanOfficeCategories(db);
    expect(r.removed).toEqual(["Sondage"]);
    expect(await prisma.messageCategory.findUnique({ where: { id: created.id } })).not.toBeNull();
    expect(await prisma.messageCategory.findUnique({ where: { id: office.id } })).toBeNull();
  });
});
