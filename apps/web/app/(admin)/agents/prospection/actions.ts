"use server";

import { revalidatePath } from "next/cache";
import { PROSPECTION_PATH, prospectHref, safeProspectId } from "@/lib/agents/prospection/display";
import { viewHref, type ProspectionView } from "@/lib/agents/prospection/filters";
import { backTo } from "@/lib/agents/redirect";
import {
  runAddManualProspect,
  runBulkProspectStatus,
  runDecideDict,
  runProposeDict,
  runProspectNote,
  runProspectStatus,
  runSaveOffer,
  runSaveSettings,
  runSourcePause,
  runToggleOffer,
} from "@/lib/site-ops/ops/lot-prospection/cores";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la page Agents → Prospection (phase 31). Aucune ne contacte un canal ou une personne : le client
 * contacte lui-même et note ici ce qu'il a fait. Statuts, notes, ajouts, offres, propositions de repères : managers
 * compris ; « ne plus montrer », validation des repères, pauses de sources et réglages : administrateurs (refus dans
 * les cœurs). La logique vit dans les cœurs uniques (`@/lib/site-ops/ops/lot-prospection/cores`), que Kevin appelle
 * aussi ; chaque geste est noté dans le journal des actions (`AuditLog`).
 */

type Result = { ok: true; message: string; data?: Record<string, unknown> } | { ok: false; error: string; code?: string };

/** Retour sur la page d'origine (`back` : adresse relative de la page Prospection, sinon la vue donnée). */
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

const ficheOf = (fd: FormData) => {
  const id = safeProspectId(fd.get("prospectId"));
  return id ? prospectHref(id) : PROSPECTION_PATH;
};
const view = (v: ProspectionView) => viewHref(v);

export async function setProspectStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(ficheOf(formData), await runProspectStatus(formData, siteActor(user)), formData);
}

export async function bulkProspectStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("tableau"), await runBulkProspectStatus(formData, siteActor(user)), formData);
}

export async function addProspectNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(ficheOf(formData), await runProspectNote(formData, siteActor(user)), formData, "#notes");
}

export async function addManualProspectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runAddManualProspect(formData, siteActor(user));
  const id = r.ok && typeof r.data?.prospectId === "string" ? r.data.prospectId : null;
  finish(id ? prospectHref(id) : view("sources"), r, id ? new FormData() : formData, id ? "" : "#ajouter");
}

export async function saveOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("offres"), await runSaveOffer(formData, siteActor(user)), formData, "#offres");
}

export async function toggleOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("offres"), await runToggleOffer(formData, siteActor(user)), formData, "#offres");
}

export async function proposeDictAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("dictionnaires"), await runProposeDict(formData, siteActor(user)), formData, "#propositions");
}

export async function decideDictAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("dictionnaires"), await runDecideDict(formData, siteActor(user)), formData, "#propositions");
}

export async function toggleSourcePauseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("sources"), await runSourcePause(formData, siteActor(user)), formData, "#sources");
}

export async function saveProspectionSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(view("reglages"), await runSaveSettings(formData, siteActor(user)), formData, "#reglages");
}
