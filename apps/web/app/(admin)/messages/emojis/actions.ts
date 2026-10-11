"use server";

import { revalidatePath } from "next/cache";
import { isValidCustomEmojiId } from "@linkaffipro/core";
import { audit, prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireUser } from "@/lib/session";
import { importEmojiPack } from "@/lib/custom-emoji/pack-import";
import { requestAccountImport } from "@/lib/custom-emoji/account-import";
import type { EmojiActionState } from "@/lib/custom-emoji/library";

const PAGE = "/messages/emojis";
const ADMIN_ONLY =
  "Seul un administrateur peut retirer un emoji animé de la bibliothèque (ou l'y remettre).";

/** Coller le lien d'un pack (D2) : tous ses emojis dans la bibliothèque. Administrateurs et responsables. */
export async function importPackAction(
  _prev: EmojiActionState,
  formData: FormData,
): Promise<EmojiActionState> {
  const user = await requireUser();
  const link = String(formData.get("link") ?? "")
    .trim()
    .slice(0, 300);
  if (!link) return { error: "Collez le lien du pack (il commence par https://t.me/addemoji/)." };
  const res = await importEmojiPack(link, { userId: user.id });
  if (!res.ok) return { error: res.error };
  revalidatePath(PAGE);
  return { ok: res.message };
}

/** Importer les packs installés sur le compte Telegram connecté (D3). Administrateurs et responsables. */
export async function requestAccountImportAction(
  _prev: EmojiActionState,
  _formData: FormData,
): Promise<EmojiActionState> {
  void _formData;
  const user = await requireUser();
  const res = await requestAccountImport(user.id);
  if (!res.ok) return { error: res.error };
  revalidatePath(PAGE);
  return { ok: res.message };
}

/** Nouvel essai de récupération des aperçus manquants (tâche du service d'arrière-plan). */
export async function retryPreviewsAction(
  _prev: EmojiActionState,
  _formData: FormData,
): Promise<EmojiActionState> {
  void _formData;
  await requireUser();
  const missing = await prisma.customEmoji.findMany({
    where: { hiddenAt: null, previewMime: null },
    select: { customEmojiId: true },
    take: 1000,
  });
  if (missing.length === 0) return { ok: "Tous les aperçus sont déjà là." };
  try {
    await enqueue(
      "custom-emoji",
      { type: "fetch-previews", customEmojiIds: missing.map((m) => m.customEmojiId) },
      { jobId: `custom-emoji:previews:manual:${Math.floor(Date.now() / 60_000)}` },
    );
  } catch {
    return { error: "Le service d'arrière-plan ne répond pas : réessayez dans une minute." };
  }
  return { ok: "C'est demandé : les aperçus arrivent d'ici une minute." };
}

/**
 * Retirer un emoji de la bibliothèque (il n'est plus proposé dans le sélecteur ; les messages qui l'utilisent gardent
 * leur emoji animé) ou l'y remettre. Administrateurs seulement (règle « responsable : tout sauf suppressions »).
 */
async function setHidden(customEmojiId: string, hidden: boolean): Promise<EmojiActionState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: ADMIN_ONLY };
  if (!isValidCustomEmojiId(customEmojiId)) return { error: "Emoji animé introuvable." };
  const row = await prisma.customEmoji.findUnique({
    where: { customEmojiId },
    select: { id: true, fallback: true, setName: true, hiddenAt: true },
  });
  if (!row) return { error: "Emoji animé introuvable." };
  if (Boolean(row.hiddenAt) !== hidden)
    await prisma.customEmoji.update({
      where: { id: row.id },
      data: { hiddenAt: hidden ? new Date() : null },
    });
  await audit({
    userId: user.id,
    action: hidden ? "custom_emoji.hidden" : "custom_emoji.restored",
    entityType: "CustomEmoji",
    entityId: row.id,
    metadata: { customEmojiId, fallback: row.fallback, setName: row.setName },
  });
  revalidatePath(PAGE);
  return {
    ok: hidden
      ? `Emoji ${row.fallback} retiré de la bibliothèque. Les messages qui l'utilisent le gardent.`
      : `Emoji ${row.fallback} remis dans la bibliothèque.`,
  };
}

export async function hideEmojiAction(customEmojiId: string): Promise<EmojiActionState> {
  return setHidden(customEmojiId, true);
}

export async function restoreEmojiAction(customEmojiId: string): Promise<EmojiActionState> {
  return setHidden(customEmojiId, false);
}
