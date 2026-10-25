"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { webActorOf } from "@/lib/site-ops/ops/lot-b/common";
import { welcomeResend } from "@/lib/site-ops/ops/lot-b/share-links";

/** Adresse de retour interne seulement (« /… », jamais « //… » ni une adresse externe). */
function safeReturnTo(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";
}

/**
 * Bouton « Renvoyer l'accueil avec les liens » (À faire de l'accueil) : équipe connectée (administrateur ou manager),
 * audit, puis retour avec le résultat. Aucun envoi pour une demande qui n'est plus en attente. Cœur partagé avec
 * Kevin : `welcomeResend` (`lib/site-ops/ops/lot-b/share-links.ts`, phase 34).
 */
export async function resendGateWelcomeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const channelId = z.string().min(1).parse(formData.get("channelId"));
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const r = await welcomeResend({ channelId }, webActorOf(user));
  revalidatePath("/");
  revalidatePath(`/channels/${channelId}`);
  const [path, query = ""] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.delete("ok");
  params.delete("error");
  const ok = r.ok ? r.message : "";
  const error = r.ok ? (r.data?.warning ? String(r.data.warning) : "") : r.error;
  if (ok) params.set("ok", ok);
  if (error) params.set("error", error);
  redirect(`${path}?${params.toString()}`);
}
