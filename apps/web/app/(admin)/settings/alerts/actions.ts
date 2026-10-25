"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import {
  alertResolve,
  alertsCheckNow,
  alertThresholdsSave,
  purgeNow,
  retentionSave,
} from "@/lib/site-ops/ops/lot-e/alerts";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { switchesFromForm } from "./thresholds";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/alerts.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/alerts?${new URLSearchParams(params).toString()}`);
}

/** Marque une alerte comme résolue. */
export async function resolveAlertAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("alertId"));
  const r = await alertResolve({ alertId: id }, webActor(admin));
  if (r.ok) revalidatePath("/settings/alerts");
  back(backParams(r));
}

/** Enregistre la durée de rétention (mois, minimum 6). */
export async function saveRetentionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await retentionSave({ months: formData.get("months") }, webActor(admin));
  if (r.ok) revalidatePath("/settings/alerts");
  back(backParams(r));
}

/**
 * Enregistre les seuils et les interrupteurs « Alerte activée » des alertes sur les chiffres (chute des inscriptions,
 * dépense sans inscription, canal qui perd ses membres) dans le même réglage, sans perdre ses autres clés. Une alerte
 * désactivée n'est plus évaluée par le worker ; une alerte ouverte de ce type se ferme au passage suivant.
 */
export async function saveAlertThresholdsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await alertThresholdsSave(
    {
      registrationsDropPct: formData.get("registrationsDropPct"),
      spendNoConversionEur: String(formData.get("spendNoConversionEur") ?? ""),
      channelLeakPct: formData.get("channelLeakPct"),
      enabled: switchesFromForm(formData),
    },
    webActor(admin),
  );
  if (r.ok) revalidatePath("/settings/alerts");
  back(backParams(r));
}

/** Lance la purge de rétention maintenant (tâche du worker). */
export async function purgeNowAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await purgeNow({}, webActor(admin));
  if (r.ok) revalidatePath("/settings/alerts");
  back(backParams(r));
}

/** Lance un passage d'alertes maintenant. */
export async function checkAlertsNowAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await alertsCheckNow({}, webActor(admin));
  if (r.ok) revalidatePath("/settings/alerts");
  back(backParams(r));
}
