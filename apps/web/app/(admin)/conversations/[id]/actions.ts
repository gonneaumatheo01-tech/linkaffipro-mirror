"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  blockConversation,
  clearNeedsHuman,
  closeConversation,
  releaseConversation,
  sendTeamMessage,
  takeOverConversation,
  type OperationResult,
} from "@/lib/conversations/operations";
import { requireUser } from "@/lib/session";

/**
 * Actions de l'équipe sur une conversation de l'assistant (fiche /conversations/[id]) : prendre la main, la rendre,
 * fermer, bloquer, écrire, marquer comme traitée (phase 25). Ouvertes aux administrateurs et aux managers (`requireUser`, vérifié côté serveur) ; chaque
 * action est journalisée (`conversation.*`) par `lib/conversations/operations.ts`.
 */

const ID_RE = /^[a-z0-9]{8,40}$/;

function idOf(formData: FormData): string | null {
  const id = String(formData.get("id") ?? "");
  return ID_RE.test(id) ? id : null;
}

function back(id: string | null, result: OperationResult): never {
  const path = id ? `/conversations/${id}` : "/conversations";
  const params = new URLSearchParams(result.ok ? { ok: result.message } : { error: result.error });
  redirect(`${path}?${params.toString()}`);
}

async function run(
  formData: FormData,
  op: (id: string, user: { id: string; name: string }) => Promise<OperationResult>,
): Promise<void> {
  const user = await requireUser();
  const id = idOf(formData);
  if (!id) back(null, { ok: false, error: "Conversation introuvable." });
  const result = await op(id, { id: user.id, name: user.name });
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  back(id, result);
}

/** « Prendre la main » : l'assistante se tait pour cette conversation. */
export async function takeOverAction(formData: FormData): Promise<void> {
  await run(formData, (id, user) => takeOverConversation(id, user));
}

/** « Rendre à l'assistante » : elle répond de nouveau (pas aux messages reçus pendant la reprise). */
export async function releaseAction(formData: FormData): Promise<void> {
  await run(formData, (id, user) => releaseConversation(id, user));
}

/** « Fermer » : conversation terminée, ni réponse ni relance (rouvrable par l'équipe). */
export async function closeAction(formData: FormData): Promise<void> {
  await run(formData, (id, user) => closeConversation(id, user));
}

/** « Bloquer » : plus aucun message ne part vers cette personne. */
export async function blockAction(formData: FormData): Promise<void> {
  await run(formData, (id, user) => blockConversation(id, user));
}

/** « Marquer comme traitée » : la conversation n'est plus « à traiter » (rien d'autre ne change). */
export async function clearNeedsHumanAction(formData: FormData): Promise<void> {
  await run(formData, (id, user) => clearNeedsHuman(id, user));
}

/** Retour de « Envoyer » (formulaire du fil, `useActionState`). */
export type TeamReplyState =
  | { status: "idle" }
  | { status: "sent"; message: string; tookOver: boolean; at: number }
  | { status: "error"; error: string; at: number };

/** « Envoyer » : message écrit par l'équipe (prend la main si l'assistante l'avait). */
export async function sendTeamMessageAction(
  _prev: TeamReplyState,
  formData: FormData,
): Promise<TeamReplyState> {
  const user = await requireUser();
  const id = idOf(formData);
  if (!id) return { status: "error", error: "Conversation introuvable.", at: Date.now() };
  const result = await sendTeamMessage(id, { id: user.id, name: user.name }, formData.get("text"));
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  if (!result.ok) return { status: "error", error: result.error, at: Date.now() };
  return {
    status: "sent",
    message: result.message,
    tookOver: Boolean(result.tookOver),
    at: Date.now(),
  };
}
