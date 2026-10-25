"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { linkaffiSyncNow, ratesSave, spendThresholdsSave } from "@/lib/site-ops/ops/lot-e/connectors-linkaffi";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/connectors-linkaffi.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/connectors?${new URLSearchParams(params).toString()}`);
}

/** Enfile un passage de synchronisation Link Affi (incrémental ou complet). */
export async function syncNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await linkaffiSyncNow({ full: formData.get("full") === "1" }, webActor(admin));
  if (r.ok) revalidatePath("/settings/connectors");
  back(backParams(r));
}

/** Seuils du niveau de dépense (Setting `spend.thresholds`). */
export async function saveSpendThresholdsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await spendThresholdsSave(
    { vip: formData.get("vip"), regularDeposits: formData.get("regularDeposits") },
    webActor(admin),
  );
  if (r.ok) revalidatePath("/settings/connectors");
  back(backParams(r));
}

/** Taux de change saisis (« USD=1.08, GBP=0.85 » : unités pour 1 €), prioritaires sur ceux de Link Affi. */
export async function saveRatesAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const r = await ratesSave({ rates: String(formData.get("rates") ?? "") }, webActor(user));
  if (r.ok) revalidatePath("/settings/connectors");
  back(backParams(r));
}
