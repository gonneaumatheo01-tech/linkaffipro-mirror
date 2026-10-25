"use server";

import { revalidatePath } from "next/cache";
import { setTeamPaused } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import {
  runDeleteSecret,
  runSaveBudgets,
  runSaveGeneralSettings,
  runSaveSecret,
  runVerifySecret,
} from "@/lib/site-ops/ops/lot-d/settings";
import { requireAdmin } from "@/lib/session";

/*
 * Phase 34 : les clés, modèles et plafonds passent par les cœurs uniques (`@/lib/site-ops/ops/lot-d/settings`), que
 * Kevin appelle aussi. La pause générale garde `setTeamPaused`, la même fonction que la commande « pause tout » de Kevin.
 */

const PAGE = "/agents/settings";

function finish(r: { ok: true; message: string } | { ok: false; error: string }, revalidate = true): never {
  if (revalidate) revalidatePath(PAGE);
  backTo(PAGE, r.ok ? { ok: r.message } : { error: r.error });
}

/** Enregistre une clé (chiffrée par le moteur, jamais renvoyée au navigateur ni journalisée en clair). */
export async function saveSecretAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runSaveSecret(formData, siteActor(admin));
  finish(r, r.ok);
}

export async function verifySecretAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runVerifySecret(formData, siteActor(admin));
  finish(r, r.ok || r.code !== "invalid");
}

export async function deleteSecretAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runDeleteSecret(formData, siteActor(admin));
  finish(r, r.ok);
}

/** Modèles d'IA et canal Médiathèque. */
export async function saveGeneralSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runSaveGeneralSettings(formData, siteActor(admin));
  finish(r, r.ok);
}

/** Plafonds du mois de toutes les équipes (champs `budget_<fournisseur>` préfixés de l'équipe : `dating.budget_llm`). */
export async function saveAllBudgetsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await runSaveBudgets(formData, siteActor(admin));
  if (r.ok) revalidatePath("/agents", "layout");
  finish(r, false);
}

/** Pause générale : toutes les équipes s'arrêtent (`Setting` `agents.pausedAll`). */
export async function setPausedAllAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const paused = formData.get("paused") === "1";
  // Phase 25 : le bouton existe aussi sur le tableau de bord ; retour sur la page d'où vient le clic.
  const back = formData.get("from") === "/agents" ? "/agents" : PAGE;
  try {
    const r = await setTeamPaused(
      buildAgentsDeps(),
      "all",
      paused,
      { userId: admin.id, via: "SITE" },
      paused ? "Pause générale demandée depuis le site" : undefined,
    );
    revalidatePath("/agents", "layout");
    backTo(back, r.ok ? { ok: r.message } : { error: r.message });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(back, { error: `Changement impossible : ${errorText(err)}.` });
  }
}
