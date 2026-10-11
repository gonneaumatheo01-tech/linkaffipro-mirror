/**
 * Accueil (phase 9) sur base réelle : chiffres du jour en heure de Paris (aujourd'hui jusqu'à maintenant, hier à la même
 * heure), nos joueurs seulement (un autre affilié n'entre jamais dans les chiffres), gains = commissions (CPA de nos
 * joueurs + part de revshare de nos offres) − dépense pub, jamais les dépôts ni le revenu net ; état, « À faire »,
 * prochains messages, campagnes actives, liste « À faire pour démarrer » et état de la visite guidée
 * (`onboarding.<userId>`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { listCampaignsUncached } from "@/lib/campaigns/queries";
import { dayGains, homeFigures } from "@/lib/home/figures";
import {
  loadActiveCampaigns,
  loadChecklistInput,
  loadHomeFigures,
  loadStatusInput,
  loadTodoInput,
  loadUpcomingPosts,
} from "@/lib/home/queries";
import { buildStatusBar } from "@/lib/home/status";
import { buildTodo } from "@/lib/home/todo";
import { onboardingKey } from "@/lib/onboarding/state";
import { loadOnboarding } from "@/lib/onboarding/store";
import { createBotAndChannel, resetDb } from "./helpers";

// Session simulée pour les actions de la visite guidée.
const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "accueil@test.local",
    name: "Accueil Test",
    role: "ADMIN" as "ADMIN" | "MANAGER",
    telegramUserId: null as bigint | null,
  },
}));
const nav = vi.hoisted(() => ({ redirects: [] as string[], revalidated: [] as string[] }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
  requireAdminPage: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: (p: string) => {
    nav.revalidated.push(p);
  },
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (to: string) => {
    nav.redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { completeTourAction, dismissChecklistAction, restartTourAction } =
  await import("@/lib/onboarding/actions");

/** Lundi 15 juin 2026, 16:00 à Paris (UTC+2) : aujourd'hui = le 15, hier = le 14. */
const NOW = new Date("2026-06-15T14:00:00.000Z");
/** Heure de Paris du 15 (ou du 14 avec `day = 14`) en UTC. */
const paris = (day: 13 | 14 | 15, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 5, day, h! - 2, m!));
};

let seq = 0;
const nextId = () => ++seq;

async function member() {
  const n = nextId();
  return prisma.member.create({
    data: { telegramUserId: BigInt(900_000 + n), firstName: `M${n}` },
  });
}

async function membership(channelId: string, data: Record<string, unknown>) {
  const m = await member();
  const n = nextId();
  return prisma.membership.create({
    data: { code: `HOME${n}`, memberId: m.id, channelId, ...data },
  });
}

async function cleanup() {
  await prisma.affiliateDailyStat.deleteMany();
  await resetDb();
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.adAccountConnection.deleteMany();
  await prisma.telegramUserSession.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { in: ["ai.config"] } } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "onboarding." } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "settings.onboarding" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@home.test.local" } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
}

