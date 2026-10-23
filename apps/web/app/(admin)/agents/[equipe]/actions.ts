"use server";

import { revalidatePath } from "next/cache";
import { parseChannelPlanForm, parseTeamSettingsForm } from "@/lib/agents/forms";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { saveChannelPlan, saveTeamSettings } from "@/lib/agents/save";
import { PROVIDER_LABELS, TEAM_PROVIDERS, parseTeamParam } from "@/lib/agents/teams";
import { requireUser } from "@/lib/session";

/** Réglages d'une équipe (ADMIN et MANAGER) : consignes, mots interdits, longueur, heures calmes, plafonds. */
export async function saveTeamSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = parseTeamParam(formData.get("team"));
  if (!team) backTo("/agents", { error: "Équipe inconnue." });
  const path = `/agents/${team}`;
  const parsed = parseTeamSettingsForm(formData, TEAM_PROVIDERS[team], PROVIDER_LABELS);
  if (!parsed.ok) backTo(path, { error: parsed.error }, "#reglages");
  try {
    await saveTeamSettings(team, parsed.data, user.id);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#reglages");
  }
  revalidatePath(path);
  backTo(path, { ok: "Réglages de l'équipe enregistrés : le Grand Chef les applique à son prochain passage." }, "#reglages");
}

/** Plan d'un canal (ADMIN et MANAGER). */
export async function saveChannelPlanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = parseTeamParam(formData.get("team"));
  if (!team) backTo("/agents", { error: "Équipe inconnue." });
  const path = `/agents/${team}`;
  const parsed = parseChannelPlanForm(formData);
  if (!parsed.ok) backTo(path, { error: parsed.error }, "#plan");
  try {
    const r = await saveChannelPlan(team, parsed.data, user.id);
    if (!r.ok) backTo(path, { error: r.error }, "#plan");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Enregistrement impossible : ${errorText(err)}.` }, "#plan");
  }
  revalidatePath(path);
  backTo(path, { ok: "Plan du canal enregistré." }, "#plan");
}
