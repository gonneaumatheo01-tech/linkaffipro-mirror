"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PersonaFormErrors } from "@/lib/personas/form";
import { deletePersona, savePersona } from "@/lib/personas/save";
import { requireUser } from "@/lib/session";

/**
 * Actions des écrans Personas (phase 17). Administrateurs et responsables : créer et modifier ; supprimer :
 * administrateurs seulement (vérifié ici et dans `lib/personas/save.ts`). Toute la règle est dans `save.ts`.
 */

const LIST = "/conversations/personas";

/** Retour de « Créer la persona » / « Enregistrer » quand l'enregistrement est refusé (la saisie est gardée). */
export type PersonaSaveState = { error: string; errors?: PersonaFormErrors } | null;

function withParams(path: string, params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Enregistre le brouillon du formulaire (`useActionState`), puis ouvre la fiche avec le retour. */
export async function savePersonaAction(
  _prev: PersonaSaveState,
  formData: FormData,
): Promise<PersonaSaveState> {
  const user = await requireUser();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "null"));
  } catch {
    return { error: "Le formulaire n'a pas pu être lu : rechargez la page, puis recommencez." };
  }
  const r = await savePersona(raw, { id: user.id, role: user.role });
  if (!r.ok) return { error: r.error, errors: r.errors };
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${r.id}`);
  revalidatePath("/settings/bots");
  redirect(withParams(`${LIST}/${r.id}`, { ok: r.message, error: r.problem }));
}

/** « Supprimer la persona » (administrateurs, après confirmation ; refusé si un bot l'utilise). */
export async function deletePersonaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("personaId") ?? "");
  if (!id) redirect(LIST);
  const r = await deletePersona(id, { id: user.id, role: user.role });
  if (!r.ok) redirect(withParams(`${LIST}/${id}`, { error: r.error }));
  revalidatePath(LIST);
  revalidatePath("/settings/bots");
  redirect(withParams(LIST, { ok: r.message }));
}