describe("accueil sur base réelle", () => {
  let channelId = "";
  let otherChannelId = "";
  let botId = "";
  let ourCampaignId = "";

  beforeAll(async () => {
    await cleanup();
    const { bot, channel } = await createBotAndChannel({
      chatId: BigInt(-1001234508888),
      title: "Casino du soir",
    });
    botId = bot.id;
    channelId = channel.id;
    await prisma.channel.update({ where: { id: channel.id }, data: { vertical: "CASINO" } });
    // Second canal, avec une règle d'adhésion : jamais dans « canaux sans règle ».
    const other = await prisma.channel.create({
      data: {
        telegramChatId: BigInt(-1001234508889),
        title: "Foot VIP",
        vertical: "SPORTS",
        primaryBotId: bot.id,
      },
    });
    otherChannelId = other.id;
    await prisma.approvalRule.create({
      data: { channelId: other.id, name: "Par défaut", isDefault: true, mode: "IMMEDIATE" },
    });

    // ---------- Entrées dans un canal ----------
    // Aujourd'hui (le 15, avant 16:00 Paris) : 00:30 (encore le 14 en UTC), 10:00 → 2.
    await membership(channelId, { status: "APPROVED", joinedAt: paris(15, "00:30") });
    await membership(channelId, { status: "APPROVED", joinedAt: paris(15, "10:00") });
    // Aujourd'hui après « maintenant » : hors fenêtre.
    await membership(channelId, { status: "APPROVED", joinedAt: paris(15, "17:00") });
    // Hier avant 16:00 Paris (23:30 le 13 n'en est pas : c'est l'avant-veille) → 1 ; hier 18:00 : après la même heure.
    await membership(channelId, { status: "APPROVED", joinedAt: paris(14, "09:00") });
    await membership(channelId, { status: "APPROVED", joinedAt: paris(14, "18:00") });
    await membership(channelId, { status: "APPROVED", joinedAt: paris(13, "23:30") });

    // ---------- Joueurs ----------
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino Test", externalId: "prog-home" },
    });
    const ours = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "KEY-HOME-OURS",
        name: "Notre offre",
        trackingUrlTemplate: "https://linkaffi.me/go/KEY-HOME-OURS?sub_id={subid}",
      },
    });
    const foreign = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "KEY-HOME-OTHER",
        name: "Offre d'un autre affilié",
        trackingUrlTemplate: "https://linkaffi.me/go/KEY-HOME-OTHER?sub_id={subid}",
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Casino été",
        vertical: "CASINO",
        status: "ACTIVE",
        affiliateCampaignIds: [ours.id],
        channelIds: [channelId],
      },
    });
    ourCampaignId = campaign.id;
    await prisma.campaign.create({
      data: { name: "Campagne en pause", status: "PAUSED", affiliateCampaignIds: [ours.id] },
    });

    // p1 : premier dépôt aujourd'hui 11:00 ; dépôts aujourd'hui 100 + 20 ; revenu net aujourd'hui +30 et −5 ;
    // hier 10:00 : dépôt 50 et revenu net +7 ; revenu net aujourd'hui 17:00 (après maintenant) : ignoré.
    const p1 = await prisma.player.create({
      data: {
        affiliateCampaignId: ours.id,
        externalPlayerId: "h1",
        ftdAt: paris(15, "11:00"),
        ngr: 999,
      },
    });
    // p2 : premier dépôt hier 09:00 (40) ; p3 : premier dépôt aujourd'hui 00:30 Paris (veille en UTC), 10.
    const p2 = await prisma.player.create({
      data: { affiliateCampaignId: ours.id, externalPlayerId: "h2", ftdAt: paris(14, "09:00") },
    });
    const p3 = await prisma.player.create({
      data: { affiliateCampaignId: ours.id, externalPlayerId: "h3", ftdAt: paris(15, "00:30") },
    });
    // Autre affilié : ne doit jamais compter.
    const p9 = await prisma.player.create({
      data: {
        affiliateCampaignId: foreign.id,
        externalPlayerId: "h9",
        ftdAt: paris(15, "10:00"),
        ngr: 5000,
      },
    });
    const ev = (
      playerId: string,
      type: "FTD" | "DEPOSIT" | "REDEPOSIT" | "NGR" | "CPA" | "CPA_REVERSAL",
      amount: number,
      at: Date,
    ) => ({
      playerId,
      type,
      amount,
      currency: "EUR",
      occurredAt: at,
    });
    await prisma.playerEvent.createMany({
      data: [
        ev(p1.id, "FTD", 100, paris(15, "11:00")),
        ev(p1.id, "REDEPOSIT", 20, paris(15, "12:00")),
        ev(p1.id, "NGR", 30, paris(15, "13:00")),
        ev(p1.id, "NGR", -5, paris(15, "15:00")),
        ev(p1.id, "NGR", 400, paris(15, "17:00")),
        ev(p1.id, "DEPOSIT", 50, paris(14, "10:00")),
        ev(p1.id, "NGR", 7, paris(14, "10:00")),
        ev(p2.id, "FTD", 40, paris(14, "09:00")),
        ev(p3.id, "FTD", 10, paris(15, "00:30")),
        ev(p9.id, "FTD", 999, paris(15, "10:00")),
        ev(p9.id, "NGR", 999, paris(15, "10:00")),
        // Commissions CPA (phase 10) : p1 créditée aujourd'hui ; p3 aujourd'hui 01:00 Paris (encore le 14 en UTC) ;
        // p2 créditée hier 09:30 puis annulée aujourd'hui 12:00 (retranchée aujourd'hui) ; p1 encore une annulation
        // après « maintenant » (ignorée) ; l'autre affilié ne compte jamais.
        ev(p1.id, "CPA", 70, paris(15, "11:30")),
        ev(p3.id, "CPA", 50, paris(15, "01:00")),
        ev(p2.id, "CPA", 70, paris(14, "09:30")),
        ev(p2.id, "CPA_REVERSAL", -70, paris(15, "12:00")),
        ev(p1.id, "CPA_REVERSAL", -70, paris(15, "18:00")),
        ev(p9.id, "CPA", 500, paris(15, "10:00")),
      ],
    });
    // Part de revshare (agrégat Link Affi, sans heure) : aujourd'hui 6,50 ; hier 12 (ramenée à la même heure) ;
    // correction créée aujourd'hui pour le 10 juin (comptée aujourd'hui) ; l'offre d'un autre affilié ne compte pas.
    await prisma.affiliateDailyStat.createMany({
      data: [
        {
          externalId: "home-st-15",
          affiliateCampaignId: ours.id,
          date: new Date("2026-06-15T00:00:00Z"),
          sourceCreatedAt: new Date("2026-06-14T22:02:00Z"),
          revshareRevenue: 6.5,
        },
        {
          externalId: "home-st-14",
          affiliateCampaignId: ours.id,
          date: new Date("2026-06-14T00:00:00Z"),
          sourceCreatedAt: new Date("2026-06-13T22:02:00Z"),
          revshareRevenue: 12,
        },
        {
          externalId: "home-st-fix",
          affiliateCampaignId: ours.id,
          date: new Date("2026-06-10T00:00:00Z"),
          sourceCreatedAt: paris(15, "08:00"),
          revshareRevenue: -1.5,
        },
        {
          externalId: "home-st-other",
          affiliateCampaignId: foreign.id,
          date: new Date("2026-06-15T00:00:00Z"),
          sourceCreatedAt: new Date("2026-06-14T22:02:00Z"),
          revshareRevenue: 300,
        },
      ],
    });

    // ---------- Dépense pub (jour entier, sans heure ; celle d'hier est ramenée à la même heure) ----------
    await prisma.adCost.createMany({
      data: [
        {
          campaignId: campaign.id,
          levelKey: `campaign:${campaign.id}`,
          date: new Date("2026-06-15T00:00:00Z"),
          spend: 50,
          source: "MANUAL",
        },
        {
          campaignId: campaign.id,
          levelKey: `campaign:${campaign.id}`,
          date: new Date("2026-06-15T00:00:00Z"),
          spend: 25,
          source: "CSV",
        },
        {
          campaignId: campaign.id,
          levelKey: `campaign:${campaign.id}`,
          date: new Date("2026-06-14T00:00:00Z"),
          spend: 10,
          source: "MANUAL",
        },
        {
          campaignId: campaign.id,
          levelKey: `campaign:${campaign.id}`,
          date: new Date("2026-06-13T00:00:00Z"),
          spend: 1000,
          source: "MANUAL",
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it("chiffres du jour : aujourd'hui jusqu'à maintenant, hier à la même heure, nos joueurs seulement", async () => {
    const { windows, today, yesterday } = await loadHomeFigures(NOW);
    expect(windows.todayKey).toBe("2026-06-15");
    expect(windows.today.start.toISOString()).toBe("2026-06-14T22:00:00.000Z");
    // CPA : 70 + 50 − 70 (annulation d'aujourd'hui) = 50 ; revshare : 6,50 − 1,50 = 5.
    expect(today).toEqual({
      members: 2,
      ftds: 2,
      cpaCommissions: 50,
      revshareCommissions: 5,
      spend: 75,
    });
    // Dépense (10 €) et part de revshare (12 €) d'hier, journée entière sans heure, ramenées à 16 h sur 24.
    expect(windows.yesterdayShare).toBeCloseTo(16 / 24, 10);
    expect(yesterday).toEqual({
      members: 1,
      ftds: 1,
      cpaCommissions: 70,
      revshareCommissions: 8,
      spend: 6.67,
    });
    // Gains du jour = 55 − 75 = −20 ; hier à la même heure = 78 − 6,67 = 71,33. Les dépôts (130 €) et le revenu net
    // (25 €) d'aujourd'hui n'y entrent pas.
    expect(dayGains(today)).toBe(-20);
    const f = homeFigures(today, yesterday);
    expect(f.members.delta).toBe(100);
    expect(f.ftds.delta).toBe(100);
    expect(f.gains).toMatchObject({ value: -20, previous: 71.33, delta: -128 });
    expect(f.breakdown).toEqual({ commissions: 55, spend: 75 });
  });

  it("barre d'état : bots, synchro Link Affi, alertes ouvertes", async () => {
    await prisma.syncState.create({
      data: { source: "players", lastSuccessAt: new Date(NOW.getTime() - 3 * 60_000) },
    });
    const ok = buildStatusBar(await loadStatusInput(NOW, async () => false));
    expect(ok).toMatchObject({ ok: true, points: 0, botsOnline: 1 });

    await prisma.alert.createMany({
      data: [
        { kind: "channel_leak", message: "Fuite" },
        { kind: "post_failed", message: "Résolue", resolvedAt: NOW },
      ],
    });
    await prisma.bot.update({ where: { id: botId }, data: { lastError: "Unauthorized" } });
    const bar = buildStatusBar(await loadStatusInput(NOW, async () => true));
    expect(bar.ok).toBe(false);
    expect(bar.issues.map((i) => i.key)).toEqual(["worker", "bot:bot_test", "alerts"]);
    expect(bar.points).toBe(3);
    await prisma.bot.update({ where: { id: botId }, data: { lastError: null } });
    await prisma.alert.deleteMany();
  });

  it("« À faire » : demandes à valider, messages en échec, connexions, canaux sans règle, test A/B, clé IA", async () => {
    // Demandes : 2 à la main (plus de 2 min), 1 trop récente (encore en traitement), 1 en échec cette semaine.
    await membership(channelId, {
      status: "REQUESTED",
      requestedAt: new Date(NOW.getTime() - 3_600_000),
    });
    await membership(channelId, {
      status: "REQUESTED",
      requestedAt: new Date(NOW.getTime() - 600_000),
    });
    await membership(channelId, {
      status: "REQUESTED",
      requestedAt: new Date(NOW.getTime() - 30_000),
    });
    await membership(channelId, {
      status: "FAILED",
      requestedAt: new Date(NOW.getTime() - 86_400_000),
    });
    await membership(otherChannelId, {
      status: "SCHEDULED",
      requestedAt: new Date(NOW.getTime() - 3_600_000),
    });
    // Messages en échec : un message de canal (compte), un conteneur d'envoi groupé et un modèle (ne comptent pas).
    const post = (data: Record<string, unknown>) =>
      prisma.post.create({ data: { code: `HOMEP${nextId()}`, channelId, botId, ...data } });
    await post({ status: "FAILED", text: "Raté" });
    await post({ status: "FAILED", text: "Envoi groupé", templateName: "broadcast:x" });
    await post({ status: "FAILED", text: "Modèle", isTemplate: true });
    // Connexions à refaire.
    await prisma.adAccountConnection.create({
      data: {
        platform: "META",
        externalId: "act_1",
        name: "Compte FR",
        status: "NEEDS_RECONNECT",
        tokenEncrypted: "x",
      },
    });
    await prisma.adAccountConnection.create({
      data: {
        platform: "TIKTOK",
        externalId: "tt_1",
        name: "TikTok OK",
        status: "ACTIVE",
        tokenEncrypted: "x",
      },
    });
    await prisma.telegramUserSession.create({
      data: { id: "main", phone: "+33600000000", sessionEncrypted: "x", status: "ERROR" },
    });
    // Test A/B : B parti il y a 2 jours, B a plus de cliqueurs uniques.
    const sent = new Date(NOW.getTime() - 2 * 86_400_000);
    await post({
      status: "SENT",
      sentAt: sent,
      abGroupId: "ab-home",
      abVariant: "A",
      text: "A",
      stats: { create: { clicks: 2, uniqueClickers: 2 } },
    });
    await post({
      status: "SENT",
      sentAt: sent,
      abGroupId: "ab-home",
      abVariant: "B",
      text: "B",
      stats: { create: { clicks: 9, uniqueClickers: 8 } },
    });

    const input = await loadTodoInput({ role: "ADMIN", telegramUserId: null }, NOW);
    expect(input.pendingRequests).toEqual([
      { channelId, channelTitle: "Casino du soir", count: 3 },
    ]);
    expect(input.failedPosts).toBe(1);
    expect(input.adReconnect).toEqual([{ platform: "META", name: "Compte FR" }]);
    expect(input.telegramSessionError).toBe(true);
    expect(input.channelsWithoutRule).toEqual([{ id: channelId, title: "Casino du soir" }]);
    expect(input.abTests).toEqual([
      { groupId: "ab-home", channelTitle: "Casino du soir", winner: "B" },
    ]);
    expect(input.aiKeyMissing).toBe(true);
    expect(input.telegramLinked).toBe(false);

    const lines = buildTodo({ ...input, telegramInChecklist: true });
    expect(lines.map((l) => l.key)).toEqual([
      `requests:${channelId}`,
      "failed-posts",
      "reconnect:META:Compte FR",
      "reconnect:telegram",
      "rules",
      "ab:ab-home",
      "ai",
    ]);
    expect(lines[0]!.href).toBe(`/channels/${channelId}?tab=requests`);

    // Clé IA posée : plus de ligne ; un manager ne la voit jamais.
    await prisma.setting.create({
      data: { key: "ai.config", value: { apiKeyEncrypted: "chiffré" } },
    });
    expect((await loadTodoInput({ role: "ADMIN", telegramUserId: 1n }, NOW)).aiKeyMissing).toBe(
      false,
    );
    await prisma.setting.deleteMany({ where: { key: "ai.config" } });
    expect((await loadTodoInput({ role: "MANAGER", telegramUserId: 1n }, NOW)).aiKeyMissing).toBe(
      false,
    );
  });

  it("prochains messages : les 3 prochains messages de canal programmés, avec l'univers", async () => {
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    const post = (data: { channelId: string } & Record<string, unknown>) =>
      prisma.post.create({
        data: { code: `HOMEU${nextId()}`, botId, status: "SCHEDULED", ...data },
      });
    await post({ channelId, scheduledAt: at(90), text: "<b>Troisième</b>" });
    await post({ channelId, scheduledAt: at(30), text: "Premier" });
    await post({ channelId: otherChannelId, scheduledAt: at(60), text: "Deuxième" });
    await post({ channelId, scheduledAt: at(120), text: "Quatrième" });
    await post({
      channelId,
      scheduledAt: at(10),
      text: "Envoi groupé",
      templateName: "broadcast:y",
    });
    await post({ channelId, scheduledAt: at(5), text: "Modèle", isTemplate: true });
    await post({ channelId, scheduledAt: at(-5), text: "Passé" });
    const upcoming = await loadUpcomingPosts(NOW);
    expect(upcoming.map((p) => [p.text, p.channelTitle, p.vertical])).toEqual([
      ["Premier", "Casino du soir", "CASINO"],
      ["Deuxième", "Foot VIP", "SPORTS"],
      ["<b>Troisième</b>", "Casino du soir", "CASINO"],
    ]);
  });

  it("campagnes actives : 7 derniers jours, gains = commissions − dépense (même définition que l'accueil)", async () => {
    const { rows, total } = await loadActiveCampaigns(NOW, listCampaignsUncached);
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    // Commissions sur 7 jours (9 au 15 juin, jusqu'à la fin du 15) : CPA 70 + 50 + 70 − 70 − 70 = 50, revshare
    // 6,50 + 12 − 1,50 = 17 → 67 ; dépense : 50 + 25 + 10 + 1000 = 1085. Le revenu net (432 €) n'y entre pas.
    expect(rows[0]).toMatchObject({
      id: ourCampaignId,
      name: "Casino été",
      vertical: "CASINO",
      spend: 1085,
    });
    expect(rows[0]!.gains).toBeCloseTo(67 - 1085, 2);
  });

  it("« À faire pour démarrer » : campagne, message programmé, équipe", async () => {
    const admin = { role: "ADMIN" as const, telegramUserId: null };
    const before = await loadChecklistInput(admin);
    expect(before).toMatchObject({
      isAdmin: true,
      telegramLinked: false,
      hasCampaign: true,
      hasScheduledPost: true,
    });
    await prisma.invitation.deleteMany();
    const inviter = await prisma.user.create({
      data: {
        email: "inviteur@home.test.local",
        passwordHash: "x",
        name: "Inviteur",
        role: "ADMIN",
      },
    });
    await prisma.invitation.create({
      data: {
        email: "nouveau@home.test.local",
        token: "tok-home",
        expiresAt: NOW,
        invitedById: inviter.id,
      },
    });
    expect((await loadChecklistInput(admin)).teamInvited).toBe(true);
    const manager = await loadChecklistInput({ role: "MANAGER", telegramUserId: 42n });
    expect(manager).toMatchObject({ isAdmin: false, telegramLinked: true, teamInvited: false });

    // Seules des campagnes pub importées (pas encore rattachées) : pas encore de campagne créée par l'équipe.
    await prisma.adCost.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.campaign.create({
      data: { name: "Importée", externalCampaignId: "ext-1", adPlatform: "META" },
    });
    expect((await loadChecklistInput(admin)).hasCampaign).toBe(false);
  });
});

describe("visite guidée : état par utilisateur (Setting onboarding.<userId>)", () => {
  beforeEach(async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: "onboarding." } } });
    await prisma.user.deleteMany({ where: { email: session.user.email } });
    const u = await prisma.user.create({
      data: {
        email: session.user.email,
        passwordHash: "x",
        name: session.user.name,
        role: "ADMIN",
      },
    });
    session.user.id = u.id;
    nav.redirects.length = 0;
    nav.revalidated.length = 0;
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: "onboarding." } } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "settings.onboarding" } } });
    await prisma.user.deleteMany({ where: { email: session.user.email } });
  });

  it("première connexion : rien en base, la visite est à montrer", async () => {
    expect(await loadOnboarding(session.user.id)).toEqual({
      tourDoneAt: null,
      checklistDismissedAt: null,
    });
  });

  it("terminer, masquer la liste, puis « Revoir la visite » remet tout à zéro et renvoie à l'accueil", async () => {
    await completeTourAction("skipped");
    const afterTour = await loadOnboarding(session.user.id);
    expect(afterTour.tourDoneAt).not.toBeNull();
    expect(afterTour.checklistDismissedAt).toBeNull();

    await dismissChecklistAction();
    expect((await loadOnboarding(session.user.id)).checklistDismissedAt).not.toBeNull();
    expect(nav.revalidated).toContain("/");

    await expect(restartTourAction()).rejects.toThrow("NEXT_REDIRECT /");
    expect(nav.redirects).toEqual(["/"]);
    expect(await loadOnboarding(session.user.id)).toEqual({
      tourDoneAt: null,
      checklistDismissedAt: null,
    });

    const row = await prisma.setting.findUnique({ where: { key: onboardingKey(session.user.id) } });
    expect(row?.value).toEqual({ tourDoneAt: null, checklistDismissedAt: null });
    const actions = await prisma.auditLog.findMany({
      where: { userId: session.user.id },
      select: { action: true, metadata: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      "settings.onboarding_checklist_hidden",
      "settings.onboarding_reset",
      "settings.onboarding_tour_done",
    ]);
    expect(actions.find((a) => a.action === "settings.onboarding_tour_done")!.metadata).toEqual({
      how: "skipped",
    });
  });

  it("l'état d'un utilisateur ne touche pas celui d'un autre", async () => {
    await completeTourAction();
    expect(await loadOnboarding("autre-utilisateur")).toEqual({
      tourDoneAt: null,
      checklistDismissedAt: null,
    });
  });
});
