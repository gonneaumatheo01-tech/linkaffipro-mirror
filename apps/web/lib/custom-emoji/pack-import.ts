/**
 * Ajout d'un pack d'emojis animés par son lien (D2, phase 12) : « https://t.me/addemoji/NomDuPack » → `getStickerSet`
 * par un de nos bots actifs (Bot API) → tous les emojis du pack dans la bibliothèque (source PACK), puis la tâche
 * `custom-emoji` `fetch-previews` pour leurs aperçus. Le client Telegram est injectable (tests, aucun appel réseau).
 */
import { parseEmojiPackLink } from "@linkaffipro/core";
import { audit, prisma, recordEvent } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { enqueue } from "@linkaffipro/queue";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { GrammyError, HttpError } from "grammy";
import { addedSummary, packRows, type PackSticker } from "./library";

/** Pack Telegram (champs utiles de `StickerSet`). */
export type StickerSetLike = {
  name: string;
  title: string;
  sticker_type: string;
  stickers: readonly PackSticker[];
};

/** Lecture d'un pack par son nom court. Lève `PackFetchError` (ou une erreur grammY) en cas d'échec. */
export type FetchStickerSet = (name: string) => Promise<StickerSetLike>;

export class PackFetchError extends Error {
  constructor(
    public code: "not_found" | "no_bot" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PackFetchError";
  }
}

export const STICKER_PACK_MESSAGE = "Ce lien est un pack d'autocollants, pas d'emojis animés.";
export const BAD_LINK_MESSAGE =
  "Ce lien n'est pas celui d'un pack d'emojis animés. Il ressemble à https://t.me/addemoji/NomDuPack.";

/** Pack introuvable pour Telegram (nom inconnu ou pack supprimé). */
function isNotFound(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    err.error_code === 400 &&
    /STICKERSET_INVALID|sticker set.*(not found|invalid)/i.test(err.description)
  );
}

/**
 * Lit le pack avec le premier de nos bots actifs qui répond (un jeton refusé ou une panne passe au bot suivant).
 * Un pack introuvable est définitif : pas d'essai avec les autres bots.
 */
export const fetchWithOurBots: FetchStickerSet = async (name) => {
  // Bots normaux seulement (phase 17 : un bot assistant de conversation ne sert qu'à ses conversations).
  const bots = await prisma.bot.findMany({
    where: ACTIVE_CHANNEL_BOT_WHERE,
    orderBy: { createdAt: "asc" },
  });
  if (bots.length === 0)
    throw new PackFetchError(
      "no_bot",
      "Aucun bot actif pour lire le pack : activez un bot dans Réglages → Bots.",
    );
  let tokensRefused = 0;
  for (const bot of bots) {
    try {
      const set = await getOrCreateBot(bot, prismaTelegramDeps).api.getStickerSet(name);
      return {
        name: set.name,
        title: set.title,
        sticker_type: set.sticker_type,
        stickers: set.stickers,
      };
    } catch (err) {
      if (isNotFound(err))
        throw new PackFetchError("not_found", "Telegram ne trouve pas ce pack : vérifiez le lien.");
      if (
        err instanceof GrammyError &&
        (err.error_code === 401 || (err.error_code === 404 && /^not found$/i.test(err.description)))
      )
        tokensRefused++;
      else if (!(err instanceof HttpError) && !(err instanceof GrammyError)) throw err;
    }
  }
  if (tokensRefused === bots.length)
    throw new PackFetchError(
      "no_bot",
      "Telegram ne reconnaît plus nos bots : renouvelez leurs jetons dans Réglages → Bots, puis réessayez.",
    );
  throw new PackFetchError(
    "unavailable",
    "Telegram ne répond pas pour l'instant : réessayez dans une minute.",
  );
};

export type PackImportResult =
  | {
      ok: true;
      setName: string;
      title: string;
      /** Emojis nouveaux, ou retirés puis remis dans la bibliothèque. */
      added: number;
      /** Emojis déjà visibles dans la bibliothèque. */
      already: number;
      message: string;
    }
  | { ok: false; error: string };

