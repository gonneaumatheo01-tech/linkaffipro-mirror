"use server";

import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/agents/redirect";
import { parseTeamParam } from "@/lib/agents/teams";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import {
  runCreateTestPost,
  runSaveChannelPlan,
  runSaveTeamSettings,
  runStartBench,
} from "@/lib/site-ops/ops/lot-d/teams";
import { requireUser } from "@/lib/session";

/*
 * Phase 34 : chaque action lit le formulaire et appelle le cœur unique (`@/lib/site-ops/ops/lot-d/teams`), que Kevin
 * appelle aussi : mêmes validations, mêmes textes, même journal (`via`). L'action garde l'adresse de retour.
 */

/**
 * Réglages d'une équipe : consignes, mots interdits, longueur, heures calmes (ADMIN et MANAGER) ; plafonds et, pour
 * Rencontres, fournisseur et résolution des vidéos (ADMIN seulement : ignorés pour un responsable).
 */
export async function saveTeamSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = parseTeamParam(formData.get("team"));
  if (!team) backTo("/agents", { error: "Équipe inconnue." });
  const path = `/agents/${team}`;
  const r = await runSaveTeamSettings(formData, siteActor(user));
  if (!r.ok) backTo(path, { error: r.error }, "#reglages");
  revalidatePath(path);
  backTo(path, { ok: r.message }, "#reglages");
}

/** Plan d'un canal (ADMIN et MANAGER). */
export async function saveChannelPlanAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = parseTeamParam(formData.get("team"));
  if (!team) backTo("/agents", { error: "Équipe inconnue." });
  const path = `/agents/${team}`;
  const r = await runSaveChannelPlan(formData, siteActor(user));
  if (!r.ok) backTo(path, { error: r.error }, "#plan");
  revalidatePath(path);
  backTo(path, { ok: r.message }, "#plan");
}

const DATING = "/agents/dating";

/**
 * « Produire un post de test » (équipe Rencontres, ADMIN et MANAGER) : une mission en simulation vers le canal Test,
 * du type choisi, pour la persona choisie. Le moteur journalise la mission ; le cœur laisse sa trace dans le journal
 * des actions.
 */
export async function createTestPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runCreateTestPost(formData, siteActor(user));
  if (r.ok || r.code !== "invalid") revalidatePath("/agents", "layout");
  backTo(DATING, r.ok ? { ok: r.message } : { error: r.error }, "#production");
}

/** « Banc d'essai » d'une persona (ADMIN) : rien ne part sans clé fal.ai ou Magic Hour (message clair). */
export async function startBenchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runStartBench(formData, siteActor(user));
  if (!r.ok) backTo(DATING, { error: r.error }, "#production");
  revalidatePath(DATING);
  backTo(DATING, { ok: r.message }, "#production");
}
