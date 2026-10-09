"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";

function back(params: Record<string, string>): never {
  redirect(`/settings/connectors?${new URLSearchParams(params).toString()}`);
}

/** Enfile un passage de synchronisation Link Affi (incrémental ou complet). */
export async function syncNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const full = formData.get("full") === "1";
  try {
    await enqueue(
      "sync-linkaffi",
      { type: "tick", full },
      { jobId: `sync-linkaffi:manual:${Date.now()}` },
    );
    await audit({
      userId: admin.id,
      action: full ? "linkaffi.sync_full_requested" : "linkaffi.sync_requested",
    });
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    back({
      error: `Impossible de lancer la synchronisation pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
    });
  }
  revalidatePath("/settings/connectors");
  back({
    ok: full
      ? "Resynchronisation complète lancée : comptez plusieurs minutes, puis rechargez la page."
      : "Synchronisation lancée : rechargez la page dans une minute.",
  });
}

const thresholdsSchema = z.object({
  vip: z.coerce.number().min(0).max(1_000_000),
  regularDeposits: z.coerce.number().int().min(1).max(1000),
});

/** Seuils du niveau de dépense (Setting `spend.thresholds`). */
export async function saveSpendThresholdsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = thresholdsSchema.safeParse({
    vip: formData.get("vip"),
    regularDeposits: formData.get("regularDeposits"),
  });
  if (!parsed.success)
    back({
      error:
        "Seuils invalides : le seuil VIP doit être un montant positif et le nombre de dépôts un entier d'au moins 1.",
    });
  await prisma.setting.upsert({
    where: { key: "spend.thresholds" },
    create: { key: "spend.thresholds", value: parsed.data },
    update: { value: parsed.data },
  });
  await audit({ userId: admin.id, action: "settings.spend_thresholds", metadata: parsed.data });
  revalidatePath("/settings/connectors");
  back({ ok: "Seuils enregistrés." });
}
