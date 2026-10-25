"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MtprotoPublishStatus } from "@linkaffipro/core";
import type { SiteOpResult } from "@linkaffipro/agents";
import { requireAdmin, requireUser } from "@/lib/session";
import { postFormRaw } from "@/lib/posts/schema";
import { loadPublishStatus } from "@/lib/posts/account-publish";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import {
  accountPublishCheck,
  postCancel,
  postCreate,
  postDeleteOnTelegram,
  postDiscard,
  postSaveAsTemplate,
  postShift,
  postUpdate,
  textOfferLinkCreate,
} from "@/lib/site-ops/ops/lot-b/posts";

/**
 * Messages de canal. La logique (validations, boutons, emojis animés, programmation, journal) est dans les cœurs
 * partagés avec Kevin (`lib/site-ops/ops/lot-b/posts.ts`, phase 34) ; ici : formulaire, retour, rafraîchi.
 */

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

/** Message disparu : même erreur qu'avant (lecture `findUniqueOrThrow`). */
function throwIfMissing(r: SiteOpResult): void {
  if (!r.ok && r.code === "not_found") throw new Error(r.error);
}

/** Retour d'une création / modification réussie : adresse et message choisis par le cœur. */
function backTo(r: Extract<SiteOpResult, { ok: true }>): never {
  const flash = (r.data?.flash ?? { ok: r.message }) as Record<string, string>;
  back(String(r.data?.path ?? "/messages"), flash);
}

/**
 * Création : un Post par canal (liés par duplicatedFromId), brouillon, programmé ou modèle. Test A/B : deux Post par
 * canal. Emojis animés : publié par le compte connecté, sans boutons. Programmer alors que le compte ne peut pas
 * publier : gardés en brouillon (rien n'est perdu), le refus est expliqué.
 */
export async function createPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await postCreate(postFormRaw(formData), webActorOf(user));
  if (!r.ok) {
    if (r.field === "_form") back("/messages/new", { error: r.error });
    // Copie d'un message ou d'un modèle : on revient sur la copie (contenu rechargé) plutôt qu'un formulaire vide.
    const from = String(formData.get("duplicatedFromId") ?? "");
    back("/messages/new", { ...(from ? { from } : {}), error: r.error });
  }
  revalidatePath("/messages");
  backTo(r);
}

/** Mise à jour d'un brouillon / message programmé (un seul canal). */
export async function updatePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postUpdate({ ...postFormRaw(formData), postId }, webActorOf(user));
  if (!r.ok) back(`/messages/${postId}/edit`, { error: r.error });
  revalidatePath("/messages");
  backTo(r);
}

export async function cancelPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postCancel({ postId }, webActorOf(user));
  throwIfMissing(r);
  if (!r.ok) back(`/messages/${postId}`, { error: r.error });
  revalidatePath("/messages");
  back(`/messages/${postId}`, { ok: r.message });
}

/** Décale un message programmé de N minutes (positif ou négatif). */
export async function shiftPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postShift({ postId, minutes: Number(formData.get("minutes") ?? 0) }, webActorOf(user));
  throwIfMissing(r);
  if (!r.ok) back(`/messages/${postId}`, { error: r.error });
  revalidatePath("/messages");
  back(`/messages/${postId}`, { ok: r.message });
}

/** Supprime le message sur Telegram (via la file) et le marque supprimé. */
export async function deleteOnTelegramAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postDeleteOnTelegram({ postId }, webActorOf(user));
  throwIfMissing(r);
  if (!r.ok) back(`/messages/${postId}`, { error: r.error });
  back(`/messages/${postId}`, { ok: r.message });
}

/** Supprime un brouillon / modèle / message annulé de la plateforme (administrateurs). */
export async function discardPostAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postDiscard({ postId }, webActorOf(user));
  throwIfMissing(r);
  if (!r.ok) back(`/messages/${postId}`, { error: r.error });
  revalidatePath("/messages");
  back("/messages", { ok: r.message });
}

/** Enregistre un message existant comme modèle. */
export async function saveAsTemplateAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = z.string().min(1).parse(formData.get("postId"));
  const r = await postSaveAsTemplate(
    { postId, templateName: String(formData.get("templateName") ?? "") },
    webActorOf(user),
  );
  throwIfMissing(r);
  if (!r.ok) back(`/messages/${postId}`, { error: r.error });
  back(`/messages/${postId}`, { ok: r.message });
}

/**
 * « Ajouter l'offre comme lien dans le texte » (message publié par le compte Telegram connecté, sans boutons) : crée le
 * lien traqué de l'offre de la campagne et renvoie le lien à ajouter au texte. Renvoie un résultat, jamais de
 * redirection (le texte reste à l'écran).
 */
export async function createTextOfferLinkAction(input: {
  campaignId?: string;
  affiliateCampaignId?: string;
  label: string;
}): Promise<{ ok: true; html: string; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await textOfferLinkCreate(
    {
      campaignId: input?.campaignId ?? "",
      affiliateCampaignId: input?.affiliateCampaignId ?? "",
      label: String(input?.label ?? ""),
    },
    webActorOf(user),
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, html: String(r.data?.html ?? ""), url: String(r.data?.url ?? "") };
}

/**
 * « Vérifier » : demande au service d'arrière-plan de relever si le compte Telegram connecté peut publier dans ces
 * canaux. Le formulaire attend ensuite le relevé (`accountPublishStatusAction`), sans recharger la page.
 */
export async function checkAccountPublishAction(
  channelIds: string[],
): Promise<{ ok: true; requestedAt: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await accountPublishCheck({ channelIds: Array.isArray(channelIds) ? channelIds : [] }, webActorOf(user));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, requestedAt: String(r.data?.requestedAt ?? "") };
}

/** Dernier relevé de l'état du compte Telegram connecté (null s'il n'y en a jamais eu). */
export async function accountPublishStatusAction(): Promise<MtprotoPublishStatus | null> {
  await requireUser();
  return loadPublishStatus();
}
