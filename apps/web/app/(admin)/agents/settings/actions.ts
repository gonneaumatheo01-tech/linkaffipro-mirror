"use server";

import { revalidatePath } from "next/cache";
import { deleteSecret, saveSecret, setTeamPaused, verifySecret } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { parseAgentsSettingsForm, parseBudgetFields, parseSecretValue } from "@/lib/agents/forms";
import { loadAgentsGeneralSettings, loadTeamConfig } from "@/lib/agents/queries";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { saveAgentsGeneralSettings, saveTeamBudgets } from "@/lib/agents/save";
import { isKnownSecretKey, secretInfo } from "@/lib/agents/secrets";
import { PROVIDER_LABELS, TEAM_KEYS, TEAM_PROVIDERS } from "@/lib/agents/teams";
import { requireAdmin } from "@/lib/session";

const PAGE = "/agents/settings";

function keyOf(fd: FormData): string {
  const v = fd.get("key");
  const key = typeof v === "string" ? v : "";
  if (!isKnownSecretKey(key)) backTo(PAGE, { error: "Clé inconnue : rechargez la page." });
  return key;
}

/** Enregistre une clé (chiffrée par le moteur, jamais renvoyée au navigateur ni journalisée en clair). */
export async function saveSecretAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const key = keyOf(formData);
  const raw = formData.get("value");
  const parsed = parseSecretValue(typeof raw === "string" ? raw : "");
  if (!parsed.ok) backTo(PAGE, { error: parsed.error });
  try {
    const { last4 } = await saveSecret(buildAgentsDeps(), key, parsed.data, { userId: admin.id, via: "SITE" });
    revalidatePath(PAGE);
    backTo(PAGE, { ok: `Clé ${secretInfo(key).label} enregistrée (se termine par ${last4}).` });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Enregistrement impossible : ${errorText(err)}.` });
  }
}

export async function verifySecretAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const key = keyOf(formData);
  try {
    const r = await verifySecret(buildAgentsDeps(), key);
    revalidatePath(PAGE);
    if (!r) backTo(PAGE, { error: `Aucune vérification n'existe encore pour la clé ${secretInfo(key).label}.` });
    backTo(PAGE, r.ok ? { ok: `Clé ${secretInfo(key).label} : ${r.message}` } : { error: `Clé ${secretInfo(key).label} : ${r.message}` });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Vérification impossible : ${errorText(err)}.` });
  }
}

export async function deleteSecretAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const key = keyOf(formData);
  try {
    await deleteSecret(buildAgentsDeps(), key, { userId: admin.id, via: "SITE" });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Suppression impossible : ${errorText(err)}.` });
  }
  revalidatePath(PAGE);
  backTo(PAGE, { ok: `Clé ${secretInfo(key).label} retirée.` });
}

/** Modèles d'IA et canal Médiathèque. */
export async function saveGeneralSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = parseAgentsSettingsForm(formData);
  if (!parsed.ok) backTo(PAGE, { error: parsed.error });
  try {
    const before = await loadAgentsGeneralSettings();
    const r = await saveAgentsGeneralSettings(parsed.data, before, admin.id);
    if (!r.ok) backTo(PAGE, { error: r.error });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Enregistrement impossible : ${errorText(err)}.` });
  }
  revalidatePath(PAGE);
  backTo(PAGE, { ok: "Réglages enregistrés." });
}

/** Plafonds du mois de toutes les équipes (champs `budget_<fournisseur>` préfixés de l'équipe : `dating.budget_llm`). */
export async function saveAllBudgetsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  try {
    for (const team of TEAM_KEYS) {
      const sub = new FormData();
      for (const p of TEAM_PROVIDERS[team]) {
        const v = formData.get(`${team}.budget_${p}`);
        if (typeof v === "string") sub.set(`budget_${p}`, v);
      }
      const parsed = parseBudgetFields(sub, TEAM_PROVIDERS[team], PROVIDER_LABELS);
      if (!parsed.ok) backTo(PAGE, { error: parsed.error });
      const before = (await loadTeamConfig(team)).budgets;
      if (JSON.stringify(before) !== JSON.stringify(parsed.data)) await saveTeamBudgets(team, parsed.data, admin.id);
    }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Enregistrement impossible : ${errorText(err)}.` });
  }
  revalidatePath("/agents", "layout");
  backTo(PAGE, { ok: "Plafonds enregistrés." });
}

/** Pause générale : toutes les équipes s'arrêtent (`Setting` `agents.pausedAll`). */
export async function setPausedAllAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const paused = formData.get("paused") === "1";
  try {
    const r = await setTeamPaused(
      buildAgentsDeps(),
      "all",
      paused,
      { userId: admin.id, via: "SITE" },
      paused ? "Pause générale demandée depuis le site" : undefined,
    );
    revalidatePath("/agents", "layout");
    backTo(PAGE, r.ok ? { ok: r.message } : { error: r.message });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Changement impossible : ${errorText(err)}.` });
  }
}
