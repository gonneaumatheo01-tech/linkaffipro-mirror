"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import type { CreatedShareLink } from "@/lib/channels/share-links";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { shareLinkCreate, shareLinkDisable } from "@/lib/site-ops/ops/lot-b/share-links";

/**
 * Actions de la section « Liens de partage » de la fiche canal (phase 11). Administrateurs et responsables : créer et
 * désactiver un lien de partage (aucune suppression ici). Les refus reviennent en français dans l'écran. La logique est
 * dans les cœurs partagés avec Kevin (`lib/site-ops/ops/lot-b/share-links.ts`, phase 34).
 */

export type ShareLinkFormResult = { error?: string; created?: CreatedShareLink } | null;
export type ShareLinkActionResult = { ok?: string; error?: string };

/** « Créer le lien » (volet « Nouveau lien de partage »), avec `useActionState`. */
export async function createShareLinkAction(
  _prev: ShareLinkFormResult,
  formData: FormData,
): Promise<ShareLinkFormResult> {
  const user = await requireUser();
  const r = await shareLinkCreate(
    {
      channelId: String(formData.get("channelId") ?? ""),
      sourceChannelId: String(formData.get("sourceChannelId") ?? "") || undefined,
      name: formData.get("name"),
    },
    webActorOf(user),
  );
  if (!r.ok) return { error: r.error };
  revalidatePath(`/channels/${String(r.data?.channelId ?? "")}`);
  return { created: r.data?.created as CreatedShareLink };
}

/** « Désactiver » un lien de partage (après confirmation) : il ne fonctionne plus dans Telegram. */
export async function disableShareLinkAction(formData: FormData): Promise<ShareLinkActionResult> {
  const user = await requireUser();
  const channelId = String(formData.get("channelId") ?? "");
  const r = await shareLinkDisable(
    { channelId, linkId: String(formData.get("linkId") ?? "") },
    webActorOf(user),
  );
  // Désactivé ici mais pas chez Telegram : la fiche est rafraîchie, le message est un avertissement.
  if (r.ok || r.field === "telegram") revalidatePath(`/channels/${channelId}`);
  return r.ok ? { ok: r.message } : { error: r.error };
}
