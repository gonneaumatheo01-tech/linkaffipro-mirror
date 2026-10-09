"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  AUTOMATION_TRIGGERS,
  validateTelegramHtml,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin, requireUser } from "@/lib/session";
import { actionsFromForm, conditionsFromForm } from "@/lib/automations/form";

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}
const isRedirect = (err: unknown) =>
  (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");

function readRule(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2) throw new Error("Donnez un nom à la règle (2 caractères minimum).");
  const trigger = String(fd.get("trigger") ?? "");
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger))
    throw new Error("Choisissez un déclencheur dans la liste.");
  const conditions = conditionsFromForm(fd);
  if (trigger === "INACTIVE" && !conditions.inactiveDays)
    throw new Error("Le déclencheur « Inactivité » a besoin d'un nombre de jours sans activité.");
  const actions = actionsFromForm(fd);
  for (const a of actions) {
    const text = "text" in a ? a.text : undefined;
    if (text) {
      const v = validateTelegramHtml(text);
      if (!v.ok) throw new Error(`Texte invalide : ${v.error}`);
    }
  }
  return {
    name,
    trigger: trigger as AutomationTriggerKey,
    conditions,
    actions,
    oncePerMember: fd.get("oncePerMember") === "on",
  };
}

export async function createRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let id = "";
  try {
    const r = readRule(formData);
    const rule = await prisma.automationRule.create({
      data: {
        name: r.name,
        trigger: r.trigger,
        conditions: toJsonValue(r.conditions),
        actions: toJsonValue(r.actions),
        oncePerMember: r.oncePerMember,
        isActive: false,
        createdById: user.id,
      },
    });
    id = rule.id;
    await audit({
      userId: user.id,
      action: "automation.created",
      entityType: "AutomationRule",
      entityId: rule.id,
      metadata: { name: r.name, trigger: r.trigger },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back("/automations/new", {
      error: err instanceof Error ? err.message : "Création impossible.",
    });
  }
  revalidatePath("/automations");
  back(`/automations/${id}`, {
    ok: "Règle créée, pour l'instant inactive. Testez-la sur vous, puis activez-la.",
  });
}

export async function updateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  try {
    const r = readRule(formData);
    await prisma.automationRule.update({
      where: { id },
      data: {
        name: r.name,
        trigger: r.trigger,
        conditions: toJsonValue(r.conditions),
        actions: toJsonValue(r.actions),
        oncePerMember: r.oncePerMember,
      },
    });
    await audit({
      userId: user.id,
      action: "automation.updated",
      entityType: "AutomationRule",
      entityId: id,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back(`/automations/${id}/edit`, {
      error: err instanceof Error ? err.message : "Enregistrement impossible.",
    });
  }
  revalidatePath("/automations");
  back(`/automations/${id}`, { ok: "Règle enregistrée." });
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
  await prisma.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
  await audit({
    userId: user.id,
    action: rule.isActive ? "automation.deactivated" : "automation.activated",
    entityType: "AutomationRule",
    entityId: id,
  });
  revalidatePath("/automations");
  back(`/automations/${id}`, { ok: rule.isActive ? "Règle désactivée." : "Règle activée." });
}

export async function duplicateRuleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });
  const copy = await prisma.automationRule.create({
    data: {
      name: `${rule.name} (copie)`,
      trigger: rule.trigger,
      conditions: rule.conditions as object,
      actions: rule.actions as object,
      oncePerMember: rule.oncePerMember,
      isActive: false,
      createdById: user.id,
    },
  });
  await audit({
    userId: user.id,
    action: "automation.duplicated",
    entityType: "AutomationRule",
    entityId: copy.id,
    metadata: { from: id },
  });
  revalidatePath("/automations");
  back(`/automations/${copy.id}/edit`, {
    ok: "Copie créée, inactive : adaptez-la puis enregistrez.",
  });
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  await prisma.automationRule.delete({ where: { id } });
  await audit({
    userId: admin.id,
    action: "automation.deleted",
    entityType: "AutomationRule",
    entityId: id,
  });
  revalidatePath("/automations");
  back("/automations", { ok: "Règle supprimée." });
}

/** Exécute la règle pour le membre Telegram lié à l'utilisateur connecté (sans étiquette, messages de test). */
export async function testRuleOnMeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("ruleId"));
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramUserId: true },
  });
  if (!me?.telegramUserId)
    back(`/automations/${id}`, {
      error: "Liez d'abord votre compte Telegram dans « Mon compte » (menu en haut à droite).",
    });
  const member = await prisma.member.findUnique({
    where: { telegramUserId: me.telegramUserId },
    select: { id: true },
  });
  if (!member)
    back(`/automations/${id}`, {
      error:
        "Envoyez d'abord /start à l'un de nos bots depuis votre compte Telegram, puis réessayez.",
    });
  try {
    await enqueue(
      "automations",
      { type: "test", ruleId: id, memberId: member.id },
      { jobId: `automation-test-${id}-${Date.now()}` },
    );
  } catch (err) {
    back(`/automations/${id}`, {
      error: `Impossible de lancer le test pour le moment (${err instanceof Error ? err.message : "erreur inconnue"}). Réessayez dans une minute.`,
    });
  }
  await audit({
    userId: user.id,
    action: "automation.tested",
    entityType: "AutomationRule",
    entityId: id,
  });
  back(`/automations/${id}`, {
    ok: "Test lancé : vous recevrez les messages sur Telegram dans quelques secondes ; le résultat apparaît dans le journal ci-dessous.",
  });
}
