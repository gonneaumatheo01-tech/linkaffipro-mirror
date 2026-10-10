"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

const schema = z.object({
  channelId: z.string().min(1),
  vertical: z.enum(["", "CASINO", "SPORTS", "DATING"]),
  language: z.string().trim().min(2).max(5).toLowerCase(),
  primaryBotId: z.string(),
  isTest: z.boolean(),
  isMediaLibrary: z.boolean(),
  isActive: z.boolean(),
});

export async function updateChannelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    channelId: formData.get("channelId"),
    vertical: formData.get("vertical") ?? "",
    language: formData.get("language") ?? "fr",
    primaryBotId: formData.get("primaryBotId") ?? "",
    isTest: formData.get("isTest") === "on",
    isMediaLibrary: formData.get("isMediaLibrary") === "on",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success)
    redirect(
      `/channels?error=${encodeURIComponent("Vérifiez les réglages du canal : la langue doit être un code de 2 à 5 lettres (fr, en, pt-br…).")}`,
    );
  const d = parsed.data;
  await prisma.channel.update({
    where: { id: d.channelId },
    data: {
      vertical: d.vertical === "" ? null : d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId === "" ? null : d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
    },
  });
  await audit({
    userId: user.id,
    action: "channel.updated",
    entityType: "Channel",
    entityId: d.channelId,
    metadata: {
      vertical: d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
    },
  });
  revalidatePath("/channels");
  redirect(`/channels?ok=${encodeURIComponent("Réglages du canal enregistrés.")}`);
}

// ============================================================
// Canaux existants : ajout par lien public, import depuis le compte, re-vérification des droits
// ============================================================

import { importChannelByChatId, importChannelByUsername, importedChannelMessage, recheckAllChannelRights } from "@linkaffipro/telegram";
import { canaux, rightsSummary } from "@/lib/channels/rights-message";

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

function backToChannels(params: { ok?: string; error?: string }): never {
  const qs = new URLSearchParams();
  if (params.ok) qs.set("ok", params.ok);
  if (params.error) qs.set("error", params.error);
  redirect(`/channels?${qs.toString()}`);
}

/** Méthode 2 : coller le lien public (`t.me/<nom>`, `https://t.me/<nom>`, `@nom` ou `nom`). */
export async function addChannelByLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = String(formData.get("link") ?? "");
  let message = "";
  try {
    const r = await importChannelByUsername(input, { userId: user.id });
    message = importedChannelMessage(r);
  } catch (err) {
    if (isRedirect(err)) throw err;
    backToChannels({ error: err instanceof Error ? err.message : "Ajout impossible." });
  }
  revalidatePath("/channels");
  backToChannels({ ok: message });
}

/** Re-vérifie les droits de nos bots sur tous les canaux actifs (page Canaux). */
export async function recheckAllRightsAction(): Promise<void> {
  const user = await requireUser();
  let message = "";
  try {
    message = rightsSummary(await recheckAllChannelRights({ userId: user.id }));
  } catch (err) {
    if (isRedirect(err)) throw err;
    backToChannels({ error: `Vérification impossible : ${err instanceof Error ? err.message : "erreur inconnue"}` });
  }
  revalidatePath("/channels");
  backToChannels({ ok: message });
}

const accountRowSchema = z.object({
  telegramChatId: z.string().regex(/^-?\d{5,20}$/),
  title: z.string().trim().min(1).max(255),
  username: z.string().trim().max(64).nullable(),
  isBroadcast: z.boolean(),
});

/** « Importer tous mes canaux » : canaux cochés (identifiants Telegram) → création + droits, un audit par canal. */
export async function importChannelsFromAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ids = formData.getAll("ids").map(String);
  if (ids.length === 0) redirect(`/channels/import?error=${encodeURIComponent("Cochez au moins un canal à importer.")}`);
  const results: string[] = [];
  const errors: string[] = [];
  for (const id of ids) {
    const parsed = accountRowSchema.safeParse({
      telegramChatId: id,
      title: formData.get(`title_${id}`) ?? "",
      username: (formData.get(`username_${id}`) as string | null) || null,
      isBroadcast: formData.get(`broadcast_${id}`) !== "0",
    });
    if (!parsed.success) {
      errors.push(`canal ${id} : informations incomplètes`);
      continue;
    }
    try {
      const r = await importChannelByChatId({ ...parsed.data, telegramChatId: BigInt(parsed.data.telegramChatId) }, { userId: user.id });
      results.push(importedChannelMessage(r));
    } catch (err) {
      if (isRedirect(err)) throw err;
      errors.push(`« ${parsed.data.title} » : ${err instanceof Error ? err.message : "erreur inconnue"}`);
    }
  }
  revalidatePath("/channels");
  const qs = new URLSearchParams();
  if (results.length > 0) qs.set("ok", `${canaux(results.length)} importé${results.length > 1 ? "s" : ""} : ${results.join(" · ")}`);
  if (errors.length > 0) qs.set("error", `Non importé : ${errors.join(" · ")}`);
  redirect(`/channels?${qs.toString()}`);
}
