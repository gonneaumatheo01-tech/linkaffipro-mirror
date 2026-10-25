"use server";

import { revalidatePath } from "next/cache";
import { backTo } from "@/lib/agents/redirect";
import {
  runAddCasinoTheme,
  runClassifyCasinoMedia,
  runCreateCasinoTestPost,
  runRemoveCasinoTheme,
  runRenameCasinoTheme,
} from "@/lib/site-ops/ops/lot-d/casino";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche d'équipe Casino (phase 22). Classer un média et produire un post de test : ADMIN et MANAGER.
 * Liste des thèmes (ajout, renommage, retrait) : ADMIN seulement. Chaque action laisse sa trace dans `AuditLog`
 * (le classement est journalisé par le moteur, `classifyCasinoMedia`). Phase 34 : logique dans les cœurs uniques
 * (`@/lib/site-ops/ops/lot-d/casino`), que Kevin appelle aussi.
 */

const CASINO = "/agents/casino";

type Result = { ok: true; message: string } | { ok: false; error: string };

function finish(r: Result, hash: string): never {
  if (r.ok) revalidatePath(CASINO);
  backTo(CASINO, r.ok ? { ok: r.message } : { error: r.error }, hash);
}

/** Classe un média « à classer » (ou en change les thèmes) depuis la fiche. */
export async function classifyCasinoMediaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runClassifyCasinoMedia(formData, siteActor(user)), "#a-classer");
}

/** « Produire un post de test » (vidéo, image ou texte) : simulation, canal Test. */
export async function createCasinoTestPostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const r = await runCreateCasinoTestPost(formData, siteActor(user));
  if (r.ok || r.code === "conflict") revalidatePath("/agents", "layout");
  backTo(CASINO, r.ok ? { ok: r.message } : { error: r.error }, "#production");
}

export async function addCasinoThemeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runAddCasinoTheme(formData, siteActor(user)), "#themes");
}

export async function renameCasinoThemeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runRenameCasinoTheme(formData, siteActor(user)), "#themes");
}

export async function removeCasinoThemeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(await runRemoveCasinoTheme(formData, siteActor(user)), "#themes");
}
