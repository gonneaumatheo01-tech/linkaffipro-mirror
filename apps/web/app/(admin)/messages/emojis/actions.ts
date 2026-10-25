"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import type { EmojiActionState } from "@/lib/custom-emoji/library";
import type { SiteOpResult } from "@linkaffipro/agents";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import {
  emojiHide,
  emojiImportAccount,
  emojiImportPack,
  emojiRestore,
  emojiRetryPreviews,
} from "@/lib/site-ops/ops/lot-b/emojis";

/**
 * Messages → Emojis animés (phase 12). La logique est dans les cœurs partagés avec Kevin
 * (`lib/site-ops/ops/lot-b/emojis.ts`, phase 34).
 */

const PAGE = "/messages/emojis";

function state(r: SiteOpResult): EmojiActionState {
  return r.ok ? { ok: r.message } : { error: r.error };
}

/** Coller le lien d'un pack (D2) : tous ses emojis dans la bibliothèque. Administrateurs et responsables. */
export async function importPackAction(
  _prev: EmojiActionState,
  formData: FormData,
): Promise<EmojiActionState> {
  const user = await requireUser();
  const r = await emojiImportPack({ link: String(formData.get("link") ?? "") }, webActorOf(user));
  if (r.ok) revalidatePath(PAGE);
  return state(r);
}

/** Importer les packs installés sur le compte Telegram connecté (D3). Administrateurs et responsables. */
export async function requestAccountImportAction(
  _prev: EmojiActionState,
  _formData: FormData,
): Promise<EmojiActionState> {
  void _formData;
  const user = await requireUser();
  const r = await emojiImportAccount({}, webActorOf(user));
  if (r.ok) revalidatePath(PAGE);
  return state(r);
}

/** Nouvel essai de récupération des aperçus manquants (tâche du service d'arrière-plan). */
export async function retryPreviewsAction(
  _prev: EmojiActionState,
  _formData: FormData,
): Promise<EmojiActionState> {
  void _formData;
  const user = await requireUser();
  return state(await emojiRetryPreviews({}, webActorOf(user)));
}

/**
 * Retirer un emoji de la bibliothèque (les messages qui l'utilisent le gardent) ou l'y remettre. Administrateurs
 * seulement (règle « responsable : tout sauf suppressions »).
 */
export async function hideEmojiAction(customEmojiId: string): Promise<EmojiActionState> {
  const user = await requireUser();
  const r = await emojiHide({ customEmojiId: String(customEmojiId ?? "") }, webActorOf(user));
  if (r.ok) revalidatePath(PAGE);
  return state(r);
}

export async function restoreEmojiAction(customEmojiId: string): Promise<EmojiActionState> {
  const user = await requireUser();
  const r = await emojiRestore({ customEmojiId: String(customEmojiId ?? "") }, webActorOf(user));
  if (r.ok) revalidatePath(PAGE);
  return state(r);
}
