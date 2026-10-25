"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runRemoveAiKey, runSaveAiSettings, runVerifyAiKey } from "@/lib/site-ops/ops/lot-d/ai";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireAdmin } from "@/lib/session";

// Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/ai`), que Kevin appelle aussi.

const PAGE = "/settings/ai";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** Enregistre la clé (vide = inchangée), les modèles, le plafond, la limite et les mentions des risques. */
export async function saveAiSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runSaveAiSettings(formData, siteActor(admin));
  if (!r.ok) back({ error: r.error });
  revalidatePath(PAGE);
  back({ ok: r.message });
}

/** Teste la clé enregistrée par un appel minimal (5 jetons) au modèle par défaut. */
export async function verifyAiKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await runVerifyAiKey(new FormData(), siteActor(admin));
  if (r.ok || r.code === "conflict") revalidatePath(PAGE);
  back(r.ok ? { ok: r.message } : { error: r.error });
}

/** Retire la clé : l'assistant redevient indisponible (les suggestions passées restent dans l'historique). */
export async function removeAiKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await runRemoveAiKey(new FormData(), siteActor(admin));
  revalidatePath(PAGE);
  back(r.ok ? { ok: r.message } : { error: r.error });
}
