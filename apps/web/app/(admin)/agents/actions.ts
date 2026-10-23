"use server";

import { revalidatePath } from "next/cache";
import { createTestMission, setAutonomyLevel, setSimulation, setTeamPaused } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import {
  TEST_MISSION_TEAMS,
  canSetLevel,
  canSetSimulation,
  parseLevel,
  parseTeamParam,
  teamName,
} from "@/lib/agents/teams";
import { requireUser } from "@/lib/session";

/** Page de retour : le tableau de bord ou une fiche d'équipe, jamais une adresse venue d'ailleurs. */
function returnPath(formData: FormData): string {
  const v = formData.get("from");
  return typeof v === "string" && /^\/agents(\/[a-z]+)?$/.test(v) ? v : "/agents";
}

function teamOf(formData: FormData) {
  return parseTeamParam(formData.get("team"));
}

function done(path: string, result: { ok: boolean; message: string }): never {
  revalidatePath("/agents", "layout");
  backTo(path, result.ok ? { ok: result.message } : { error: result.message });
}

/** « Créer une mission de test » : un post texte sur le canal Test, en simulation (ADMIN et MANAGER). */
export async function createTestMissionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const team = teamOf(formData);
  if (!team || !TEST_MISSION_TEAMS.includes(team)) backTo(path, { error: "Équipe inconnue." });
  try {
    const r = await createTestMission(buildAgentsDeps(), team, user.id);
    done(
      path,
      r.ok
        ? {
            ok: true,
            message: `Mission de test créée pour l'équipe ${teamName(team)} : l'aperçu arrivera sur Telegram et dans Validations.`,
          }
        : { ok: false, message: `Mission de test refusée : ${r.reason}` },
    );
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Mission de test impossible : ${errorText(err)}.` });
  }
}

/** Pause ou reprise d'une équipe (tout le monde : c'est un geste de sécurité). */
export async function setTeamPausedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const team = teamOf(formData);
  if (!team) backTo(path, { error: "Équipe inconnue." });
  const paused = formData.get("paused") === "1";
  try {
    const r = await setTeamPaused(
      buildAgentsDeps(),
      team,
      paused,
      { userId: user.id, via: "SITE" },
      paused ? "Pause demandée depuis le site" : undefined,
    );
    done(path, r);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Changement impossible : ${errorText(err)}.` });
  }
}

/** Niveau d'autonomie : le niveau 2 est réservé aux administrateurs. */
export async function setAutonomyLevelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const team = teamOf(formData);
  const level = parseLevel(formData.get("level"));
  if (!team || level === null) backTo(path, { error: "Choisissez un niveau entre 0 et 2." });
  if (!canSetLevel(user.role, level))
    backTo(path, { error: "Seul un administrateur peut passer une équipe en autonomie totale." });
  try {
    done(path, await setAutonomyLevel(buildAgentsDeps(), team, level, { userId: user.id, via: "SITE" }));
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Changement impossible : ${errorText(err)}.` });
  }
}

/** Simulation : la remettre est permis à tous ; l'arrêter (vrais canaux) est réservé aux administrateurs. */
export async function setSimulationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const path = returnPath(formData);
  const team = teamOf(formData);
  if (!team) backTo(path, { error: "Équipe inconnue." });
  const simulation = formData.get("simulation") === "1";
  if (!canSetSimulation(user.role, simulation))
    backTo(path, { error: "Seul un administrateur peut faire publier une équipe sur les vrais canaux." });
  try {
    done(path, await setSimulation(buildAgentsDeps(), team, simulation, { userId: user.id, via: "SITE" }));
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(path, { error: `Changement impossible : ${errorText(err)}.` });
  }
}
