"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import {
  ShareLinkError,
  createShareLink,
  disableShareLink,
  disabledMessage,
  parseShareName,
  type CreatedShareLink,
} from "@/lib/channels/share-links";

/**
 * Actions de la section « Liens de partage » de la fiche canal (phase 11). Administrateurs et responsables : créer et
 * désactiver un lien de partage (aucune suppression ici). Les refus reviennent en français dans l'écran.
 */

export type ShareLinkFormResult = { error?: string; created?: CreatedShareLink } | null;
export type ShareLinkActionResult = { ok?: string; error?: string };

const createSchema = z.object({
  channelId: z.string().min(1),
  sourceChannelId: z.string().optional(),
});

/** « Créer le lien » (volet « Nouveau lien de partage »), avec `useActionState`. */
export async function createShareLinkAction(
  _prev: ShareLinkFormResult,
  formData: FormData,
): Promise<ShareLinkFormResult> {
  const user = await requireUser();
  const parsed = createSchema.safeParse({
    channelId: formData.get("channelId") ?? "",
    sourceChannelId: String(formData.get("sourceChannelId") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Canal introuvable : rechargez la page." };
  const name = parseShareName(formData.get("name"));
  if ("error" in name) return { error: name.error };
  try {
    const created = await createShareLink({
      channelId: parsed.data.channelId,
      name: name.name,
      sourceChannelId: parsed.data.sourceChannelId ?? null,
      userId: user.id,
    });
    revalidatePath(`/channels/${parsed.data.channelId}`);
    return { created };
  } catch (err) {
    if (err instanceof ShareLinkError) return { error: err.message };
    throw err;
  }
}

const disableSchema = z.object({ channelId: z.string().min(1), linkId: z.string().min(1) });

/** « Désactiver » un lien de partage (après confirmation) : il ne fonctionne plus dans Telegram. */
export async function disableShareLinkAction(formData: FormData): Promise<ShareLinkActionResult> {
  const user = await requireUser();
  const parsed = disableSchema.safeParse({
    channelId: formData.get("channelId") ?? "",
    linkId: formData.get("linkId") ?? "",
  });
  if (!parsed.success) return { error: "Lien introuvable : rechargez la page." };
  try {
    const r = await disableShareLink({ ...parsed.data, userId: user.id });
    const channel = await prisma.channel.findUnique({
      where: { id: parsed.data.channelId },
      select: { title: true },
    });
    revalidatePath(`/channels/${parsed.data.channelId}`);
    const message = disabledMessage(r, channel?.title ?? "ce canal");
    return r.revokedOnTelegram ? { ok: message } : { error: message };
  } catch (err) {
    if (err instanceof ShareLinkError) return { error: err.message };
    throw err;
  }
}
