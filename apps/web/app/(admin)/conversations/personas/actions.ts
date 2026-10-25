"use server";

import { redirect } from "next/navigation";
import type { PersonaFormErrors } from "@/lib/personas/form";
import { requireUser } from "@/lib/session";
import { backUrl, webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import {
  deletePersonaCore,
  savePersonaCore,
  type PersonaCoreError,
} from "@/lib/site-ops/ops/lot-c/conversations";

/**
 * Actions des écrans Personas (phase 17). Administrateurs et responsables : créer et modifier ; supprimer :
 * administrateurs seulement (vérifié dans `lib/personas/save.ts`). Toute la règle est dans `save.ts`, appelé par les
 * cœurs de la phase 34 (`lib/site-ops/ops/lot-c/conversations.ts`, aussi utilisés par Kevin).
 */

const LIST = "/conversations/personas";

/** Retour de « Créer la persona » / « Enregistrer » quand l'enregistrement est refusé (la saisie est gardée). */
export type PersonaSaveState = { error: string; errors?: PersonaFormErrors } | null;

/** Enregistre le brouillon du formulaire (`useActionState`), puis ouvre la fiche avec le retour. */
export async function savePersonaAction(
  _prev: PersonaSaveState,
  formData: FormData,
): Promise<PersonaSaveState> {
  const user = await requireUser();
  const r = await savePersonaCore(
    { payload: String(formData.get("payload") ?? "null") },
    webActorOf(user),
  );
  if (!r.ok) {
    const errors = (r as PersonaCoreError).errors;
    return errors ? { error: r.error, errors } : { error: r.error };
  }
  redirect(r.back ? backUrl(r.back) : LIST);
}

/** « Supprimer la persona » (administrateurs, après confirmation ; refusé si un bot l'utilise). */
export async function deletePersonaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("personaId") ?? "");
  if (!id) redirect(LIST);
  const r = await deletePersonaCore({ personaId: id }, webActorOf(user));
  redirect(r.back ? backUrl(r.back) : LIST);
}
