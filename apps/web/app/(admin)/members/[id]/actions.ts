"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, requireAdmin, requireUser, type CurrentUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import {
  addNote,
  anonymizeMember,
  changeAffiliate,
  deleteNote,
  editNote,
  removeAffiliate,
  setMemberTags,
} from "@/lib/site-ops/ops/lot-c/members";

/**
 * Fiche membre. Toute la règle est dans les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/members.ts`), appelés aussi
 * par Kevin : mêmes validations, mêmes messages, même journal.
 */
async function run(
  formData: FormData,
  core: Core,
  user: CurrentUser,
  admin = false,
): Promise<never> {
  // `admin` : la session a déjà passé `requireAdmin`.
  const actor = admin ? { ...webActorOf(user), role: "ADMIN" as const } : webActorOf(user);
  const r = await core(formInput(formData), actor);
  redirect(r.back ? backUrl(r.back) : "/members");
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("memberId"));
  await run(formData, addNote, user);
}

/** Modifier une note : son auteur, ou un administrateur. */
export async function editNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("noteId"));
  await run(formData, editNote, user);
}

/**
 * Étiquettes d'un membre : les cases cochées parmi le registre (Réglages → Étiquettes) remplacent
 * celles du registre ; les étiquettes hors registre (posées par une automatisation) sont conservées.
 */
export async function setMemberTagsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("memberId"));
  // Aucune case cochée : le formulaire n'envoie pas `tags` ; liste vide = toutes les étiquettes du registre retirées.
  if (!formData.has("tags")) formData.set("tags", "");
  await run(formData, setMemberTags, user);
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("noteId"));
  await run(formData, deleteNote, user);
}

/**
 * Suppression d'un membre sur demande (RGPD) = anonymisation : identité effacée, historique conservé sans donnée
 * personnelle (détail dans le cœur). ADMIN seulement, mot SUPPRIMER exigé.
 */
export async function anonymizeMemberAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  z.string().min(1).parse(formData.get("memberId"));
  await run(formData, anonymizeMember, admin, true);
}

/** Administrateur, sinon retour sur la fiche avec un message (un responsable lit l'affilié sans le changer). */
async function adminOrBack(memberId: string): Promise<CurrentUser> {
  try {
    return await requireAdmin();
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
    redirect(`/members/${memberId}?${new URLSearchParams({ error: "Réservé aux administrateurs." })}`);
  }
}

/**
 * « Changer d'affilié » (phase 13, ADMIN) : rattache le membre à une campagne Telegram d'affilié existante, avec un
 * motif (journal `member.affiliate_changed`).
 */
export async function changeMemberAffiliateAction(formData: FormData): Promise<void> {
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const admin = await adminOrBack(memberId);
  if (!formData.has("inviteLinkId")) formData.set("inviteLinkId", "");
  await run(formData, changeAffiliate, admin, true);
}

/** « Retirer l'affilié » (phase 13, ADMIN) : plus aucun affilié, avec un motif (journal `member.affiliate_removed`). */
export async function removeMemberAffiliateAction(formData: FormData): Promise<void> {
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const admin = await adminOrBack(memberId);
  await run(formData, removeAffiliate, admin, true);
}
