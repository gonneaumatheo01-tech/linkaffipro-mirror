"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireUser, type CurrentUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import {
  cancelBroadcast,
  createAndTest,
  createBroadcast,
  deleteDraft,
  schedule,
  sendNow,
  sendWinnerToRest,
  testToMe,
} from "@/lib/site-ops/ops/lot-c/broadcasts";

/**
 * « Écrire à un groupe ». Toute la règle est dans les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/broadcasts.ts`),
 * appelés aussi par Kevin : mêmes vérifications (texte, date, bot, boutons), mêmes messages, même journal.
 */
async function run(formData: FormData, core: Core, user: CurrentUser, admin = false): Promise<never> {
  const actor = admin ? { ...webActorOf(user), role: "ADMIN" as const } : webActorOf(user);
  const r = await core(formInput(formData), actor);
  redirect(r.back ? backUrl(r.back) : "/members/broadcasts");
}

export async function createBroadcastAction(formData: FormData): Promise<void> {
  await run(formData, createBroadcast, await requireUser());
}

/**
 * « Envoyer un test à moi » depuis l'assistant : enregistre d'abord l'envoi en brouillon (mêmes vérifications que
 * `createBroadcastAction`), puis l'envoie en test sur le Telegram de l'utilisateur (les deux versions d'un test A/B).
 * Rien ne part vers les membres. Si le test ne peut pas partir, le brouillon reste enregistré et la raison s'affiche.
 */
export async function createAndTestAction(formData: FormData): Promise<void> {
  await run(formData, createAndTest, await requireUser());
}

/**
 * Envoie la variante gagnante d'un test A/B aux membres du groupe pas encore servis :
 * nouvel envoi du même groupe avec `abVariant = REST`, que le worker développe en excluant
 * tous les destinataires déjà touchés par le test.
 */
export async function sendWinnerToRestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("groupId"));
  await run(formData, sendWinnerToRest, user);
}

export async function sendNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("broadcastId"));
  await run(formData, sendNow, user);
}

export async function scheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("broadcastId"));
  await run(formData, schedule, user);
}

export async function cancelBroadcastAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("broadcastId"));
  await run(formData, cancelBroadcast, user);
}

export async function testToMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("broadcastId"));
  await run(formData, testToMe, user);
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  z.string().min(1).parse(formData.get("broadcastId"));
  await run(formData, deleteDraft, user, true);
}
