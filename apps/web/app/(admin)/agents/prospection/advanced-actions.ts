"use server";

import { revalidatePath } from "next/cache";
import { AFFILIATES_PATH, ALERTS_PATH, NETWORKS_PATH, SOURCES_PATH, VALUE_PATH } from "@/lib/agents/prospection/advanced";
import { PROSPECTION_PATH } from "@/lib/agents/prospection/display";
import { backTo } from "@/lib/agents/redirect";
import {
  runAccountSearchStop,
  runAffiliateLink,
  runAlertSeen,
  runAlertsChannel,
  runAlertsKind,
  runCalibrationApply,
  runCalibrationUndo,
  runNetworkMerge,
  runNetworkSplit,
} from "@/lib/site-ops/ops/lot-prospection/advanced";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions des pages avancées de la Prospection (phase 32) : alertes, réseaux, affiliés signés, calibrage, recherche par
 * compte réel. Aucune ne contacte un canal ou une personne, aucune n'écrit dans Link Affi. La logique vit dans les
 * cœurs uniques (`@/lib/site-ops/ops/lot-prospection/advanced`), que Kevin appelle aussi ; refus des rôles dans les
 * cœurs (calibrage : administrateurs) ; chaque geste est noté dans le journal des actions (`AuditLog`).
 */

type Result = { ok: true; message: string } | { ok: false; error: string; code?: string };

function finish(fallback: string, r: Result, formData: FormData, hash = ""): never {
  if (r.ok || r.code === "conflict") revalidatePath(PROSPECTION_PATH, "layout");
  const back = formData.get("back");
  const target = typeof back === "string" && back.startsWith(PROSPECTION_PATH) && !back.startsWith("//") ? back : fallback;
  const [path, query] = target.split("#")[0]!.split("?");
  const params = Object.fromEntries(new URLSearchParams(query ?? "").entries());
  delete params.ok;
  delete params.error;
  backTo(path ?? PROSPECTION_PATH, { ...params, ...(r.ok ? { ok: r.message } : { error: r.error }) }, hash);
}

export async function markAlertSeenAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(ALERTS_PATH, await runAlertSeen(formData, siteActor(user)), formData);
}

export async function muteProspectAlertsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(ALERTS_PATH, await runAlertsChannel(formData, siteActor(user)), formData);
}

export async function muteAlertKindAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  formData.set("action", "mute");
  finish(ALERTS_PATH, await runAlertsKind(formData, siteActor(user)), formData, "#types-coupes");
}

export async function unmuteAlertKindAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  formData.set("action", "unmute");
  finish(ALERTS_PATH, await runAlertsKind(formData, siteActor(user)), formData, "#types-coupes");
}

export async function mergeProspectsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(NETWORKS_PATH, await runNetworkMerge(formData, siteActor(user)), formData, "#regrouper");
}

export async function splitProspectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(NETWORKS_PATH, await runNetworkSplit(formData, siteActor(user)), formData);
}

export async function linkAffiliateAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(AFFILIATES_PATH, await runAffiliateLink(formData, siteActor(user)), formData);
}

export async function applyCalibrationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(VALUE_PATH, await runCalibrationApply(formData, siteActor(user)), formData, "#calibrage");
}

export async function undoCalibrationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(VALUE_PATH, await runCalibrationUndo(formData, siteActor(user)), formData, "#calibrage");
}

export async function stopAccountSearchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(SOURCES_PATH, await runAccountSearchStop(formData, siteActor(user)), formData, "#compte-reel");
}
