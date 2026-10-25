"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { botAdd, botResyncWebhook, botSetMode, botToggle } from "@/lib/site-ops/ops/lot-e/bots";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin, requireUser } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/bots.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/bots?${new URLSearchParams(params).toString()}`);
}

/**
 * Ajouter un bot en collant son jeton (ADMIN seulement : les jetons sont sensibles). Phase 26 : rôle « Boss
 * (administration) » → `registerBossFromToken` (même code que « jeton boss » par Telegram ; un seul Boss à la fois).
 */
export async function addBotAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const r = await botAdd(
    {
      token: String(formData.get("token") ?? ""),
      role: String(formData.get("role") ?? "CHANNEL"),
      vertical: String(formData.get("vertical") ?? ""),
    },
    webActor(user),
  );
  if (r.ok) revalidatePath("/settings/bots");
  back(backParams(r));
}

/** Reposer la connexion Telegram (webhook) du bot (ADMIN et MANAGER). */
export async function resyncWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const botId = z.string().min(1).parse(formData.get("botId"));
  const r = await botResyncWebhook({ botId }, webActor(user));
  if (r.ok) revalidatePath("/settings/bots");
  back(backParams(r));
}

/** Activer / désactiver un bot (ADMIN). */
export async function toggleBotAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const botId = z.string().min(1).parse(formData.get("botId"));
  const r = await botToggle({ botId }, webActor(user));
  // Bot absent : erreur levée comme avant (`findUniqueOrThrow`).
  if (!r.ok && r.code === "not_found") throw new Error(r.error);
  revalidatePath("/settings/bots");
  back(backParams(r));
}

/**
 * Mode du bot (phase 17, ADMIN) : bot normal, ou assistant de conversation avec sa persona liée. L'instance du bot est
 * recréée (handlers du nouveau mode) et son profil Telegram reposé (description qui dit « assistant(e) », commandes
 * /start, /stop, /reset ; remis à vide pour un bot normal). Un bot normal n'a pas de persona liée.
 * Passage en assistant : refusé pour un bot normal qui administre au moins un canal (`ChannelBotAdmin` non retiré) :
 * l'assistante a toujours un bot à elle, créé exprès dans @BotFather (`assistantModeRefusal`, même règle que le
 * formulaire). Sinon il ne publie plus rien dans les canaux : il cesse d'être bot principal d'un canal qu'il
 * n'administre plus (remplacé par un bot normal administrateur du canal) et ses messages pas encore publiés
 * (brouillons, programmés, annulés, échoués) passent à ce bot ; refusé tant qu'un brouillon ou un message programmé n'a
 * aucun autre bot pour le publier.
 * Profil Telegram jamais bloquant : une erreur est notée dans le journal du serveur, la page n'en montre que la raison
 * en clair (`profileErrorReason`) et la suite qui débloque vraiment (`profileErrorNextStep` : nouveau jeton, correction
 * de la description, ou réessayer si l'échec est passager).
 */
export async function setBotModeAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const r = await botSetMode(
    { botId: formData.get("botId"), mode: formData.get("mode"), personaId: formData.get("personaId") ?? undefined },
    webActor(user),
  );
  // Le mode est enregistré même si le profil Telegram n'a pas pu être posé (erreur « unavailable »).
  if (r.ok || r.code === "unavailable") revalidatePath("/settings/bots");
  back(backParams(r));
}
