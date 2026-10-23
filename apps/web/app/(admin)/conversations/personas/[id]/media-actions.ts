"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatePersonaMediaForm } from "@/lib/personas/media";
import { savePersonaMedia } from "@/lib/personas/media-save";
import { requireUser } from "@/lib/session";

/** « Enregistrer les médias » de la fiche persona (ADMIN et MANAGER). Retour par l'adresse (`?ok=` / `?error=`). */
export async function savePersonaMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("personaId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) redirect("/conversations/personas");
  const path = `/conversations/personas/${id}`;
  function back(key: "ok" | "error", text: string): never {
    redirect(`${path}?${new URLSearchParams({ [key]: text }).toString()}#medias`);
  }
  const parsed = validatePersonaMediaForm(formData);
  if (!parsed.ok) back("error", `${parsed.error} ${Object.values(parsed.errors).join(" ")}`.trim());
  const r = await savePersonaMedia(id, parsed.data, user.id);
  if (!r.ok) back("error", r.error);
  revalidatePath(path);
  revalidatePath("/agents/dating");
  back("ok", r.message);
}
