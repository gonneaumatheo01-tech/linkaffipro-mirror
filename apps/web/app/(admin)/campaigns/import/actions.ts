"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import type { Platform } from "@/lib/campaigns/csv";
import { backUrl, formInput, webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import {
  IMPORT_MAX_BYTES,
  confirmImport,
  previewImport,
  type ImportPreview,
  type PlatformChoice,
} from "@/lib/site-ops/ops/lot-c/imports";

export type { Platform, PlatformChoice };

export type PreviewState = {
  error: string | null;
  preview: null | ImportPreview;
};

/**
 * Import des dépenses pub par fichier CSV. Toute la règle est dans les cœurs de la phase 34
 * (`lib/site-ops/ops/lot-c/imports.ts`), appelés aussi par Kevin (document CSV envoyé dans Telegram).
 */

/** Étape 1 : lecture du fichier, détection de la plateforme et des colonnes, aperçu et correspondances. */
export async function previewImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const user = await requireUser();
  const input = formInput(formData);
  delete input.file;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > IMPORT_MAX_BYTES)
      return { error: "Fichier trop volumineux (2 Mo maximum).", preview: null };
    input.csvB64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    input.filename = file.name;
  }
  const r = await previewImport(input, webActorOf(user));
  if (!r.ok) return { error: r.error, preview: null };
  return { error: null, preview: r.data?.preview as ImportPreview };
}

/** Étape 2 : import confirmé (création des pubs manquantes, coûts par jour, mémorisation des colonnes, rapport). */
export async function confirmImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  z.string().min(1).parse(formData.get("csvB64"));
  const input = formInput(formData);
  if (!input.filename) input.filename = "import.csv";
  const r = await confirmImport(input, webActorOf(user));
  redirect(r.back ? backUrl(r.back) : "/campaigns/import");
}
