"use server";

import { revalidatePath } from "next/cache";
import { MONTAGE_PATH, montageHref, safeMontageId } from "@/lib/agents/montage";
import { backTo } from "@/lib/agents/redirect";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { runApproveShort, runCancelMontage, runModifyShort, runRejectShort } from "@/lib/site-ops/ops/lot-montage/shorts";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche d'un montage (Agents → Montage, phase 28), réservées aux administrateurs : Valider, Modifier,
 * Refuser un short (mêmes effets que les boutons de l'aperçu chez Kevin) et Annuler le montage. La logique vit dans
 * les cœurs uniques (`@/lib/site-ops/ops/lot-montage/shorts`), que Kevin appelle aussi ; chaque geste est noté dans
 * le journal des actions (`AuditLog`).
 */

type Result = { ok: true; message: string } | { ok: false; error: string; code?: string; field?: string | null };

function finish(formData: FormData, r: Result, hash = ""): never {
  const jobId = safeMontageId(formData.get("jobId"));
  if (!jobId) backTo(MONTAGE_PATH, r.ok ? { ok: r.message } : { error: r.error });
  const back = montageHref(jobId);
  if (r.ok || r.code === "conflict") {
    revalidatePath(MONTAGE_PATH);
    revalidatePath(back);
  }
  if (!r.ok && r.code === "not_found" && r.field !== "clipId") backTo(MONTAGE_PATH, { error: r.error });
  backTo(back, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

const clipHash = (fd: FormData) => {
  const id = safeMontageId(fd.get("clipId"));
  return id ? `#short-${id}` : "";
};

export async function approveShortAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runApproveShort(formData, siteActor(user)), clipHash(formData));
}

export async function rejectShortAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runRejectShort(formData, siteActor(user)), clipHash(formData));
}

export async function modifyShortAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runModifyShort(formData, siteActor(user)), clipHash(formData));
}

export async function cancelMontageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runCancelMontage(formData, siteActor(user)));
}
