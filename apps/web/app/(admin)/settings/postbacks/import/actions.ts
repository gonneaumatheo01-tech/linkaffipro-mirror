"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { playersImport, playersImportPreview, type PlayersCsvAnalysis } from "@/lib/site-ops/ops/lot-e/postbacks";
import { webActor } from "@/lib/site-ops/ops/lot-e/common";

/** Phase 34 : chaque étape appelle le cœur unique (`lib/site-ops/ops/lot-e/postbacks.ts`), comme Kevin (fichier CSV). */
export type PreviewState =
  | { step: "upload"; error: string | null }
  | {
      step: "preview";
      error: string | null;
      filename: string;
      programId: string;
      csvB64: string;
      headers: string[];
      rows: string[][];
      total: number;
      columns: Record<string, number | null>;
      invalid: number;
    }
  | {
      step: "done";
      error: string | null;
      imported: number;
      ignored: number;
      errors: string[];
      total: number;
    };

/** Étape 1 : analyse du fichier et aperçu (aucune écriture). */
export async function previewPlayersImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const admin = await requireAdmin();
  const programId = z.string().min(1).safeParse(formData.get("programId"));
  const file = formData.get("file");
  if (!programId.success) return { step: "upload", error: "Choisissez d'abord un programme." };
  if (!(file instanceof File) || file.size === 0)
    return { step: "upload", error: "Choisissez d'abord un fichier CSV." };
  const text = await file.text();
  const r = await playersImportPreview(
    { programId: programId.data, csv: text, filename: file.name, size: file.size },
    webActor(admin),
  );
  if (!r.ok) return { step: "upload", error: r.error };
  const a = r.data as PlayersCsvAnalysis & { programId: string };
  return {
    step: "preview",
    error: null,
    filename: a.filename,
    programId: a.programId,
    csvB64: Buffer.from(text, "utf8").toString("base64"),
    headers: a.headers,
    rows: a.rows,
    total: a.total,
    columns: a.columns,
    invalid: a.invalid,
  };
}

/** Étape 2 : import idempotent via la même logique que les postbacks. */
export async function importPlayersAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const admin = await requireAdmin();
  const programId = z.string().min(1).parse(formData.get("programId"));
  const r = await playersImport(
    {
      programId,
      filename: String(formData.get("filename") ?? "import.csv"),
      csvB64: String(formData.get("csvB64") ?? ""),
    },
    webActor(admin),
  );
  if (!r.ok) return { step: "upload", error: r.error };
  const d = r.data as { imported: number; ignored: number; errors: string[]; total: number };
  revalidatePath("/settings/postbacks");
  return { step: "done", error: null, imported: d.imported, ignored: d.ignored, errors: d.errors, total: d.total };
}
