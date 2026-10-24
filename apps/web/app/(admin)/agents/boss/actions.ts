"use server";

import { revalidatePath } from "next/cache";
import { BOSS_PATH, MAX_BOSS_BUDGET_EUROS, parseBossBudgetForm, parseBossNameForm } from "@/lib/agents/boss";
import { saveBossBudget, saveBossName } from "@/lib/agents/boss-save";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireAdmin } from "@/lib/session";

/** Plafond mensuel de l'IA de Kevin (ADMIN, journal `boss.budget_saved`). */
export async function saveBossBudgetAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = parseBossBudgetForm(formData);
  if (!parsed.ok) backTo(BOSS_PATH, { error: parsed.error });
  try {
    await saveBossBudget(parsed.data, admin.id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOSS_PATH, { error: `Enregistrement impossible : ${errorText(err)}.` });
  }
  revalidatePath(BOSS_PATH);
  const euros = (parsed.data / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  backTo(BOSS_PATH, {
    ok: parsed.data === 0 ? "Plafond à 0 € : il ne comprend plus que les commandes exactes." : `Plafond enregistré : ${euros} € par mois (${MAX_BOSS_BUDGET_EUROS} € au plus).`,
  });
}

/** Prénom affiché du Boss (ADMIN, journal `boss.name_saved`). */
export async function saveBossNameAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = parseBossNameForm(formData);
  if (!parsed.ok) backTo(BOSS_PATH, { error: parsed.error });
  try {
    await saveBossName(parsed.data, admin.id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(BOSS_PATH, { error: `Enregistrement impossible : ${errorText(err)}.` });
  }
  revalidatePath(BOSS_PATH);
  backTo(BOSS_PATH, { ok: `Prénom enregistré : ${parsed.data}.` });
}