/** Ajoute (ou complète) tous les emojis d'un pack ; jamais de doublon (unicité de `customEmojiId`). */
export async function importEmojiPack(
  input: string,
  opts: { userId: string; fetchStickerSet?: FetchStickerSet },
): Promise<PackImportResult> {
  const raw = input.trim();
  if (/(^|\/)addstickers\//i.test(raw) || /^tg:\/\/addstickers/i.test(raw))
    return { ok: false, error: STICKER_PACK_MESSAGE };
  const name = parseEmojiPackLink(raw);
  if (!name) return { ok: false, error: BAD_LINK_MESSAGE };

  let set: StickerSetLike;
  try {
    set = await (opts.fetchStickerSet ?? fetchWithOurBots)(name);
  } catch (err) {
    if (err instanceof PackFetchError) return { ok: false, error: err.message };
    if (isNotFound(err))
      return { ok: false, error: "Telegram ne trouve pas ce pack : vérifiez le lien." };
    return {
      ok: false,
      error: "Telegram ne répond pas pour l'instant : réessayez dans une minute.",
    };
  }
  if (set.sticker_type !== "custom_emoji") return { ok: false, error: STICKER_PACK_MESSAGE };
  const rows = packRows(set.stickers);
  if (rows.length === 0) return { ok: false, error: "Ce pack ne contient aucun emoji animé." };

  const ids = rows.map((r) => r.customEmojiId);
  const existing = await prisma.customEmoji.findMany({
    where: { customEmojiId: { in: ids } },
    select: {
      customEmojiId: true,
      hiddenAt: true,
      fallback: true,
      format: true,
      previewMime: true,
    },
  });
  const byId = new Map(existing.map((e) => [e.customEmojiId, e]));
  const fresh = rows.filter((r) => !byId.has(r.customEmojiId));
  await prisma.customEmoji.createMany({
    data: fresh.map((r) => ({
      customEmojiId: r.customEmojiId,
      fallback: r.fallback,
      format: r.format,
      setName: set.name,
      setTitle: set.title,
      source: "PACK" as const,
      addedById: opts.userId,
    })),
    skipDuplicates: true,
  });
  const known = rows.filter((r) => byId.has(r.customEmojiId));
  if (known.length > 0)
    await prisma.$transaction(
      known.map((r) => {
        const e = byId.get(r.customEmojiId)!;
        return prisma.customEmoji.update({
          where: { customEmojiId: r.customEmojiId },
          data: {
            setName: set.name,
            setTitle: set.title,
            hiddenAt: null,
            ...(e.format ? {} : { format: r.format }),
            ...(e.fallback.trim() ? {} : { fallback: r.fallback }),
          },
        });
      }),
    );

  const restored = known
    .filter((r) => byId.get(r.customEmojiId)!.hiddenAt)
    .map((r) => r.customEmojiId);
  const addedIds = [...fresh.map((r) => r.customEmojiId), ...restored];
  const already = known.length - restored.length;
  const needPreview = [
    ...fresh.map((r) => r.customEmojiId),
    ...known.filter((r) => !byId.get(r.customEmojiId)!.previewMime).map((r) => r.customEmojiId),
  ];
  if (needPreview.length > 0)
    await enqueue(
      "custom-emoji",
      { type: "fetch-previews", customEmojiIds: needPreview },
      { jobId: `custom-emoji:previews:pack:${set.name}:${Date.now()}` },
    ).catch((err: unknown) => {
      // Sans file (Redis en panne) : le passage périodique du worker récupère les aperçus manquants.
      console.error("[custom-emoji] aperçus non demandés", err);
    });

  await audit({
    userId: opts.userId,
    action: "custom_emoji.pack_imported",
    entityType: "CustomEmoji",
    entityId: set.name,
    metadata: {
      setName: set.name,
      setTitle: set.title,
      added: addedIds.length,
      already,
      total: rows.length,
    },
  });
  if (addedIds.length > 0)
    await recordEvent({
      type: "custom_emoji.added",
      payload: {
        count: addedIds.length,
        source: "PACK",
        ids: addedIds,
        setName: set.name,
        already,
      },
    });

  return {
    ok: true,
    setName: set.name,
    title: set.title,
    added: addedIds.length,
    already,
    message: `${set.title} : ${addedSummary(addedIds.length, already)}`,
  };
}
