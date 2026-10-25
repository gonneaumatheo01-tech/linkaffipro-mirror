"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { backUrl, formInput, webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import { savePersonaMediaCore } from "@/lib/site-ops/ops/lot-c/conversations";

/**
 * « Enregistrer les médias » de la fiche persona (ADMIN et MANAGER). Retour par l'adresse (`?ok=` / `?error=`). Toute
 * la règle est dans le cœur de la phase 34 (`lib/site-ops/ops/lot-c/conversations.ts`), aussi utilisé par Kevin.
 */
export async function savePersonaMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("personaId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) redirect("/conversations/personas");
  const r = await savePersonaMediaCore(formInput(formData), webActorOf(user));
  redirect(r.back ? backUrl(r.back) : `/conversations/personas/${id}`);
}
