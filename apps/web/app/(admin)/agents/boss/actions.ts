"use server";

import { revalidatePath } from "next/cache";
import { BOSS_PATH } from "@/lib/agents/boss";
import { backTo } from "@/lib/agents/redirect";
import { runSaveBossBudget, runSaveBossName } from "@/lib/site-ops/ops/lot-d/boss";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireAdmin } from "@/lib/session";

// Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/boss`), que Kevin appelle aussi.

function finish(r: { ok: true; message: string } | { ok: false; error: string }): never {
  if (!r.ok) backTo(BOSS_PATH, { error: r.error });
  revalidatePath(BOSS_PATH);
  backTo(BOSS_PATH, { ok: r.message });
}

/** Plafond mensuel de l'IA de Kevin (ADMIN, journal `boss.budget_saved`). */
export async function saveBossBudgetAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  finish(await runSaveBossBudget(formData, siteActor(admin)));
}

/** Prénom affiché du Boss (ADMIN, journal `boss.name_saved`). */
export async function saveBossNameAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  finish(await runSaveBossName(formData, siteActor(admin)));
}
