import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  isAffiliateAttributionActive,
  newSubId,
  TELEGRAM_CAPTION_MAX,
  textLength,
} from "@linkaffipro/core";
import type { BotIdentity } from "../ports";
import { isLang, pickLang } from "../i18n";
import type { OfferDeps } from "../offers/deps";
import {
  DEFAULT_OFFER_REPLY,
  INVALID_OFFER_REPLY,
  fillPlaceholders,
  offerDestination,
  parseOfferPayload,
} from "../offers/logic";
import { sendWithEmojiFallback, type CustomEmojiFallbackInfo } from "../custom-emoji/fallback";

let defaultDeps: OfferDeps | null = null;
async function loadDefaultDeps(): Promise<OfferDeps> {
  if (!defaultDeps) defaultDeps = (await import("../offers/prisma-deps")).prismaOfferDeps;
  return defaultDeps;
}

/**
 * `/start o<slug>_<code post>` : offre personnalisée. Crée un clic avec un sub-ID neuf (12 caractères),
 * construit l'URL Link Affi (`…/go/<key>?sub_id=<subId>`) et répond avec un bouton « Ouvrir l'offre ».
 * Sert à tous les boutons d'offre : messages de canal, relances, écrire à un groupe, réponses d'offre.
 * Phase 13 : membre rattaché à une campagne Telegram d'affilié Link Affi (attribution en cours) → `&tg=<clé>` ajouté
 * au lien Link Affi, clé copiée sur le clic, événement `offer_clicked` (sub-ID, clé de l'offre) envoyé à Link Affi.
 */
export function registerOfferHandlers(bot: Bot, identity: BotIdentity, deps?: OfferDeps): void {
  bot.command("start", async (ctx, next) => {
    const from = ctx.from;
    const payload = typeof ctx.match === "string" ? ctx.match : "";
    if (!from || ctx.chat?.type !== "private" || !payload.startsWith("o")) return next();
    const d = deps ?? (await loadDefaultDeps());
    const lang = pickLang(from.language_code);
    const parsed = parseOfferPayload(payload);
    const { memberId, affiliate } = await d.memberStarted(identity.id, from);
    const offer = parsed ? await d.resolveOffer(parsed.slug, parsed.postCode) : null;
    if (!offer) {
      await ctx.reply(INVALID_OFFER_REPLY[lang]);
      return;
    }
    const subId = newSubId();
    const now = new Date();
    const { destination, telegramCampaignKey } = offerDestination({
      template: offer.destinationTemplate,
      subId,
      memberId,
      postId: offer.postId,
      offerCampaignKey: offer.offerCampaignKey,
      affiliate,
      now,
    });
    const { clickId } = await d.recordOfferClick({
      trackingLinkId: offer.trackingLinkId,
      postId: offer.postId,
      memberId,
      botId: identity.id,
      subId,
      destination,
      linkaffiTelegramCampaignKey: telegramCampaignKey,
    });
    // Membre d'un affilié Link Affi (attribution en cours) : le clic part aussi à Link Affi, qui rapproche le sub-ID du
    // joueur. Jamais bloquant pour la réponse.
    if (
      d.emitLinkaffiEvent &&
      affiliate?.campaignKey &&
      isAffiliateAttributionActive(
        {
          linkaffiCampaignKey: affiliate.campaignKey,
          affiliateAttributionEndsAt: affiliate.attributionEndsAt,
        },
        now,
      )
    )
      await d
        .emitLinkaffiEvent({
          type: "offer_clicked",
          sourceId: clickId,
          memberId,
          channelId: offer.channelId,
          occurredAt: now,
          data: { subId, offerCampaignKey: offer.offerCampaignKey ?? null },
        })
        .catch((err: unknown) =>
          console.warn("[offers] événement Link Affi non enregistré", {
            clickId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    // Langue du membre si le bot la connaît, sinon celle du canal, sinon fr.
    const channelLang = pickLang(offer.channelLanguage);
    const textLang = isLang(from.language_code?.toLowerCase().split(/[-_]/)[0])
      ? lang
      : channelLang;
    const custom = await d.offerReplyTexts(offer.channelId, lang, identity.id);
    const texts = custom ?? DEFAULT_OFFER_REPLY[textLang];
    const text = fillPlaceholders(texts.text, { prenom: from.first_name, bot: identity.name });
    const keyboard = new InlineKeyboard().url(texts.button, destination);
    const media = custom?.media ?? null;
    // Emojis animés du texte de l'équipe refusés par Telegram : même réponse aussitôt renvoyée avec les emojis de
    // remplacement, et journalisée (phase 12, règle commune avec les messages privés du worker).
    const onFallback = (info: CustomEmojiFallbackInfo) =>
      d.recordEvent?.({
        type: "dm.custom_emoji_fallback",
        memberId,
        botId: identity.id,
        payload: {
          outboundMessageId: null,
          botId: identity.id,
          error: info.error,
          resent: info.resent,
          via: "offer_reply",
        },
      });
    // Média avec légende (≤ 1024 caractères visibles, comme send-dm : un emoji animé compte comme son emoji de
    // remplacement, jamais la longueur de sa balise) si Telegram connaît déjà le fichier pour ce bot ; sinon texte seul.
    if (media && textLength(text) <= TELEGRAM_CAPTION_MAX) {
      try {
        await sendWithEmojiFallback<unknown>(
          text,
          (caption) => {
            const opts = { caption, parse_mode: "HTML" as const, reply_markup: keyboard };
            if (media.kind === "photo") return ctx.replyWithPhoto(media.fileId, opts);
            if (media.kind === "video") return ctx.replyWithVideo(media.fileId, opts);
            if (media.kind === "animation") return ctx.replyWithAnimation(media.fileId, opts);
            return ctx.replyWithDocument(media.fileId, opts);
          },
          onFallback,
        );
        return;
      } catch (err) {
        console.warn("[offers] média non envoyé, repli texte", (err as Error).message);
      }
    }
    await sendWithEmojiFallback(
      text,
      (t) =>
        ctx.reply(t, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        }),
      onFallback,
    );
  });
}
