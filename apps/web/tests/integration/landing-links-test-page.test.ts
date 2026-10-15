/**
 * Phase 15 (D12), script `pnpm landing:test-page` sur base réelle (Telegram simulé, aucun appel réseau) : la page
 * « test » ne va QUE sur un canal marqué « canal de test » ; tout autre canal est refusé et une page « test » posée sur
 * un vrai canal n'est jamais touchée ; sources tk01, tk03, exo1 et la source par défaut, un lien chacune, sans doublon
 * si on relance ; adresses affichées.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { createTestBot, resetDb, type TelegramCall } from "./helpers";

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
  updateTag: () => undefined,
  revalidateTag: () => undefined,
}));

const { runLandingTestPage, TestPageError } = await import("@/scripts/landing-test-page");

function install(api: Api, selfId: number): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let n = 0;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+${(++n).toString(36).padStart(3, "0")}T${selfId}xxxxxx`,
          creator: { id: selfId, is_bot: true, first_name: "bot" },
          creates_join_request: p.creates_join_request === true,
          is_primary: false,
          is_revoked: false,
          name: p.name,
        },
      } as never;
    if (method === "getChat")
      return {
        ok: true,
        result: { id: Number(p.chat_id), type: "channel", title: "Canal TEST" },
      } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

async function clean() {
  await prisma.landingSource.deleteMany();
  await prisma.landingPage.deleteMany();
  await resetDb();
}

describe("page de test (canal de test seulement)", () => {
  let calls: TelegramCall[] = [];
  const ids = { real: "", test: "" };

  beforeEach(async () => {
    await clean();
    const bot = await createTestBot(961, "CASINO");
    calls = install(getOrCreateBot(bot, prismaTelegramDeps).api, 961);
    const make = async (chatId: bigint, title: string, isTest: boolean) => {
      const c = await prisma.channel.create({
        data: { telegramChatId: chatId, title, vertical: "CASINO", primaryBotId: bot.id, isTest },
      });
      await prisma.channelBotAdmin.create({
        data: {
          channelId: c.id,
          botId: bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      return c.id;
    };
    ids.real = await make(-1001_960_000_001n, "Vrai canal casino", false);
    ids.test = await make(-1001_960_000_002n, "Canal TEST", true);
  });

  afterAll(clean);

  it("refuse un vrai canal : aucune page, aucun appel à Telegram", async () => {
    await expect(runLandingTestPage({ channelId: ids.real })).rejects.toThrow(TestPageError);
    await expect(runLandingTestPage({ channelId: ids.real })).rejects.toThrow(
      "Refusé : « Vrai canal casino » n'est pas un canal de test.",
    );
    expect(await prisma.landingPage.count()).toBe(0);
    expect(calls).toEqual([]);
  });

  it("canal de test : page « test » et ses 4 sources, un lien chacune ; relancé : rien de neuf", async () => {
    const r = await runLandingTestPage({ baseUrl: "https://go.goolink.eu" });
    expect(r).toMatchObject({ dryRun: false, created: true, channel: { id: ids.test } });
    expect(r.sources.map((s) => s.url)).toEqual([
      "https://go.goolink.eu/j/test",
      "https://go.goolink.eu/j/test?src=tk01",
      "https://go.goolink.eu/j/test?src=tk03",
      "https://go.goolink.eu/j/test?src=exo1",
    ]);
    expect(r.sources.every((s) => s.inviteUrl?.startsWith("https://t.me/+"))).toBe(true);
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { slug: "test" },
      include: { sources: true },
    });
    expect(page.channelId).toBe(ids.test);
    expect(page.sources.map((s) => s.key).sort()).toEqual(["", "exo1", "tk01", "tk03"]);
    const links = await prisma.inviteLink.findMany({ where: { landingPageId: page.id } });
    expect(links.map((l) => l.name).sort()).toEqual([
      "test",
      "test-exo1",
      "test-tk01",
      "test-tk03",
    ]);
    expect(links.every((l) => l.channelId === ids.test && l.createsJoinRequest)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: "landing.test_page_created", entityId: page.id },
      }),
    ).toBe(1);

    const before = calls.length;
    const again = await runLandingTestPage({ baseUrl: "https://go.goolink.eu" });
    expect(again.created).toBe(false);
    expect(calls.filter((c) => c.method === "createChatInviteLink").length).toBe(4);
    expect(calls.length).toBe(before);
    expect(await prisma.inviteLink.count({ where: { landingPageId: page.id } })).toBe(4);
  });

  it("essai à blanc : rien n'est écrit", async () => {
    const r = await runLandingTestPage({ dryRun: true });
    expect(r).toMatchObject({ dryRun: true, created: true, pageId: null });
    expect(await prisma.landingPage.count()).toBe(0);
    expect(calls).toEqual([]);
  });

  it("une page « test » déjà sur un vrai canal n'est jamais touchée", async () => {
    await prisma.landingPage.create({
      data: { slug: "test", name: "test", channelId: ids.real, headline: "Ne pas toucher" },
    });
    await expect(runLandingTestPage()).rejects.toThrow(
      "Refusé : l'adresse /j/test est déjà une page du canal « Vrai canal casino »",
    );
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { slug: "test" },
      include: { sources: true },
    });
    expect(page.headline).toBe("Ne pas toucher");
    expect(page.sources).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("plusieurs canaux de test : il faut choisir (--channel)", async () => {
    await prisma.channel.create({
      data: { telegramChatId: -1001_960_000_003n, title: "Autre test", isTest: true },
    });
    await expect(runLandingTestPage()).rejects.toThrow("Plusieurs canaux de test");
  });
});
