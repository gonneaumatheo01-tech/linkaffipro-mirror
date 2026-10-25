"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { channelsReturnPath, withFlash } from "@/lib/channels/return-to";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import {
  channelAdd,
  channelUpdate,
  channelsImportFromAccount,
  channelsRecheckAll,
} from "@/lib/site-ops/ops/lot-b/channel-settings";

/**
 * Page Canaux : réglages d'un canal, ajout par lien public, import depuis le compte, re-vérification des droits. La
 * logique est dans les cœurs partagés avec Kevin (`lib/site-ops/ops/lot-b/channel-settings.ts`, phase 34).
 */

/**
 * Réglages d'un canal (univers, langue, bot principal, test, médiathèque, actif), depuis le volet de la liste ou de la
 * fiche. `returnTo` (facultatif) : la liste ou la fiche du canal (`channelsReturnPath`), la liste sinon.
 */
export async function updateChannelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const returnTo = channelsReturnPath(formData.get("returnTo"));
  const r = await channelUpdate(
    {
      channelId: formData.get("channelId"),
      vertical: formData.get("vertical") ?? "",
      language: formData.get("language") ?? "fr",
      primaryBotId: formData.get("primaryBotId") ?? "",
      isTest: formData.get("isTest") === "on",
      isMediaLibrary: formData.get("isMediaLibrary") === "on",
      isActive: formData.get("isActive") === "on",
    },
    webActorOf(user),
  );
  // Canal disparu entre-temps : même erreur qu'avant (écriture refusée par la base).
  if (!r.ok && r.code === "not_found" && !r.field) throw new Error(r.error);
  if (!r.ok) redirect(withFlash(returnTo, { error: r.error }));
  const channelId = String(r.data?.channelId ?? "");
  revalidatePath("/channels");
  revalidatePath(`/channels/${channelId}`);
  redirect(withFlash(returnTo, { ok: r.message }));
}

function backToChannels(params: { ok?: string; error?: string }): never {
  const qs = new URLSearchParams();
  if (params.ok) qs.set("ok", params.ok);
  if (params.error) qs.set("error", params.error);
  redirect(`/channels?${qs.toString()}`);
}

/**
 * Résultat affiché dans la fenêtre « Ajouter un canal existant » (méthode 2), sans quitter la fenêtre.
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
  const r = await channelAdd({ link: String(formData.get("link") ?? "") }, webActorOf(user));
  if (!r.ok) return { error: r.error, at: Date.now() };
  revalidatePath("/channels");
  return { ok: r.message, at: Date.now(), channelId: String(r.data?.channelId ?? "") };
}

/** Re-vérifie les droits de nos bots sur tous les canaux actifs (page Canaux). */
export async function recheckAllRightsAction(): Promise<void> {
  const user = await requireUser();
  const r = await channelsRecheckAll({}, webActorOf(user));
  if (!r.ok) backToChannels({ error: r.error });
  revalidatePath("/channels");
  backToChannels({ ok: r.message });
}

/**
 * « Importer tous mes canaux » : canaux cochés (identifiants Telegram) → création + droits, un audit par canal,
 * 5 canaux à la fois. Retour résumé (« 12 canaux importés, 3 sans bot ») pour garder une adresse courte.
 */
export async function importChannelsFromAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ids = [...new Set(formData.getAll("ids").map(String))];
  if (ids.length === 0)
    redirect(
      `/channels/import?error=${encodeURIComponent("Cochez au moins un canal à importer.")}`,
    );
  const r = await channelsImportFromAccount(
    {
      channels: ids.map((id) => ({
        telegramChatId: id,
        title: formData.get(`title_${id}`) ?? "",
        username: (formData.get(`username_${id}`) as string | null) || null,
        isBroadcast: formData.get(`broadcast_${id}`) !== "0",
      })),
    },
    webActorOf(user),
  );
  revalidatePath("/channels");
  if (!r.ok) backToChannels({ error: r.error });
  backToChannels({ ok: r.message, error: r.data?.error ? String(r.data.error) : undefined });
}
