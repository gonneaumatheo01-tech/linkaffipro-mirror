"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";

function back(params: Record<string, string>): never {
  redirect(`/settings/reports?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/** Enregistre l'activation et l'heure d'envoi des rapports (Setting `reports.config`). */
export async function saveReportsConfigAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ hour: z.coerce.number().int().min(0).max(23) })
    .safeParse({ hour: formData.get("hour") });
  if (!parsed.success) back({ error: "L'heure doit être un nombre entre 0 et 23." });
  const config = {
    daily: formData.get("daily") === "on",
    weekly: formData.get("weekly") === "on",
    hour: parsed.data.hour,
  };
  await prisma.setting.upsert({
    where: { key: "reports.config" },
    create: { key: "reports.config", value: config },
    update: { value: config },
  });
  await audit({ userId: admin.id, action: "settings.reports_changed", metadata: config });
  revalidatePath("/settings/reports");
  back({
    ok: `Rapports enregistrés : résumé quotidien ${config.daily ? "activé" : "désactivé"}, rapport hebdomadaire ${config.weekly ? "activé" : "désactivé"}, envoi à ${config.hour} h.`,
  });
}

/** Envoie immédiatement le brief ou le rapport (tâche du worker). */
export async function sendReportNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const kind = formData.get("kind") === "weekly" ? "weekly" : "daily";
  try {
    await enqueue(
      "stats",
      { type: "reports", force: kind },
      { jobId: `stats-reports-manual-${kind}-${Date.now()}` },
    );
    await audit({ userId: admin.id, action: "reports.send_requested", metadata: { kind } });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer l'envoi pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
    });
  }
  revalidatePath("/settings/reports");
  back({
    ok: `${kind === "weekly" ? "Rapport hebdomadaire" : "Résumé quotidien"} en cours d'envoi sur Telegram (quelques secondes). Rechargez la page pour voir le texte envoyé.`,
  });
}
