"use server";

import { revalidatePath } from "next/cache";
import { decideValidation } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { runAnswerHumanRequest, runRelaunchHumanRequest, runSkipHumanRequest } from "@/lib/site-ops/ops/lot-d/validations";
import { requireUser } from "@/lib/session";

const PAGE = "/agents/validations";
const REQUESTS = { tab: "demandes" };

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Demandes (phase 34) : cœurs uniques `@/lib/site-ops/ops/lot-d/validations`, appelés aussi par Kevin. */
function request(r: { ok: true; message: string } | { ok: false; error: string; code?: string }): never {
  if (r.ok || r.code === "conflict") revalidatePath("/agents", "layout");
  backTo(PAGE, { ...REQUESTS, ...(r.ok ? { ok: r.message } : { error: r.error }) });
}

function finish(result: { ok: boolean; message: string }, extra: Record<string, string> = {}): never {
  revalidatePath("/agents", "layout");
  backTo(PAGE, { ...extra, ...(result.ok ? { ok: result.message } : { error: result.message }) });
}

/** Publier / Corriger / Refuser depuis le site (ADMIN et MANAGER) ; la décision et l'`AuditLog` sont faits par le moteur. */
export async function decideValidationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const validationId = field(formData, "validationId");
  const decision = field(formData, "decision");
  if (!validationId || !["approve", "edit", "reject"].includes(decision))
    backTo(PAGE, { error: "Validation inconnue : rechargez la page." });
  const editedText = field(formData, "editedText");
  if (decision === "edit" && !editedText) backTo(PAGE, { error: "Écrivez le texte corrigé avant d'enregistrer." });
  try {
    const r = await decideValidation(buildAgentsDeps(), {
      validationId,
      decision: decision as "approve" | "edit" | "reject",
      editedText: decision === "edit" ? editedText : undefined,
      rejectReason: decision === "reject" ? field(formData, "rejectReason") || null : null,
      via: "SITE",
      byUserId: user.id,
    });
    finish(r);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { error: `Décision impossible : ${errorText(err)}.` });
  }
}

/** Réponse à une demande depuis le site (mêmes règles que par Telegram ; une clé n'est jamais réaffichée). */
export async function answerHumanRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  request(await runAnswerHumanRequest(formData, siteActor(user)));
}

export async function skipHumanRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  request(await runSkipHumanRequest(formData, siteActor(user)));
}

export async function relaunchHumanRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  request(await runRelaunchHumanRequest(formData, siteActor(user)));
}
