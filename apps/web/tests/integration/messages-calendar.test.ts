/**
 * Messages (phase 9, calendrier) sur base réelle : messages de la semaine avec les filtres canal / univers /
 * catégorie, meilleurs horaires lus dans `Setting` `besthours.<canal>`, revenu net d'un message (événements NGR datés
 * des joueurs venus de ses clics), catégories de la galerie de modèles, et déplacement d'un message (action
 * serveur : refus d'un message parti ou d'une date passée, test A/B déplacé d'un bloc, journal).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { calendarBestSlots } from "@/lib/posts/best-slots";
import { loadChannelsBestHours, postNetRevenue } from "@/lib/posts/calendar-queries";
import { listCalendarPosts, listTemplateCategories } from "@/lib/posts/queries";
import { fromParisLocal } from "@/lib/posts/time";
import { createBotAndChannel, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: { id: "", email: "calendrier@messages.test.local", name: "Calendrier", role: "MANAGER" },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const { movePostAction } = await import("@/app/(admin)/messages/move-action");

const CAT_SLUGS = ["integ-cal-bonus", "integ-cal-rappel"];

async function cleanExtras(channelIds: string[] = []) {
  await prisma.setting.deleteMany({
    where: { key: { in: channelIds.map((id) => `besthours.${id}`) } },
  });
  await prisma.auditLog.deleteMany({ where: { user: { email: session.user.email } } });
}

let ctx: {
  botId: string;
  casino: string;
  sports: string;
  bonus: string;
  rappel: string;
};

/** Message dans un canal, à une heure de Paris. */
async function post(
  channelId: string,
  local: string | null,
  extra: Partial<{
    status: "DRAFT" | "SCHEDULED" | "SENT" | "SENDING";
    categoryId: string | null;
    isTemplate: boolean;
    abGroupId: string;
    abVariant: string;
  }> = {},
) {
  return prisma.post.create({
    data: {
      code: `C${Math.random().toString(36).slice(2, 10)}`,
      channelId,
      botId: ctx.botId,
      status: extra.status ?? "SCHEDULED",
      scheduledAt: local ? fromParisLocal(local) : null,
      text: "Bonjour",
      categoryId: extra.categoryId ?? null,
      isTemplate: extra.isTemplate ?? false,
      abGroupId: extra.abGroupId ?? null,
      abVariant: extra.abVariant ?? null,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await prisma.messageCategory.deleteMany({ where: { slug: { in: CAT_SLUGS } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
  const u = await prisma.user.create({
    data: { email: session.user.email, name: "Calendrier", passwordHash: "x", role: "MANAGER" },
  });
  session.user.id = u.id;
  const { bot, channel } = await createBotAndChannel({ title: "Casino test" });
  await prisma.channel.update({ where: { id: channel.id }, data: { vertical: "CASINO" } });
  const sports = await prisma.channel.create({
    data: {
      telegramChatId: -1009876543210n,
      title: "Paris test",
      vertical: "SPORTS",
      primaryBotId: bot.id,
    },
  });
  const [bonus, rappel] = await Promise.all(
    CAT_SLUGS.map((slug, i) =>
      prisma.messageCategory.create({
        data: { slug, name: i === 0 ? "Bonus" : "Rappel", color: "#16a34a" },
      }),
    ),
  );
  ctx = {
    botId: bot.id,
    casino: channel.id,
    sports: sports.id,
    bonus: bonus!.id,
    rappel: rappel!.id,
  };
});

afterAll(async () => {
  if (ctx) await cleanExtras([ctx.casino, ctx.sports]);
  await resetDb();
  await prisma.messageCategory.deleteMany({ where: { slug: { in: CAT_SLUGS } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
});

// Semaine du lundi 5 octobre 2026 (heure de Paris).
const weekStart = fromParisLocal("2026-10-05T00:00")!;
const weekEnd = fromParisLocal("2026-10-12T00:00")!;

describe("calendrier : messages de la semaine et filtres", () => {
  it("semaine, canal, univers et catégorie ; jamais les modèles", async () => {
    const a = await post(ctx.casino, "2026-10-06T19:00", { categoryId: ctx.bonus });
    const b = await post(ctx.sports, "2026-10-07T09:30", {
      status: "SENT",
      categoryId: ctx.rappel,
    });
    await post(ctx.casino, "2026-10-12T00:30"); // semaine suivante (lundi 00:30 à Paris)
    await post(ctx.casino, "2026-10-04T23:30"); // dimanche d'avant
    await post(ctx.casino, "2026-10-08T10:00", { isTemplate: true, status: "DRAFT" });

    const all = await listCalendarPosts({ weekStart, weekEnd });
    expect(all.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.find((p) => p.id === b.id)?.channel).toMatchObject({
      title: "Paris test",
      vertical: "SPORTS",
    });

    expect(
      (await listCalendarPosts({ weekStart, weekEnd, channelId: ctx.sports })).map((p) => p.id),
    ).toEqual([b.id]);
    expect(
      (await listCalendarPosts({ weekStart, weekEnd, vertical: "CASINO" })).map((p) => p.id),
    ).toEqual([a.id]);
    expect(
      (await listCalendarPosts({ weekStart, weekEnd, categoryId: ctx.rappel })).map((p) => p.id),
    ).toEqual([b.id]);
    // Univers inconnu : ignoré.
    expect(await listCalendarPosts({ weekStart, weekEnd, vertical: "POKER" })).toHaveLength(2);
  });
});

describe("calendrier : meilleurs horaires calculés par le worker", () => {
  it("lit Setting besthours.<canal> (forme du worker) et ignore une entrée illisible", async () => {
    const cell = (day: number, hour: number, clicks: number) => ({
      day,
      hour,
      posts: 3,
      views: 0,
      clicks,
      uniqueClickers: 0,
      reactions: 0,
      ctr: null,
      clicksPerPost: clicks / 3,
      reactionsPerPost: 0,
    });
    await prisma.setting.create({
      data: {
        key: `besthours.${ctx.casino}`,
        value: {
          channelId: ctx.casino,
          weeks: 8,
          minPosts: 3,
          posts: 6,
          computedAt: new Date().toISOString(),
          categories: {
            all: { posts: 6, cells: [cell(2, 19, 12), cell(5, 12, 3)], recommendation: null },
          },
        },
      },
    });
    await prisma.setting.create({ data: { key: `besthours.${ctx.sports}`, value: { foo: 1 } } });
    const data = await loadChannelsBestHours([ctx.casino, ctx.sports]);
    expect(data.map((d) => d.channelId)).toEqual([ctx.casino]);
    const best = calendarBestSlots(data, { channelId: ctx.casino });
    expect(best.slots.map((s) => s.label)).toEqual(["mardi 19 h", "vendredi 12 h"]);
    expect(await loadChannelsBestHours([])).toEqual([]);
    await cleanExtras([ctx.casino, ctx.sports]);
  });
});

describe("fiche d'un message : revenu net", () => {
  it("somme des événements NGR des joueurs venus d'un clic sur ce message, rien d'autre", async () => {
    const p = await post(ctx.casino, "2026-10-06T19:00", { status: "SENT" });
    const other = await post(ctx.casino, "2026-10-06T20:00", { status: "SENT" });
    const program = await prisma.affiliateProgram.create({
      data: { name: "Programme cal", source: "API", externalId: "integ-cal" },
    });
    const campaign = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "camp-cal",
        name: "Campagne cal",
        trackingUrlTemplate: "https://example.org/go?sub_id={subid}",
      },
    });
    const link = await prisma.trackingLink.create({
      data: {
        slug: "CALOFFER1",
        kind: "OFFER",
        destinationTemplate: "https://example.org",
        label: "Offre",
      },
    });
    const click = await prisma.click.create({ data: { trackingLinkId: link.id, postId: p.id } });
    const clickOther = await prisma.click.create({
      data: { trackingLinkId: link.id, postId: other.id },
    });
    const mine = await prisma.player.create({
      data: { affiliateCampaignId: campaign.id, externalPlayerId: "P1", clickId: click.id },
    });
    const theirs = await prisma.player.create({
      data: { affiliateCampaignId: campaign.id, externalPlayerId: "P2", clickId: clickOther.id },
    });
    const at = new Date("2026-10-07T10:00:00Z");
    await prisma.playerEvent.createMany({
      data: [
        { playerId: mine.id, type: "NGR", amount: 40, occurredAt: at },
        { playerId: mine.id, type: "NGR", amount: -5.5, occurredAt: at },
        { playerId: mine.id, type: "DEPOSIT", amount: 100, occurredAt: at },
        { playerId: theirs.id, type: "NGR", amount: 999, occurredAt: at },
      ],
    });
    expect(await postNetRevenue(p.id)).toBe(34.5);
    expect(await postNetRevenue("inconnu")).toBe(0);
  });
});

describe("galerie de modèles : catégories", () => {
  it("seulement les catégories portées par un modèle", async () => {
    await post(ctx.casino, null, { isTemplate: true, status: "DRAFT", categoryId: ctx.bonus });
    await post(ctx.casino, "2026-10-06T19:00", { categoryId: ctx.rappel });
    const cats = await listTemplateCategories();
    expect(cats.map((c) => c.id)).toContain(ctx.bonus);
    expect(cats.map((c) => c.id)).not.toContain(ctx.rappel);
  });
});

describe("déplacer un message (action serveur, base réelle)", () => {
  /** Dans 3 jours, à l'heure de Paris donnée. */
  function inDays(days: number, hhmm: string): string {
    const d = new Date(Date.now() + days * 86_400_000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
    return `${day}T${hhmm}`;
  }

  it("déplace un message programmé (MANAGER), écrit le journal ; « Annuler » le remet en place", async () => {
    const p = await post(ctx.casino, inDays(2, "19:00"));
    const to = inDays(3, "08:30");
    const r = await movePostAction({ postId: p.id, scheduledAt: to });
    expect(r).toMatchObject({ ok: true, to, moved: 1 });
    const after = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.scheduledAt?.toISOString()).toBe(fromParisLocal(to)!.toISOString());
    expect(after.status).toBe("SCHEDULED");
    expect(after.updatedById).toBe(session.user.id);
    const log = await prisma.auditLog.findFirst({
      where: { action: "post.moved", entityId: p.id },
    });
    expect(log?.userId).toBe(session.user.id);
    // Annuler : retour à l'ancienne date.
    const back = await movePostAction({ postId: p.id, scheduledAt: r.ok ? r.from! : "" });
    expect(back.ok).toBe(true);
    const restored = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(restored.scheduledAt?.toISOString()).toBe(
      fromParisLocal(inDays(2, "19:00"))!.toISOString(),
    );
  });

  it("refuse un message parti ou en cours d'envoi, et une date passée", async () => {
    const sent = await post(ctx.casino, "2026-10-06T19:00", { status: "SENT" });
    const sending = await post(ctx.casino, inDays(1, "10:00"), { status: "SENDING" });
    const scheduled = await post(ctx.casino, inDays(1, "11:00"));
    expect((await movePostAction({ postId: sent.id, scheduledAt: inDays(2, "10:00") })).ok).toBe(
      false,
    );
    expect((await movePostAction({ postId: sending.id, scheduledAt: inDays(2, "10:00") })).ok).toBe(
      false,
    );
    const past = await movePostAction({ postId: scheduled.id, scheduledAt: "2026-01-01T10:00" });
    expect(past.ok).toBe(false);
    const unchanged = await prisma.post.findMany({
      where: { id: { in: [sent.id, sending.id, scheduled.id] } },
      select: { id: true, status: true, scheduledAt: true },
    });
    expect(unchanged.find((p) => p.id === sending.id)?.status).toBe("SENDING");
    expect(unchanged.find((p) => p.id === scheduled.id)?.scheduledAt?.toISOString()).toBe(
      fromParisLocal(inDays(1, "11:00"))!.toISOString(),
    );
  });

  it("test A/B : la version B suit la version A du même écart", async () => {
    const a = await post(ctx.casino, inDays(2, "19:00"), { abGroupId: "integ-ab", abVariant: "A" });
    const b = await post(ctx.casino, inDays(2, "19:30"), { abGroupId: "integ-ab", abVariant: "B" });
    const r = await movePostAction({ postId: a.id, scheduledAt: inDays(2, "21:00") });
    expect(r).toMatchObject({ ok: true, moved: 2 });
    const [na, nb] = await Promise.all(
      [a.id, b.id].map((id) => prisma.post.findUniqueOrThrow({ where: { id } })),
    );
    expect(nb!.scheduledAt!.getTime() - na!.scheduledAt!.getTime()).toBe(30 * 60_000);
    expect(na!.scheduledAt?.toISOString()).toBe(fromParisLocal(inDays(2, "21:00"))!.toISOString());
  });
});
