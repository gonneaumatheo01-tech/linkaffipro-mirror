"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  runRemoveAssistantKey,
  runSaveAssistantSettings,
  runVerifyAssistantKey,
} from "@/lib/site-ops/ops/lot-d/assistant";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireAdmin } from "@/lib/session";

/*
 * Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/assistant`), que Kevin appelle aussi : mêmes
 * validations, mêmes textes, même journal (`assistant.settings_saved`, jamais la clé ; `assistant.activation_changed`).
 */

const PAGE = "/settings/assistant";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/**
 * Enregistre la clé (vide = inchangée), l'activation, les modèles et les limites. L'activation (« Seulement l'équipe »
 * ou « Tout le monde ») exige une clé.
 */
export async function saveAssistantSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runSaveAssistantSettings(formData, siteActor(admin));
  if (!r.ok) back({ error: r.error });
  revalidatePath(PAGE);
  back({ ok: r.message });
}

/**
 * Vérifie la clé sans dépenser de crédits et relit la liste des modèles ; une clé collée est d'abord enregistrée, et
 * les autres réglages modifiés de la page avec elle.
 */
export async function verifyAssistantKeyAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runVerifyAssistantKey(formData, siteActor(admin));
  if (r.ok || r.code === "conflict" || (r.code === "unavailable" && !r.error.startsWith("Collez")))
    revalidatePath(PAGE);
  back(r.ok ? { ok: r.message } : { error: r.error });
}

/** Retire la clé et désactive l'assistant (il ne répond plus à personne) ; l'historique des coûts reste. */
export async function removeAssistantKeyAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await runRemoveAssistantKey(new FormData(), siteActor(admin));
  revalidatePath(PAGE);
  back(r.ok ? { ok: r.message } : { error: r.error });
}
