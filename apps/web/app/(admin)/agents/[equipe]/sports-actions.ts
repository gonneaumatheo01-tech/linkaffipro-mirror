"use server";

import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/agents/redirect";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { runCreateTestBet, runSaveBetCategory } from "@/lib/site-ops/ops/lot-d/sports";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche Paris sportifs (phase 23). « Produire un pari de test » : ADMIN et MANAGER. Catégories : ADMIN
 * seulement. Chaque action laisse sa trace dans `AuditLog`.
 * Phase 34 : la logique est dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/sports`), que Kevin appelle aussi.
 */

const SPORTS = "/agents/sports";

type Result = { ok: true; message: string } | { ok: false; error: string; code?: string };

function finish(r: Result, hash: string, revalidate = r.ok): never {
  if (revalidate) revalidatePath(SPORTS);
  backTo(SPORTS, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

/** Crée ou modifie une catégorie de paris. */
export async function saveBetCategoryAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runSaveBetCategory(formData, siteActor(user)), "#categories");
}

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test. */
export async function createTestBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runCreateTestBet(formData, siteActor(user));
  if (r.ok || r.code === "conflict") revalidatePath("/agents", "layout");
  backTo(SPORTS, r.ok ? { ok: r.message } : { error: r.error }, "#paris");
}
