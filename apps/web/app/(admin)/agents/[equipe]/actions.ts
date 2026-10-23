"use server";

import { revalidatePath } from "next/cache";
import { createTestPostMission, startBench } from "@linkaffipro/agents";
import { audit } from "@linkaffipro/db";
import { parseDatingSettingsForm, parseTestPostForm } from "@/lib/agents/dating";
import { loadMediaKeys } from "@/lib/agents/dating-queries";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { parseChannelPlanForm, parseTeamSettingsForm } from "@/lib/agents/forms";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { saveChannelPlan, saveDatingMediaSettings, saveTeamSettings } from "@/lib/agents/save";
import { PROVIDER_LABELS, TEAM_PROVIDERS, parseTeamParam } from "@/lib/agents/teams";
import { requireUser } from "@/lib/session";

/**
 * Réglages d'une équipe : consignes, mots interdits, longueur, heures calmes (ADMIN et MANAGER) ; plafonds et, pour
 * Rencontres, fournisseur et résolution des vidéos (ADMIN seulement : ignorés pour un responsable).
 */
export async function saveTeamSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = parseTeamParam(formData.get("team"));
  if (!team) backTo("/agents", { error: "Équipe inconnue." });
  const path = `/agents/${team}`;
  const isAdmin = user.role === "ADMIN";
  const parsed = parseTeamSettingsForm(formData, isAdmin ? TEAM_PROVIDERS[team] : [], PROVIDER_LABELS);
  if (!parsed.ok) backTo(path, { error: parsed.error }, "#reglages");
  const video = isAdmin && team === "dating" ? parseDatingSettingsForm(formData) : null;
  if (video && !video.ok) backTo(path, { error: video.error }, "#reglages");
  try {
    await saveTeamSettings(team, { ...parsed.data, budgets: isAdmin ? parsed.data.budgets : null }, user.id);
    if (video?.ok) await saveDatingMediaSettings(video.data, user.id);
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

const DATING = "/agents/dating";
const FORMAT_WORDS = { video: "vidéo", photo: "photo", text: "texte" } as const;

/**
 * « Produire un post de test » (équipe Rencontres, ADMIN et MANAGER) : une mission en simulation vers le canal Test,
 * du type choisi, pour la persona choisie. Le moteur journalise la mission ; l'action laisse sa trace dans le journal
 * des actions.
 */
export async function createTestPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseTestPostForm(formData);
  if (!parsed.ok) backTo(DATING, { error: parsed.error }, "#production");
  const { format, personaId } = parsed.data;
  try {
    const r = await createTestPostMission(buildAgentsDeps(), { teamKey: "dating", byUserId: user.id, format, personaId });
    await audit({
      userId: user.id,
      action: "agents.test_post_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "dating", format, personaId, ok: r.ok, reason: r.ok ? null : r.reason },
    });
    revalidatePath("/agents", "layout");
    if (!r.ok) backTo(DATING, { error: `Post de test refusé : ${r.reason}` }, "#production");
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(DATING, { error: `Post de test impossible : ${errorText(err)}.` }, "#production");
  }
  backTo(
    DATING,
    {
      ok: `Post de test (${FORMAT_WORDS[format]}) lancé en simulation : l'aperçu arrivera sur Telegram et dans Validations, puis sur le canal Test.`,
    },
    "#production",
  );
}

/** « Banc d'essai » d'une persona (ADMIN) : rien ne part sans clé fal.ai ou Magic Hour (message clair). */
export async function startBenchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "ADMIN") backTo(DATING, { error: "Le banc d'essai est réservé aux administrateurs." }, "#production");
  const personaId = String(formData.get("personaId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(personaId)) backTo(DATING, { error: "Choisissez la persona." }, "#production");
  const keys = await loadMediaKeys();
  if (!keys.fal && !keys.magichour)
    backTo(
      DATING,
      {
        error:
          "Banc d'essai impossible sans clé : collez d'abord la clé fal.ai (ou Magic Hour) dans Réglages des agents, puis cliquez sur « Vérifier ».",
      },
      "#production",
    );
  let message = "";
  try {
    const r = await startBench(buildAgentsDeps(), { personaId, byUserId: user.id });
    await audit({
      userId: user.id,
      action: "agents.bench_requested",
      entityType: "Persona",
      entityId: personaId,
      metadata: { ok: r.ok, keys },
    });
    if (!r.ok) backTo(DATING, { error: r.message }, "#production");
    message = r.message;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(DATING, { error: `Banc d'essai impossible : ${errorText(err)}.` }, "#production");
  }
  revalidatePath(DATING);
  backTo(DATING, { ok: message || "Banc d'essai lancé : les résultats arrivent sur Telegram." }, "#production");
}
