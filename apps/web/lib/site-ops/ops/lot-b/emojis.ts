/**
 * Phase 34, lot B — cœurs de la bibliothèque des emojis animés (Messages → Emojis animés, phase 12). Importer un pack
 * ou les packs du compte, relancer les aperçus : administrateurs et responsables ; retirer / remettre un emoji :
 * administrateurs seulement (règle « responsable : tout sauf suppressions »).
 */
import { isValidCustomEmojiId, parseEmojiPackLink } from "@linkaffipro/core";
import { audit, prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { BAD_LINK_MESSAGE, STICKER_PACK_MESSAGE, importEmojiPack } from "@/lib/custom-emoji/pack-import";
import { requestAccountImport } from "@/lib/custom-emoji/account-import";
import { fail, needUser, ok, preview, str, viaMeta, type CoreRun } from "./common";

export const EMOJI_ADMIN_ONLY =
  "Seul un administrateur peut retirer un emoji animé de la bibliothèque (ou l'y remettre).";

/** Coller le lien d'un pack : tous ses emojis dans la bibliothèque. */
export const emojiImportPack: CoreRun = async (input, actor, opts = {}) => {
  const link = str(input.link).trim().slice(0, 300);
  if (!link) return fail("Collez le lien du pack (il commence par https://t.me/addemoji/).", "invalid", "link");
  const noUser = needUser(actor);
  if (noUser) return noUser;
  if (opts.dryRun) {
    if (/(^|\/)addstickers\//i.test(link) || /^tg:\/\/addstickers/i.test(link)) return fail(STICKER_PACK_MESSAGE, "invalid", "link");
    const name = parseEmojiPackLink(link);
    if (!name) return fail(BAD_LINK_MESSAGE, "invalid", "link");
    return preview({ summary: `Ajout de tous les emojis animés du pack « ${name} » à la bibliothèque.` });
  }
  const res = await importEmojiPack(link, { userId: actor.userId!, via: actor.via });
  if (!res.ok) return fail(res.error);
  return ok(res.message, { added: res.added, already: res.already });
};

/** Importer les packs installés sur le compte Telegram connecté. */
export const emojiImportAccount: CoreRun = async (_input, actor, opts = {}) => {
  const noUser = needUser(actor);
  if (noUser) return noUser;
  const res = await requestAccountImport(actor.userId!, { via: actor.via, dryRun: opts.dryRun });
  if (!res.ok) return fail(res.error, "unavailable");
  return opts.dryRun ? preview({ summary: res.message }) : ok(res.message);
};

/** Nouvel essai de récupération des aperçus manquants (tâche du service d'arrière-plan). */
export const emojiRetryPreviews: CoreRun = async (_input, _actor, opts = {}) => {
  const missing = await prisma.customEmoji.findMany({
    where: { hiddenAt: null, previewMime: null },
    select: { customEmojiId: true },
    take: 1000,
  });
  if (missing.length === 0) return ok("Tous les aperçus sont déjà là.");
  if (opts.dryRun) return preview({ summary: `Nouvel essai pour ${missing.length} aperçu${missing.length > 1 ? "s" : ""} manquant${missing.length > 1 ? "s" : ""}.` });
  try {
    await enqueue(
      "custom-emoji",
      { type: "fetch-previews", customEmojiIds: missing.map((m) => m.customEmojiId) },
      { jobId: `custom-emoji:previews:manual:${Math.floor(Date.now() / 60_000)}` },
    );
  } catch {
    return fail("Le service d'arrière-plan ne répond pas : réessayez dans une minute.", "unavailable");
  }
  return ok("C'est demandé : les aperçus arrivent d'ici une minute.");
};

/** Emoji par son identifiant Telegram (`customEmojiId`) ou par l'emoji de remplacement (« 🔥 », Kevin). */
async function emojiIdOf(input: Record<string, unknown>): Promise<string> {
  const id = str(input.customEmojiId).trim();
  if (id) return id;
  const fallback = str(input.emoji).trim();
  if (!fallback) return "";
  const rows = await prisma.customEmoji.findMany({ where: { fallback }, select: { customEmojiId: true }, take: 2 });
  return rows.length === 1 ? rows[0]!.customEmojiId : "";
}

/**
 * Retirer un emoji de la bibliothèque (il n'est plus proposé dans le sélecteur ; les messages qui l'utilisent gardent
 * leur emoji animé) ou l'y remettre. Administrateurs seulement.
 */
function setHidden(hidden: boolean): CoreRun {
  return async (input, actor, opts = {}) => {
    if (actor.role !== "ADMIN") return fail(EMOJI_ADMIN_ONLY, "forbidden");
    const customEmojiId = await emojiIdOf(input);
    if (!isValidCustomEmojiId(customEmojiId)) return fail("Emoji animé introuvable.", "not_found");
    const row = await prisma.customEmoji.findUnique({
      where: { customEmojiId },
      select: { id: true, fallback: true, setName: true, hiddenAt: true },
    });
    if (!row) return fail("Emoji animé introuvable.", "not_found");
    if (opts.dryRun)
      return preview({
        summary: hidden ? `Retirer l'emoji ${row.fallback} de la bibliothèque.` : `Remettre l'emoji ${row.fallback} dans la bibliothèque.`,
        ...(hidden ? { impact: "Les messages qui l'utilisent le gardent." } : {}),
      });
    if (Boolean(row.hiddenAt) !== hidden)
      await prisma.customEmoji.update({ where: { id: row.id }, data: { hiddenAt: hidden ? new Date() : null } });
    await audit({
      userId: actor.userId,
      action: hidden ? "custom_emoji.hidden" : "custom_emoji.restored",
      entityType: "CustomEmoji",
      entityId: row.id,
      metadata: { customEmojiId, fallback: row.fallback, setName: row.setName, ...viaMeta(actor) },
    });
    return ok(
      hidden
        ? `Emoji ${row.fallback} retiré de la bibliothèque. Les messages qui l'utilisent le gardent.`
        : `Emoji ${row.fallback} remis dans la bibliothèque.`,
    );
  };
}

export const emojiHide = setHidden(true);
export const emojiRestore = setHidden(false);
