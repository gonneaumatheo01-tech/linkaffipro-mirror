import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { OfferDeps } from "../offers/deps";
import { registerHandlers } from "../handlers";
import type { TelegramDeps } from "../ports";
import { buildOfferPayload, offerDeepLink, parseOfferPayload } from "../offers/logic";
import { registerOfferHandlers } from "./offers";

const identity: BotIdentity = { id: "bot_1", name: "CasinoBot", username: "casinobot", telegramBotId: 111n, vertical: "CASINO" };

function coreDeps(): TelegramDeps {
  return {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c1" })),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
    linkAdminAccount: vi.fn(async () => null),
  };
}

function offerDeps(overrides: Partial<OfferDeps> = {}): OfferDeps & { clicks: Array<Parameters<OfferDeps["recordOfferClick"]>[0]> } {
  const clicks: Array<Parameters<OfferDeps["recordOfferClick"]>[0]> = [];
  return {
    clicks,
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    resolveOffer: vi.fn(async (slug: string, postCode: string | null) =>
      slug === "abc12345"
        ? { trackingLinkId: "tl1", destinationTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}", postId: postCode ? "p1" : null, channelId: "c1", channelLanguage: "fr" }
        : null,
    ),
    recordOfferClick: vi.fn(async (input) => {
      clicks.push(input);
      return { clickId: `click${clicks.length}` };
    }),
    offerReplyTexts: vi.fn(async () => null),
    ...overrides,
  };
}

function makeBot(deps: OfferDeps) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 42, type: "private", first_name: "x" }, text: "ok" } } as never;
  });
  // En production, registerHandlers branche les offres AVANT le /start générique (hook beforeStart) ; ici on fait
  // pareil à la main pour injecter des deps simulées.
  registerOfferHandlers(bot, identity, deps);
  registerHandlers(bot, identity, coreDeps(), { extended: false });
  return { bot, apiCalls };
}

function startUpdate(text: string): Update {
  return { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 42, type: "private", first_name: "Jean" }, from: { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" }, text, entities: [{ type: "bot_command", offset: 0, length: 6 }] } };
}

describe("charge utile d'offre", () => {
  it("analyse o<slug>_<code>", () => {
    expect(parseOfferPayload("oabc12345_AbCdEfGh")).toEqual({ slug: "abc12345", postCode: "AbCdEfGh" });
    expect(parseOfferPayload("oabc12345")).toEqual({ slug: "abc12345", postCode: null });
    expect(parseOfferPayload("gabc")).toBeNull();
    expect(parseOfferPayload("oab")).toBeNull();
    expect(parseOfferPayload("oabc12345_x")).toBeNull();
    expect(parseOfferPayload("o" + "a".repeat(70))).toBeNull();
  });
  it("construit le lien profond (≤ 64 caractères)", () => {
    const p = buildOfferPayload("abc12345", "AbCdEfGh");
    expect(p).toBe("oabc12345_AbCdEfGh");
    expect(p.length).toBeLessThanOrEqual(64);
    expect(offerDeepLink("casinobot", "abc12345", "AbCdEfGh")).toBe("https://t.me/casinobot?start=oabc12345_AbCdEfGh");
  });
});

describe("/start o… (offre personnalisée)", () => {
  async function run(text: string, deps = offerDeps()) {
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(startUpdate(text));
    return { deps, apiCalls };
  }

  it("crée un clic avec un sub-ID de 12 caractères et répond avec le lien Link Affi", async () => {
    const { deps, apiCalls } = await run("/start oabc12345_AbCdEfGh");
    expect(deps.memberStarted).toHaveBeenCalledTimes(1);
    expect(deps.clicks).toHaveLength(1);
    const click = deps.clicks[0]!;
    expect(click.subId).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(click.postId).toBe("p1");
    expect(click.memberId).toBe("m1");
    expect(click.botId).toBe("bot_1");
    expect(click.destination).toBe(`https://linkaffi.me/go/47eb8mwc?sub_id=${click.subId}`);
    const reply = apiCalls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("Jean");
    const kb = reply.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; url: string }>> };
    expect(kb.inline_keyboard[0]![0]!.url).toBe(click.destination);
    expect(kb.inline_keyboard[0]![0]!.text).toBe("Ouvrir l'offre");
  });

  it("génère un nouveau sub-ID à chaque reclic", async () => {
    const deps = offerDeps();
    await run("/start oabc12345_AbCdEfGh", deps);
    await run("/start oabc12345_AbCdEfGh", deps);
    expect(deps.clicks).toHaveLength(2);
    expect(deps.clicks[0]!.subId).not.toBe(deps.clicks[1]!.subId);
  });

  it("utilise la séquence OFFER_REPLY du canal quand elle existe", async () => {
    const deps = offerDeps({ offerReplyTexts: vi.fn(async () => ({ text: "Salut {prenom}, ton bonus :", button: "Go" })) });
    const { apiCalls } = await run("/start oabc12345", deps);
    const reply = apiCalls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toBe("Salut Jean, ton bonus :");
    expect((reply.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard[0]![0]!.text).toBe("Go");
  });

  it("répond « lien invalide » pour un slug inconnu, sans créer de clic", async () => {
    const { deps, apiCalls } = await run("/start ozzzzzzzz");
    expect(deps.clicks).toHaveLength(0);
    expect(apiCalls.find((c) => c.method === "sendMessage")!.payload.text).toMatch(/plus valable/);
  });

  it("laisse passer un /start sans charge utile d'offre", async () => {
    const { deps, apiCalls } = await run("/start");
    expect(deps.resolveOffer).not.toHaveBeenCalled();
    // Le /start générique (core) a répondu.
    expect(apiCalls.find((c) => c.method === "sendMessage")!.payload.text).toContain("Bonjour");
  });
});
