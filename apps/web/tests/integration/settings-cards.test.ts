/**
 * Réglages (phase 9) sur base réelle : pastilles d'état des cartes (`loadSettingsStateInput` + `settingsStates`).
 * Seuls les blocs demandés sont lus ; Link Affi, comptes pub, compte Telegram, bots, équipe, alertes, IA, catégories,
 * étiquettes, état du système (tuiles de la page État du système) et retours du casino donnent la pastille attendue.
 * Les bots sont lus par `botStatuses` (lecture réelle ; jeton factice : Telegram injoignable, sans appel réseau).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { NO_STATE_INPUT, plural, settingsStates } from "@/lib/status/settings-cards";
import { botStatuses } from "@/lib/status/queries";
import { loadSettingsStateInput } from "@/lib/status/settings-cards-queries";
import { resetDb } from "./helpers";

const NOW = new Date("2026-06-15T14:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const EMAIL = "@settings-cards.test.local";
const SETTING_KEYS = ["ai.config", "members.tags"];
const CATEGORY_SLUG = "settings-cards-test";

let savedSettings: Array<{ key: string; value: unknown }> = [];

async function cleanUp() {
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.adAccountConnection.deleteMany();
  await prisma.telegramUserSession.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.messageCategory.deleteMany({ where: { slug: { startsWith: CATEGORY_SLUG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL } } });
}

beforeEach(async () => {
  await resetDb();
  await cleanUp();
  savedSettings = (await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS } } })).map(
    (s) => ({ key: s.key, value: s.value }),
  );
  await prisma.setting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
});

afterAll(async () => {
  await cleanUp();
  await prisma.setting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
  for (const s of savedSettings)
    await prisma.setting.create({ data: { key: s.key, value: toJsonValue(s.value) } });
});

describe("pastilles des cartes de Réglages", () => {
  it("ne lit que les blocs demandés", async () => {
    const input = await loadSettingsStateInput(new Set(["bots"]), NOW, {
      health: async () => {
        throw new Error("l'état du système ne doit pas être lu");
      },
    });
    expect(input).toEqual({ ...NO_STATE_INPUT, bots: [] });
    expect(settingsStates(input, NOW)).toEqual({ bots: { tone: "warning", label: "Aucun bot" } });
  });

  it("donne l'état de chaque connexion, des bots, de l'équipe, des alertes, de l'IA et du contenu", async () => {
    const admin = await prisma.user.create({
      data: { email: `admin${EMAIL}`, passwordHash: "x", name: "Admin", role: "ADMIN" },
    });
    await prisma.user.create({
      data: { email: `ancien${EMAIL}`, passwordHash: "x", name: "Ancien", isActive: false },
    });
    const usersBefore = await prisma.user.count({ where: { isActive: true } });
    await prisma.invitation.createMany({
      data: [
        { email: `a${EMAIL}`, token: "tok-a", expiresAt: minutesAgo(-60), invitedById: admin.id },
        // Expirée, puis acceptée : ni l'une ni l'autre n'est « en attente ».
        { email: `b${EMAIL}`, token: "tok-b", expiresAt: minutesAgo(60), invitedById: admin.id },
        {
          email: `c${EMAIL}`,
          token: "tok-c",
          expiresAt: minutesAgo(-60),
          acceptedAt: minutesAgo(5),
          invitedById: admin.id,
        },
      ],
    });
    await prisma.syncState.createMany({
      data: [
        { source: "players", lastSuccessAt: minutesAgo(2) },
        { source: "clicks", lastSuccessAt: minutesAgo(4) },
      ],
    });
    await prisma.adAccountConnection.createMany({
      data: [
        { platform: "META", externalId: "act_1", name: "Meta 1", tokenEncrypted: "x" },
        { platform: "META", externalId: "act_2", name: "Meta 2", tokenEncrypted: "x" },
        {
          platform: "TIKTOK",
          externalId: "tt_1",
          name: "TikTok 1",
          tokenEncrypted: "x",
          status: "NEEDS_RECONNECT",
        },
      ],
    });
    await prisma.telegramUserSession.create({
      data: { phone: "+33600000000", sessionEncrypted: "x", status: "ACTIVE" },
    });
    await prisma.bot.createMany({
      data: [
        {
          name: "A",
          username: "a_bot",
          telegramBotId: 1n,
          tokenEncrypted: "x",
          vertical: "CASINO",
          webhookSecret: "s1",
        },
        {
          name: "B",
          username: "b_bot",
          telegramBotId: 2n,
          tokenEncrypted: "x",
          vertical: "SPORTS",
          webhookSecret: "s2",
          isActive: false,
          lastError: "ancien",
        },
      ],
    });
    await prisma.alert.createMany({
      data: [
        { kind: "registrations_drop", message: "x" },
        { kind: "channel_leak", message: "y", resolvedAt: minutesAgo(1) },
      ],
    });
    await prisma.setting.create({
      data: { key: "ai.config", value: { apiKeyEncrypted: "chiffrée", lastError: null } },
    });
    await prisma.setting.create({
      data: {
        key: "members.tags",
        value: [
          { name: "vip", color: "orange" },
          { name: "test", color: "gray" },
        ],
      },
    });
    const categoriesBefore = await prisma.messageCategory.count({ where: { isActive: true } });
    await prisma.messageCategory.createMany({
      data: [
        { name: "Test A", slug: `${CATEGORY_SLUG}-a` },
        { name: "Test B", slug: `${CATEGORY_SLUG}-b`, isActive: false },
      ],
    });
    const program = await prisma.affiliateProgram.create({ data: { name: "Casino test" } });
    await prisma.postbackEndpoint.createMany({
      data: [
        { programId: program.id, name: "P1", token: "pb-1" },
        { programId: program.id, name: "P2", token: "pb-2", isActive: false },
      ],
    });

    const all = new Set([
      "linkaffi",
      "meta",
      "tiktok",
      "telegram",
      "bots",
      "team",
      "alerts",
      "ai",
      "categories",
      "tags",
      "status",
      "postbacks",
    ] as const);
    const input = await loadSettingsStateInput(all, NOW, {
      // Site, service d'arrière-plan et sauvegarde en bonne santé (Redis n'est pas lu ici) ; bots, synchro et
      // alertes lus en base comme sur la page État du système.
      health: async () => ({
        web: { db: "ok", dbLatencyMs: 2, redis: "ok" },
        worker: {
          heartbeat: { at: NOW.toISOString(), startedAt: NOW.toISOString(), version: "t", pid: 1 },
          ageSec: 0,
          down: false,
        },
        backup: { at: minutesAgo(60), file: "db.sql.gz", bytes: 1, ok: true },
        bots: await botStatuses(),
        syncStates: await prisma.syncState.findMany(),
        openAlerts: await prisma.alert.findMany({ where: { resolvedAt: null } }),
      }),
    });
    const s = settingsStates(input, NOW);
    expect(s.linkaffi).toEqual({ tone: "success", label: "Synchronisé il y a 2 min" });
    expect(s.meta).toEqual({ tone: "success", label: "2 comptes connectés" });
    expect(s.tiktok).toEqual({ tone: "danger", label: "1 compte à reconnecter" });
    expect(s.telegram).toEqual({ tone: "success", label: "Connecté" });
    // Le bot actif a un jeton factice (Telegram injoignable) : à vérifier ; le bot inactif en erreur ne compte pas.
    expect(
      input.bots?.filter((b) => b.isActive).map((b) => Boolean(b.webhook?.fetchError)),
    ).toEqual([true]);
    expect(s.bots).toEqual({ tone: "danger", label: "1 à vérifier" });
    // Même mise en forme que l'écran (séparateur des milliers) : la base de test garde les comptes d'un passage à l'autre.
    expect(s.team?.label).toBe(`${plural(usersBefore, "compte", "comptes")} · 1 invitation en attente`);
    expect(s.alerts).toEqual({ tone: "warning", label: "1 alerte ouverte" });
    expect(s.ai).toEqual({ tone: "success", label: "Prêt" });
    expect(input.categories).toBe(categoriesBefore + 1);
    expect(s.tags).toEqual({ tone: "neutral", label: "2 étiquettes" });
    // Tuiles qui ne sont pas vertes : Bots (1 à vérifier) et Alertes (1 ouverte).
    expect(s.status).toEqual({
      tone: "danger",
      label: "2 points à voir",
      title: "Bots : 1 à vérifier · Alertes : 1 ouverte",
    });
    expect(s.postbacks).toEqual({ tone: "neutral", label: "1 adresse active" });
  });

  it("sans données : rien de connecté, clé IA absente, pas encore synchronisé", async () => {
    const input = await loadSettingsStateInput(
      new Set(["linkaffi", "meta", "telegram", "ai", "tags", "postbacks"]),
      NOW,
    );
    const s = settingsStates(input, NOW);
    expect(s.linkaffi?.label).toBe("Pas encore synchronisé");
    expect(s.meta?.label).toBe("Aucun compte connecté");
    expect(s.telegram?.label).toBe("Non connecté");
    expect(s.ai?.label).toBe("Clé IA absente");
    expect(s.tags?.label).toBe("Aucune étiquette");
    expect(s.postbacks?.label).toBe("Aucune adresse");
  });
});
