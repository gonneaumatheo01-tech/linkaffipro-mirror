"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { requireAdmin } from "@/lib/session";
import { detectPlayerColumns, parseCsv, rowsToPostbackParams } from "@/lib/postback/csv";
import { DEFAULT_MAPPING, parsePostback } from "@/lib/postback/parse";
import { applyParsedPostback } from "@/lib/postback/apply";

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

const MAX_BYTES = 5 * 1024 * 1024;

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
  if (file.size > MAX_BYTES)
    return { step: "upload", error: "Fichier trop volumineux (5 Mo maximum)." };
  const text = await file.text();
  try {
    const rows = parseCsv(text);
    if (rows.length < 2)
      return {
        step: "upload",
        error: "Le fichier ne contient aucune ligne de données sous l'en-tête.",
      };
    const columns = detectPlayerColumns(rows[0]!);
    const params = rowsToPostbackParams(rows.slice(1), columns);
    let invalid = 0;
    for (const p of params) {
      try {
        parsePostback(p, DEFAULT_MAPPING);
      } catch {
        invalid++;
      }
    }
    await audit({
      userId: admin.id,
      action: "postback.players_previewed",
      metadata: { programId: programId.data, filename: file.name, rows: params.length, invalid },
    });
    return {
      step: "preview",
      error: null,
      filename: file.name,
      programId: programId.data,
      csvB64: Buffer.from(text, "utf8").toString("base64"),
      headers: rows[0]!,
      rows: rows.slice(1, 21),
      total: rows.length - 1,
      columns,
      invalid,
    };
  } catch (err) {
    return {
      step: "upload",
      error:
        err instanceof Error
          ? err.message
          : "Le fichier est illisible : exportez-le de nouveau au format CSV.",
    };
  }
}

/** Étape 2 : import idempotent via la même logique que les postbacks. */
export async function importPlayersAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const admin = await requireAdmin();
  const programId = z.string().min(1).parse(formData.get("programId"));
  const filename = String(formData.get("filename") ?? "import.csv").slice(0, 120);
  const text = Buffer.from(String(formData.get("csvB64") ?? ""), "base64").toString("utf8");
  const program = await prisma.affiliateProgram.findUnique({
    where: { id: programId },
    select: { id: true, name: true },
  });
  if (!program) return { step: "upload", error: "Programme introuvable." };
  const rows = parseCsv(text);
  if (rows.length < 2) return { step: "upload", error: "Le fichier est vide." };
  const columns = detectPlayerColumns(rows[0]!);
  const params = rowsToPostbackParams(rows.slice(1), columns);
  const endpoint = {
    id: `import:${program.id}`,
    name: `Import CSV — ${program.name}`,
    programId: program.id,
    mapping: DEFAULT_MAPPING,
    isActive: true,
  };
  let imported = 0;
  let ignored = 0;
  const errors: string[] = [];
  for (const [i, p] of params.entries()) {
    try {
      const parsed = parsePostback(p, DEFAULT_MAPPING);
      const r = await applyParsedPostback(endpoint, parsed);
      if (r.status === "ACCEPTED") imported++;
      else if (r.status === "IGNORED") ignored++;
      else errors.push(`ligne ${i + 2} : ${r.message}`);
    } catch (err) {
      errors.push(`ligne ${i + 2} : ${err instanceof Error ? err.message : "erreur"}`);
    }
    if (errors.length > 200) {
      errors.push("… (arrêt de la liste des erreurs)");
      break;
    }
  }
  await prisma.importBatch.create({
    data: {
      kind: "PLAYERS_CSV",
      filename,
      rows: params.length,
      imported,
      errors: toJsonValue(errors.slice(0, 200)),
      createdById: admin.id,
    },
  });
  await audit({
    userId: admin.id,
    action: "postback.players_imported",
    entityType: "AffiliateProgram",
    entityId: program.id,
    metadata: { filename, rows: params.length, imported, ignored, errors: errors.length },
  });
  revalidatePath("/settings/postbacks");
  return { step: "done", error: null, imported, ignored, errors, total: params.length };
}
