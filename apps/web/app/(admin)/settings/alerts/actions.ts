"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";
import {
  ALERT_THRESHOLDS_KEY,
  alertSettingsValue,
  parseThresholds,
  switchesFromForm,
  thresholdsSavedMessage,
} from "./thresholds";

function back(params: Record<string, string>): never {
  redirect(`/settings/alerts?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/** Marque une alerte comme résolue. */
export async function resolveAlertAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("alertId"));
  await prisma.alert.update({ where: { id }, data: { resolvedAt: new Date() } });
  await audit({ userId: admin.id, action: "alert.resolved", entityType: "Alert", entityId: id });
  revalidatePath("/settings/alerts");
  back({ ok: "Alerte marquée comme résolue." });
}

/** Enregistre la durée de rétention (mois, minimum 6). */
export async function saveRetentionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z.coerce.number().int().min(6).max(120).safeParse(formData.get("months"));
  if (!parsed.success)
    back({ error: "La durée de conservation doit être un nombre de mois entre 6 et 120." });
  await prisma.setting.upsert({
    where: { key: "retention.months" },
    create: { key: "retention.months", value: parsed.data },
    update: { value: parsed.data },
  });
  await audit({
    userId: admin.id,
    action: "settings.retention_changed",
    metadata: { months: parsed.data },
  });
  revalidatePath("/settings/alerts");
  back({ ok: `Durée de conservation enregistrée : ${parsed.data} mois.` });
}

const thresholdsSchema = z.object({
  registrationsDropPct: z.coerce.number().int().min(1).max(100),
  spendNoConversionEur: z.coerce.number().min(0).max(1_000_000),
  channelLeakPct: z.coerce.number().int().min(1).max(100),
});

/**
 * Enregistre les seuils et les interrupteurs « Alerte activée » des alertes sur les chiffres (chute des inscriptions,
 * dépense sans inscription, canal qui perd ses membres) dans le même réglage, sans perdre ses autres clés. Une alerte
 * désactivée n'est plus évaluée par le worker ; une alerte ouverte de ce type se ferme au passage suivant.
 */
export async function saveAlertThresholdsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = thresholdsSchema.safeParse({
    registrationsDropPct: formData.get("registrationsDropPct"),
    spendNoConversionEur: String(formData.get("spendNoConversionEur") ?? "").replace(",", "."),
    channelLeakPct: formData.get("channelLeakPct"),
  });
  if (!parsed.success)
    back({
      error:
        "Seuils invalides : les pourcentages vont de 1 à 100 et la dépense est un montant positif en euros.",
    });
  const thresholds = parseThresholds(parsed.data);
  const enabled = switchesFromForm(formData);
  const previous = await prisma.setting.findUnique({ where: { key: ALERT_THRESHOLDS_KEY } });
  const value = alertSettingsValue(previous?.value, thresholds, enabled);
  await prisma.setting.upsert({
    where: { key: ALERT_THRESHOLDS_KEY },
    create: { key: ALERT_THRESHOLDS_KEY, value: value as Prisma.InputJsonObject },
    update: { value: value as Prisma.InputJsonObject },
  });
  await audit({
    userId: admin.id,
    action: "settings.alert_thresholds_updated",
    metadata: { ...thresholds, enabled },
  });
  revalidatePath("/settings/alerts");
  back({ ok: thresholdsSavedMessage(thresholds, enabled) });
}

/** Lance la purge de rétention maintenant (tâche du worker). */
export async function purgeNowAction(): Promise<void> {
  const admin = await requireAdmin();
  try {
    await enqueue(
      "maintenance",
      { type: "purge" },
      { jobId: `maintenance-purge-manual-${Date.now()}` },
    );
    await audit({ userId: admin.id, action: "maintenance.purge_requested" });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer la purge pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
    });
  }
  revalidatePath("/settings/alerts");
  back({
    ok: "Purge lancée : le résultat apparaîtra ici et dans le Journal (action maintenance.purge) dans quelques minutes.",
  });
}

/** Lance un passage d'alertes maintenant. */
export async function checkAlertsNowAction(): Promise<void> {
  const admin = await requireAdmin();
  try {
    await enqueue(
      "maintenance",
      { type: "alerts" },
      { jobId: `maintenance-alerts-manual-${Date.now()}` },
    );
    await audit({ userId: admin.id, action: "maintenance.alerts_requested" });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer la vérification pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
    });
  }
  revalidatePath("/settings/alerts");
  back({ ok: "Vérification lancée : rechargez la page dans une minute." });
}
