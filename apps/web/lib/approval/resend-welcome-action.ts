"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { resendGateWelcomeForChannel } from "./resend-welcome";

/** Adresse de retour interne seulement (« /… », jamais « //… » ni une adresse externe). */
function safeReturnTo(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";
}

/**
 * Bouton « Renvoyer l'accueil avec les liens » (À faire de l'accueil) : équipe connectée (administrateur ou manager),
 * audit, puis retour avec le résultat. Aucun envoi pour une demande qui n'est plus en attente.
 */
export async function resendGateWelcomeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const r = await resendGateWelcomeForChannel(channelId, user.id);
  revalidatePath("/");
  revalidatePath(`/channels/${channelId}`);
  const [path, query = ""] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.delete("ok");
  params.delete("error");
  if (r.ok) params.set("ok", r.ok);
  if (r.error) params.set("error", r.error);
  redirect(`${path}?${params.toString()}`);
}
