"use server";

import { revalidatePath } from "next/cache";
import {
  answerHumanRequestFromSite,
  decideValidation,
  relaunchHumanRequest,
  skipHumanRequest,
} from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

const PAGE = "/agents/validations";
const REQUESTS = { tab: "demandes" };

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
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
  const id = field(formData, "requestId");
  const answer = field(formData, "answer");
  if (!id) backTo(PAGE, { ...REQUESTS, error: "Demande inconnue : rechargez la page." });
  if (!answer) backTo(PAGE, { ...REQUESTS, error: "Écrivez ou choisissez une réponse." });
  try {
    // Le rôle est passé au moteur : un MANAGER ne répond jamais à une demande réservée (clé, passage en vrai…).
    finish(
      await answerHumanRequestFromSite(buildAgentsDeps(), id, answer, { userId: user.id, via: "SITE" }, user.role),
      REQUESTS,
    );
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { ...REQUESTS, error: `Réponse impossible : ${errorText(err)}.` });
  }
}

export async function skipHumanRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(formData, "requestId");
  if (!id) backTo(PAGE, { ...REQUESTS, error: "Demande inconnue : rechargez la page." });
  try {
    finish(await skipHumanRequest(buildAgentsDeps(), id, { userId: user.id, via: "SITE" }, user.role), REQUESTS);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { ...REQUESTS, error: `Impossible de passer la demande : ${errorText(err)}.` });
  }
}

export async function relaunchHumanRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(formData, "requestId");
  if (!id) backTo(PAGE, { ...REQUESTS, error: "Demande inconnue : rechargez la page." });
  try {
    finish(await relaunchHumanRequest(buildAgentsDeps(), id, { userId: user.id, via: "SITE" }), REQUESTS);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(PAGE, { ...REQUESTS, error: `Relance impossible : ${errorText(err)}.` });
  }
}
