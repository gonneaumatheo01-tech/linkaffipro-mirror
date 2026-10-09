import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { fillUrlTemplate, newSubId } from "@linkaffipro/core";
import type { BotIdentity } from "../ports";
import { pickLang } from "../i18n";
import type { OfferDeps } from "../offers/deps";
import { DEFAULT_OFFER_REPLY, INVALID_OFFER_REPLY, fillPlaceholders, parseOfferPayload } from "../offers/logic";

let defaultDeps: OfferDeps | null = null;
async function loadDefaultDeps(): Promise<OfferDeps> {
  if (!defaultDeps) defaultDeps = (await import("../offers/prisma-deps")).prismaOfferDeps;
  return defaultDeps;
}

/**
 * `/start o<slug>_<code post>` : offre personnalisée. Crée un clic avec un sub-ID neuf (12 caractères),
 * construit l'URL Link Affi (`…/go/<key>?sub_id=<subId>`) et répond avec un bouton « Ouvrir l'offre ».
 */
export function registerOfferHandlers(bot: Bot, identity: BotIdentity, deps?: OfferDeps): void {
  bot.command("start", async (ctx, next) => {
    const from = ctx.from;
    const payload = typeof ctx.match === "string" ? ctx.match : "";
    if (!from || ctx.chat?.type !== "private" || !payload.startsWith("o")) return next();
    const d = deps ?? (await loadDefaultDeps());
    const lang = pickLang(from.language_code);
    const parsed = parseOfferPayload(payload);
    const { memberId } = await d.memberStarted(identity.id, from);
    const offer = parsed ? await d.resolveOffer(parsed.slug, parsed.postCode) : null;
    if (!offer) {
      await ctx.reply(INVALID_OFFER_REPLY[lang] ?? INVALID_OFFER_REPLY.fr!);
      return;
    }
    const subId = newSubId();
    const destination = fillUrlTemplate(offer.destinationTemplate, { subid: subId, member_id: memberId, post_id: offer.postId ?? "" });
    await d.recordOfferClick({ trackingLinkId: offer.trackingLinkId, postId: offer.postId, memberId, botId: identity.id, subId, destination });
    const textLang = lang in DEFAULT_OFFER_REPLY ? lang : (offer.channelLanguage ?? "fr");
    const custom = await d.offerReplyTexts(offer.channelId, lang);
    const texts = custom ?? DEFAULT_OFFER_REPLY[textLang] ?? DEFAULT_OFFER_REPLY.fr!;
    const text = fillPlaceholders(texts.text, { prenom: from.first_name, bot: identity.name });
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().url(texts.button, destination),
      link_preview_options: { is_disabled: true },
    });
  });
}
