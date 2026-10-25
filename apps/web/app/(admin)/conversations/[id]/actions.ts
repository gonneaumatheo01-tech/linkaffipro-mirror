"use server";

import { redirect } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import type { TeamActor } from "@/lib/site-ops/ops/lot-c/conversations";
import {
  block,
  close,
  markHandled,
  release,
  sendTeam,
  takeOver,
} from "@/lib/site-ops/ops/lot-c/conversations";

/**
 * Actions de l'équipe sur une conversation de l'assistant (fiche /conversations/[id]) : prendre la main, la rendre,
 * fermer, bloquer, écrire, marquer comme traitée (phase 25). Ouvertes aux administrateurs et aux managers (`requireUser`,
 * vérifié côté serveur) ; chaque action est journalisée (`conversation.*`) par `lib/conversations/operations.ts`,
 * appelé par les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/conversations.ts`, aussi utilisés par Kevin).
 */
function teamActor(user: CurrentUser): TeamActor {
  return { ...webActorOf(user), name: user.name };
}

async function run(formData: FormData, core: Core): Promise<void> {
  const user = await requireUser();
  const r = await core(
    { id: String(formData.get("id") ?? "") },
    teamActor(user),
  );
  redirect(r.back ? backUrl(r.back) : "/conversations");
}

/** « Prendre la main » : l'assistante se tait pour cette conversation. */
export async function takeOverAction(formData: FormData): Promise<void> {
  await run(formData, takeOver);
}

/** « Rendre à l'assistante » : elle répond de nouveau (pas aux messages reçus pendant la reprise). */
export async function releaseAction(formData: FormData): Promise<void> {
  await run(formData, release);
}

/** « Fermer » : conversation terminée, ni réponse ni relance (rouvrable par l'équipe). */
export async function closeAction(formData: FormData): Promise<void> {
  await run(formData, close);
}

/** « Bloquer » : plus aucun message ne part vers cette personne. */
export async function blockAction(formData: FormData): Promise<void> {
  await run(formData, block);
}

/** « Marquer comme traitée » : la conversation n'est plus « à traiter » (rien d'autre ne change). */
export async function clearNeedsHumanAction(formData: FormData): Promise<void> {
  await run(formData, markHandled);
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
  const r = await sendTeam(
    { ...formInput(formData), id: String(formData.get("id") ?? "") },
    teamActor(user),
  );
  if (!r.ok) return { status: "error", error: r.error, at: Date.now() };
  return {
    status: "sent",
    message: r.message,
    tookOver: Boolean(r.data?.tookOver),
    at: Date.now(),
  };
}
