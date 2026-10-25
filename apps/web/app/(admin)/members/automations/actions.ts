"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireUser, type CurrentUser } from "@/lib/session";
import { backUrl, formInput, webActorOf, type Core } from "@/lib/site-ops/ops/lot-c/common";
import {
  deleteRule,
  duplicateRule,
  saveCard,
  saveRuleCore,
  testRuleOnMe,
  toggleRule,
} from "@/lib/site-ops/ops/lot-c/automations";

/** Retour d'une action appelée depuis un écran client : l'erreur s'affiche sur place (le succès redirige). */
export type SaveResult = { ok: false; error: string };

/**
 * Relances automatiques. Toute la règle est dans les cœurs de la phase 34 (`lib/site-ops/ops/lot-c/automations.ts`),
 * appelés aussi par Kevin : mêmes vérifications, mêmes messages, même journal.
 */
async function run(formData: FormData, core: Core, user: CurrentUser, admin = false): Promise<never> {
  const actor = admin ? { ...webActorOf(user), role: "ADMIN" as const } : webActorOf(user);
  const r = await core(formInput(formData), actor);
  redirect(r.back ? backUrl(r.back) : "/members/automations");
}

/** Écran client : erreur rendue sur place, succès redirigé. */
async function runInPlace(formData: FormData, core: Core): Promise<SaveResult> {
  const user = await requireUser();
  const r = await core(formInput(formData), webActorOf(user));
  if (!r.ok) return { ok: false, error: r.error };
  redirect(r.back ? backUrl(r.back) : "/members/automations");
}

/** Création depuis un formulaire (redirige ; en cas d'erreur, revient sur la création avec le message). */
export async function createRuleAction(formData: FormData): Promise<void> {
  await run(formData, saveRuleCore("create"), await requireUser());
}

/** Modification depuis un formulaire (redirige ; en cas d'erreur, revient sur la modification avec le message). */
export async function updateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("ruleId"));
  await run(formData, saveRuleCore("update"), user);
}

/**
 * Enregistrement depuis l'éditeur à branches (création ou modification) : en cas d'erreur, renvoie le message sans
 * quitter l'éditeur (rien n'est perdu) ; en cas de succès, ouvre la fiche de la relance.
 */
export async function saveRuleAction(formData: FormData): Promise<SaveResult> {
  return runInPlace(formData, saveRuleCore("editor"));
}

/**
 * Enregistre les réglages d'une carte prête à l'emploi (`templateKey`, `ruleId` facultatif) : la première fois, la
 * relance est créée désactivée ; ensuite, seule sa forme change. Erreur de saisie : renvoyée au volet.
 */
export async function saveCardAction(formData: FormData): Promise<SaveResult> {
  return runInPlace(formData, saveCard);
}

/** Interrupteur Activé / Désactivé (ADMIN et MANAGER). `back=list` : retour aux cartes. */
export async function toggleRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("ruleId"));
  await run(formData, toggleRule, user);
}

export async function duplicateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("ruleId"));
  await run(formData, duplicateRule, user);
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  z.string().min(1).parse(formData.get("ruleId"));
  await run(formData, deleteRule, admin, true);
}

/**
 * Exécute la relance pour le membre Telegram lié à l'utilisateur connecté (sans étiquette, messages de test ; un
 * parcours à branches passe ses attentes). `back=list` : retour aux cartes, sinon fiche de la relance.
 */
export async function testRuleOnMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("ruleId"));
  await run(formData, testRuleOnMe, user);
}
