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

import {
  importChannelByChatId,
  importChannelByUsername,
  importedChannelMessage,
  listActiveBots,
  mapWithLimit,
  recheckAllChannelRights,
} from "@linkaffipro/telegram";
import { importOutcomeOf, importSummary, rightsSummary } from "@/lib/channels/rights-message";

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

function backToChannels(params: { ok?: string; error?: string }): never {
  const qs = new URLSearchParams();
  if (params.ok) qs.set("ok", params.ok);
  if (params.error) qs.set("error", params.error);
  redirect(`/channels?${qs.toString()}`);
}

/**
 * Résultat affiché dans la fenêtre « Ajouter un canal existant » (méthode 2), sans quitter la fenêtre.
 * `channelId` : canal ajouté (la surveillance de la fenêtre ne l'annonce pas une seconde fois).
 */
export type AddChannelByLinkState = {
  ok?: string;
  error?: string;
  at?: number;
  channelId?: string;
};

/**
 * Méthode 2 : coller le lien public (`t.me/<nom>`, `t.me/s/<nom>`, `@nom` ou `nom`). Utilisée avec `useActionState` :
 * le résultat revient dans la fenêtre (pas de redirection), la liste est revalidée.
 */
export async function addChannelByLinkAction(
  _prev: AddChannelByLinkState,
  formData: FormData,
): Promise<AddChannelByLinkState> {
  const user = await requireUser();
  const input = String(formData.get("link") ?? "").trim();
  if (!input)
    return {
      error: "Collez le lien public du canal (t.me/mon_canal) ou son @nom.",
      at: Date.now(),
    };
  try {
    const r = await importChannelByUsername(input, { userId: user.id });
    revalidatePath("/channels");
    return { ok: importedChannelMessage(r), at: Date.now(), channelId: r.channelId };
  } catch (err) {
    if (isRedirect(err)) throw err;
    return { error: err instanceof Error ? err.message : "Ajout impossible.", at: Date.now() };
  }
}

/** Re-vérifie les droits de nos bots sur tous les canaux actifs (page Canaux). */
export async function recheckAllRightsAction(): Promise<void> {
  const user = await requireUser();
  let message = "";
  try {
    message = rightsSummary(await recheckAllChannelRights({ userId: user.id }));
  } catch (err) {
    if (isRedirect(err)) throw err;
    backToChannels({
      error: `Vérification impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`,
    });
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

/**
 * « Importer tous mes canaux » : canaux cochés (identifiants Telegram) → création + droits, un audit par canal,
 * 5 canaux à la fois. Retour résumé (« 12 canaux importés, 3 sans bot ») pour garder une adresse courte.
 */
export async function importChannelsFromAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ids = [...new Set(formData.getAll("ids").map(String))];
  if (ids.length === 0)
    redirect(
      `/channels/import?error=${encodeURIComponent("Cochez au moins un canal à importer.")}`,
    );
  const bots = await listActiveBots();
  const outcomes = await mapWithLimit(ids, 5, async (id) => {
    const parsed = accountRowSchema.safeParse({
      telegramChatId: id,
      title: formData.get(`title_${id}`) ?? "",
      username: (formData.get(`username_${id}`) as string | null) || null,
      isBroadcast: formData.get(`broadcast_${id}`) !== "0",
    });
    if (!parsed.success) return { title: `canal ${id}`, error: "informations incomplètes" };
    try {
      const r = await importChannelByChatId(
        { ...parsed.data, telegramChatId: BigInt(parsed.data.telegramChatId) },
        { userId: user.id, bots },
      );
      return importOutcomeOf(r);
    } catch (err) {
      if (isRedirect(err)) throw err;
      return {
        title: parsed.data.title,
        error: err instanceof Error ? err.message : "erreur inconnue",
      };
    }
  });
  revalidatePath("/channels");
  const { ok, error } = importSummary(outcomes);
  backToChannels({ ok, error });
}
