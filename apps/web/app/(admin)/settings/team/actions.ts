"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  teamInvite,
  teamResetPassword,
  teamRevokeInvitation,
  teamSetRole,
  teamToggleUser,
} from "@/lib/site-ops/ops/lot-e/team";
import { backParams, webActor, type SiteOpResult } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/**
 * Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/team.ts`), comme Kevin (« ajoute Léa à
 * l'équipe comme responsable »). Le lien d'invitation est affiché sur la page (« Invitations en attente »).
 */
function back(params: Record<string, string>): never {
  redirect(`/settings/team?${new URLSearchParams(params).toString()}`);
}

/** Compte ou invitation absent : erreur levée comme avant (`findUniqueOrThrow`), jamais un retour silencieux. */
function orThrow(r: SiteOpResult): SiteOpResult {
  if (!r.ok && r.code === "not_found") throw new Error(r.error);
  return r;
}

/** Créer une invitation (ADMIN). Le lien est affiché à copier : aucun e-mail n'est envoyé. */
export async function inviteAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await teamInvite({ email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "MANAGER") }, webActor(admin));
  if (r.ok) revalidatePath("/settings/team");
  back(backParams(r));
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("invitationId"));
  const r = orThrow(await teamRevokeInvitation({ invitationId: id }, webActor(admin)));
  if (r.ok) revalidatePath("/settings/team");
  back(backParams(r));
}

export async function toggleUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const r = orThrow(await teamToggleUser({ userId: id }, webActor(admin)));
  if (r.ok) revalidatePath("/settings/team");
  back(backParams(r));
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const r = orThrow(await teamSetRole({ userId: id, role: String(formData.get("role") ?? "") }, webActor(admin)));
  if (r.ok && !r.data?.unchanged) revalidatePath("/settings/team");
  back(backParams(r));
}

/**
 * Réinitialisation du mot de passe (ADMIN) : crée une invitation liée à l'e-mail du compte existant.
 * Quand la personne l'accepte, son mot de passe est remplacé et toutes ses sessions sont fermées
 * (voir /invite/[token]). Le lien est valable 48 h ; les invitations précédentes du même e-mail sont annulées.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const r = orThrow(await teamResetPassword({ userId: id }, webActor(admin)));
  if (r.ok) revalidatePath("/settings/team");
  back(backParams(r));
}
