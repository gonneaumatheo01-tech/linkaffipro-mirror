/**
 * Phase 13 : clic d'offre (`/start o…`, mise à jour Telegram simulée) d'un membre amené par un affilié Link Affi :
 * bouton vers le lien Link Affi avec `&tg=`, clé copiée sur le clic, événement `offer_clicked` pour Link Affi (sub-ID et
 * clé de l'offre). Membre sans affilié : rien ne change.
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { OfferDeps, OfferMemberAffiliate } from "../offers/deps";
import { registerOfferHandlers } from "./offers";

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};

function deps(
  affiliate: OfferMemberAffiliate | null,
  offerCampaignKey: string | null = "47eb8mwc",
) {
  const clicks: Array<Parameters<OfferDeps["recordOfferClick"]>[0]> = [];
  const d = {
    memberStarted: vi.fn(async () => ({ memberId: "m1", affiliate })),
    resolveOffer: vi.fn(async () => ({
      trackingLinkId: "tl1",
      destinationTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
      postId: "p1",
      channelId: "c1",
      channelLanguage: "fr",
      offerCampaignKey,
    })),
    recordOfferClick: vi.fn(async (input: Parameters<OfferDeps["recordOfferClick"]>[0]) => {
      clicks.push(input);
      return { clickId: `click${clicks.length}` };
    }),
    offerReplyTexts: vi.fn(async () => null),
    emitLinkaffiEvent: vi.fn(async () => ({ status: "queued" })),
  } satisfies OfferDeps;
  return { d, clicks };
}

async function click(d: OfferDeps) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: 42, type: "private", first_name: "x" } },
    } as never;
  });
  registerOfferHandlers(bot, identity, d);
  const update: Update = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 42, type: "private", first_name: "Jean" },
      from: { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" },
      text: "/start oabc12345_AbCdEfGh",
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
  await bot.handleUpdate(update);
  const reply = calls.find((c) => c.method === "sendMessage")!;
  return (reply.payload.reply_markup as { inline_keyboard: Array<Array<{ url: string }>> })
    .inline_keyboard[0]![0]!.url;
}

describe("clic d'offre d'un membre d'affilié Link Affi", () => {
  it("bouton avec `&tg=`, clé sur le clic, « offer_clicked » envoyé avec le sub-ID et la clé de l'offre", async () => {
    const { d, clicks } = deps({ campaignKey: "paulTG01", attributionEndsAt: null });
    const url = await click(d);
    const c = clicks[0]!;
    expect(c.destination).toBe(`https://linkaffi.me/go/47eb8mwc?sub_id=${c.subId}&tg=paulTG01`);
    expect(c.linkaffiTelegramCampaignKey).toBe("paulTG01");
    expect(url).toBe(c.destination);
    expect(d.emitLinkaffiEvent).toHaveBeenCalledTimes(1);
    expect(d.emitLinkaffiEvent).toHaveBeenCalledWith({
      type: "offer_clicked",
      sourceId: "click1",
      memberId: "m1",
      channelId: "c1",
      occurredAt: expect.any(Date),
      data: { subId: c.subId, offerCampaignKey: "47eb8mwc" },
    });
  });

  it("membre sans affilié : lien d'origine, aucun événement", async () => {
    const { d, clicks } = deps(null);
    await click(d);
    expect(clicks[0]!.destination).toBe(
      `https://linkaffi.me/go/47eb8mwc?sub_id=${clicks[0]!.subId}`,
    );
    expect(clicks[0]!.linkaffiTelegramCampaignKey).toBeNull();
    expect(d.emitLinkaffiEvent).not.toHaveBeenCalled();
  });

  it("attribution terminée : lien d'origine, aucun événement", async () => {
    const { d, clicks } = deps({
      campaignKey: "paulTG01",
      attributionEndsAt: new Date(Date.now() - 1000),
    });
    await click(d);
    expect(clicks[0]!.destination).not.toContain("tg=");
    expect(d.emitLinkaffiEvent).not.toHaveBeenCalled();
  });

  it("offre hors Link Affi : pas de `tg`, mais le clic du membre est envoyé (sans clé d'offre)", async () => {
    const { d, clicks } = deps({ campaignKey: "paulTG01", attributionEndsAt: null }, null);
    await click(d);
    expect(clicks[0]!.destination).not.toContain("tg=");
    expect(clicks[0]!.linkaffiTelegramCampaignKey).toBeNull();
    expect(d.emitLinkaffiEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: { subId: clicks[0]!.subId, offerCampaignKey: null } }),
    );
  });

  it("un échec d'enregistrement de l'événement ne bloque pas la réponse", async () => {
    const { d } = deps({ campaignKey: "paulTG01", attributionEndsAt: null });
    d.emitLinkaffiEvent.mockRejectedValueOnce(new Error("base indisponible"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await click(d)).toContain("tg=paulTG01");
    warn.mockRestore();
  });
});
