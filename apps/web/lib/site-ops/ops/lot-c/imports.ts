/**
 * Phase 34, lot C : cœurs de l'import des dépenses pub par fichier CSV (`app/(admin)/campaigns/import/actions.ts`).
 * Site : fichier choisi dans le formulaire (base64) ; Kevin : document CSV envoyé dans Telegram (`file.text`). Même
 * lecture (plateforme, colonnes manuelles > mémorisées > détectées, formats), même aperçu (lignes, erreurs), même import.
 */
import { revalidatePath } from "next/cache";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  applySavedMapping,
  columnSamples,
  detectColumns,
  detectDateFormat,
  detectNumberFormat,
  detectPlatform,
  importReportText,
  mappingToSaved,
  parseCsv,
  skippedSummary,
  skippedToReportLines,
  toCostRows,
  type ColumnMap,
  type CostField,
  type CostRow,
  type DateFormat,
  type NumberFormat,
  type Platform,
  type PlatformDetection,
  type SavedMapping,
  type SkippedRow,
} from "@/lib/campaigns/csv";
import { levelKey, matchRow, type CampaignTree, type RowMatch } from "@/lib/campaigns/match";
import { apiFedCampaignIds, campaignTree } from "@/lib/campaigns/queries";
import { done, fail, preview, str, toFormData, withVia, type Core, type CoreResult } from "./common";

/** Choix de plateforme dans le formulaire : automatique (détection par les en-têtes) ou imposée. */
export type PlatformChoice = "AUTO" | Platform;

export type ImportPreview = {
  /** Choix de l'utilisateur (AUTO = détection). */
  platformChoice: PlatformChoice;
  /** Plateforme retenue pour la lecture. */
  platform: Platform;
  detected: PlatformDetection;
  filename: string;
  csvB64: string;
  headers: string[];
  /** Cinq premières lignes brutes, pour l'aperçu colonne → champ. */
  rawSample: string[][];
  map: ColumnMap;
  /** D'où vient la correspondance proposée : mémoire d'un import précédent, détection, ou choix manuel. */
  mappingSource: "saved" | "detected" | "manual";
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
  /** Formats devinés (avant éventuel choix manuel). */
  detectedNumberFormat: NumberFormat;
  detectedDateFormat: DateFormat;
  totalRows: number;
  sample: CostRow[];
  errors: string[];
  skipped: SkippedRow[];
  skippedSummary: ReturnType<typeof skippedSummary>;
  matches: Array<{ key: string; count: number; spend: number; match: RowMatch }>;
};

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const FIELDS: CostField[] = [
  "date",
  "campaign",
  "adset",
  "ad",
  "spend",
  "impressions",
  "clicks",
  "currency",
];
const PLATFORM_CHOICES: PlatformChoice[] = ["AUTO", "TIKTOK", "META", "OTHER"];

const mappingKey = (platform: Platform) => `import.costs.mapping.${platform}`;

function platformChoiceOf(v: unknown): PlatformChoice {
  return PLATFORM_CHOICES.includes(String(v) as PlatformChoice)
    ? (String(v) as PlatformChoice)
    : "AUTO";
}

function numberFormatOf(v: unknown): NumberFormat | null {
  return v === "fr" || v === "en" || v === "auto" ? v : null;
}

function dateFormatOf(v: unknown): DateFormat | null {
  return v === "dmy" || v === "mdy" || v === "ymd" || v === "auto" ? v : null;
}

/**
 * Correspondance saisie à la main : un champ `map_<indice de colonne>` par colonne, valeur = champ ou vide.
 * Renvoie null si aucun champ n'a été envoyé (premier passage).
 */
function readManualMapping(formData: FormData, headers: string[]): ColumnMap | null {
  const map: ColumnMap = {};
  let any = false;
  headers.forEach((_, i) => {
    const v = formData.get(`map_${i}`);
    if (typeof v !== "string") return;
    any = true;
    if (v !== "" && FIELDS.includes(v as CostField) && !(v in map)) map[v as CostField] = i;
  });
  return any ? map : null;
}

async function loadSavedMapping(platform: Platform): Promise<SavedMapping | null> {
  const row = await prisma.setting.findUnique({ where: { key: mappingKey(platform) } });
  return row && row.value && typeof row.value === "object" && !Array.isArray(row.value)
    ? (row.value as SavedMapping)
    : null;
}

/** Lecture complète d'un fichier : plateforme, correspondance (manuelle > mémorisée > détectée), formats, lignes. */
async function readCsv(formData: FormData, csvB64: string) {
  const text = Buffer.from(csvB64, "base64").toString("utf8");
  const table = parseCsv(text);
  if (table.headers.length === 0) return null;
  const platformChoice = platformChoiceOf(formData.get("platform"));
  const detected = detectPlatform(table.headers);
  const platform: Platform = platformChoice === "AUTO" ? detected.platform : platformChoice;
  const manual = readManualMapping(formData, table.headers);
  const saved = manual ? null : applySavedMapping(table.headers, await loadSavedMapping(platform));
  const map = manual ?? saved ?? detectColumns(table.headers);
  const mappingSource: "saved" | "detected" | "manual" = manual
    ? "manual"
    : saved
      ? "saved"
      : "detected";
  const detectedNumberFormat = detectNumberFormat(columnSamples(table, map.spend));
  const detectedDateFormat = detectDateFormat(columnSamples(table, map.date), platform);
  const numberFormat = numberFormatOf(formData.get("numberFormat")) ?? detectedNumberFormat;
  const dateFormat = dateFormatOf(formData.get("dateFormat")) ?? detectedDateFormat;
  const parsed = toCostRows(table, map, platform, { numberFormat, dateFormat });
  return {
    table,
    platformChoice,
    platform,
    detected,
    map,
    mappingSource,
    numberFormat,
    dateFormat,
    detectedNumberFormat,
    detectedDateFormat,
    ...parsed,
  };
}

function summarize(rows: CostRow[], tree: CampaignTree) {
  const groups = new Map<string, { key: string; count: number; spend: number; match: RowMatch }>();
  for (const r of rows) {
    const key = `${r.campaign}|${r.adset}|${r.ad}`;
    const g = groups.get(key) ?? { key, count: 0, spend: 0, match: matchRow(r, tree) };
    g.count++;
    g.spend += r.spend;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}

/** Fichier de l'entrée : base64 du site (`csvB64`) ou texte du document envoyé à Kevin (`file.text`). */
function fileOf(input: Record<string, unknown>): { csvB64: string; filename: string } | CoreResult {
  const file = input.file as { text?: unknown; fileName?: unknown; sizeBytes?: unknown } | undefined;
  if (file && typeof file === "object" && typeof file.text === "string") {
    const bytes = Buffer.byteLength(file.text, "utf8");
    if (bytes > IMPORT_MAX_BYTES) return fail("Fichier trop volumineux (2 Mo maximum).", null);
    return {
      csvB64: Buffer.from(file.text, "utf8").toString("base64"),
      filename: str(file.fileName) || str(input.filename) || "import.csv",
    };
  }
  return { csvB64: str(input.csvB64), filename: str(input.filename) };
}

/** Phrase d'aperçu (Kevin) : lignes lues, ignorées, campagnes reconnues ou à créer, erreurs. */
function previewSummary(p: ImportPreview): string {
  const total = p.matches.reduce((s, m) => s + m.spend, 0);
  const toCreate = p.matches.filter((m) => !m.match.campaign.id).length;
  const platform = p.platform === "TIKTOK" ? "TikTok" : p.platform === "META" ? "Meta" : "autre plateforme";
  return [
    `Fichier ${p.filename} (${platform}) : ${p.totalRows} ligne(s) importable(s), ${p.skipped.length} ignorée(s), ${total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € de dépense.`,
    `${p.matches.length} campagne(s) / groupe(s) / pub(s)${toCreate ? `, dont ${toCreate} à créer` : ""}.`,
    p.errors.length ? `Erreurs : ${p.errors.slice(0, 3).join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function buildPreview(
  input: Record<string, unknown>,
): Promise<{ ok: true; preview: ImportPreview; read: NonNullable<Awaited<ReturnType<typeof readCsv>>> } | CoreResult> {
  const f = fileOf(input);
  if ("ok" in f) return f;
  if (!f.csvB64) return fail("Choisissez d'abord un fichier CSV.", null, { field: "file" });
  const read = await readCsv(toFormData(input), f.csvB64);
  if (!read)
    return fail("Le fichier est vide ou illisible : exportez-le de nouveau au format CSV.", null, {
      field: "file",
    });
  const tree = await campaignTree();
  return {
    ok: true,
    read,
    preview: {
      platformChoice: read.platformChoice,
      platform: read.platform,
      detected: read.detected,
      filename: f.filename,
      csvB64: f.csvB64,
      headers: read.table.headers,
      rawSample: read.table.rows.slice(0, 5),
      map: read.map,
      mappingSource: read.mappingSource,
      numberFormat: read.numberFormat,
      dateFormat: read.dateFormat,
      detectedNumberFormat: read.detectedNumberFormat,
      detectedDateFormat: read.detectedDateFormat,
      totalRows: read.rows.length,
      sample: read.rows.slice(0, 20),
      errors: read.errors.slice(0, 20),
      skipped: read.skipped.slice(0, 200),
      skippedSummary: skippedSummary(read.skipped),
      matches: summarize(read.rows, tree).slice(0, 200),
    },
  };
}

/** Étape 1 : lecture du fichier, détection de la plateforme et des colonnes, aperçu et correspondances (journalisé). */
export const previewImport: Core = async (input, actor, opts = {}) => {
  const b = await buildPreview(input);
  if (!("read" in b)) return b;
  const { preview: p, read } = b;
  // Essai à blanc (Kevin le fait avant chaque lecture) : rien n'est écrit, pas même le journal.
  if (opts.dryRun) return done(previewSummary(p), null, { preview: p });
  await audit({
    userId: actor.userId,
    action: "import.costs_previewed",
    metadata: withVia(actor, {
      platform: read.platform,
      detectedPlatform: read.detected.platform,
      confidence: read.detected.confidence,
      filename: p.filename,
      rows: read.rows.length,
      skipped: read.skipped.length,
    }),
  });
  return done(previewSummary(p), null, { preview: p });
};

/** Étape 2 : import confirmé (création des pubs manquantes, coûts par jour, mémorisation des colonnes, rapport). */
export const confirmImport: Core = async (input, actor, opts = {}) => {
  const f = fileOf(input);
  if ("ok" in f) return f;
  const filename = f.filename || "import.csv";
  const NOTHING = "Aucune ligne importable : vérifiez les colonnes date et dépense.";
  const nothing = () =>
    fail(NOTHING, { path: "/campaigns/import", params: { error: NOTHING } });
  if (!f.csvB64) return nothing();
  if (opts.dryRun) {
    const b = await buildPreview({ ...input, csvB64: f.csvB64, filename });
    if (!("read" in b)) return b;
    if (b.read.rows.length === 0) return nothing();
    return {
      ...preview(previewSummary(b.preview)),
      data: { preview: { ...b.preview, csvB64: "" } },
    };
  }
  const read = await readCsv(toFormData(input), f.csvB64);
  if (!read || read.rows.length === 0) return nothing();
  const { platform, rows, skipped, map, table } = read;

  const batch = await prisma.importBatch.create({
    data: {
      kind:
        platform === "META" ? "META_CSV" : platform === "TIKTOK" ? "TIKTOK_CSV" : "COSTS_MANUAL",
      filename,
      rows: table.rows.length,
      createdById: actor.userId,
    },
  });
  const tree = await campaignTree();
  // Campagnes alimentées par l'API d'un compte connecté (Meta / TikTok) : rattachées à une campagne pub de ce compte,
  // ou ayant déjà reçu des coûts API. L'API a priorité, le fichier est ignoré pour elles. Un compte choisi sans
  // campagne pub (aucun coût API encore) n'empêche pas l'import.
  const apiFed = await apiFedCampaignIds();
  const resolved = new Map<string, { campaignId: string; adSetId?: string; adId?: string }>();
  let imported = 0;
  let failed = 0;
  const importErrors: string[] = [];

  for (const r of rows) {
    const key = `${r.campaign}|${r.adset}|${r.ad}`;
    let level = resolved.get(key);
    if (!level) {
      const m = matchRow(r, tree);
      let campaignId = m.campaign.id;
      if (!campaignId) {
        const c = await prisma.campaign.create({
          data: { name: m.campaign.name, adPlatform: platform, status: "ACTIVE" },
        });
        campaignId = c.id;
        tree.push({ id: c.id, name: c.name, adSets: [] });
      }
      const tc = tree.find((c) => c.id === campaignId)!;
      let adSetId: string | undefined;
      let adId: string | undefined;
      if (m.adset) {
        adSetId = m.adset.id ?? undefined;
        if (!adSetId) {
          const s = await prisma.adSet.create({ data: { campaignId, name: m.adset.name } });
          adSetId = s.id;
          tc.adSets.push({ id: s.id, name: s.name, ads: [] });
        }
        const ts = tc.adSets.find((s) => s.id === adSetId)!;
        if (m.ad) {
          adId = m.ad.id ?? undefined;
          if (!adId) {
            const a = await prisma.ad.create({ data: { adSetId, name: m.ad.name } });
            adId = a.id;
            ts.ads.push({ id: a.id, name: a.name });
          }
        }
      }
      level = { campaignId, adSetId, adId };
      resolved.set(key, level);
    }
    if (apiFed.has(level.campaignId)) {
      failed++;
      importErrors.push(
        `${r.date} ${key} : campagne alimentée par l'API (Meta / TikTok) : ligne ignorée, l'API a priorité`,
      );
      continue;
    }
    const lvl = level.adId
      ? { adId: level.adId }
      : level.adSetId
        ? { adSetId: level.adSetId }
        : { campaignId: level.campaignId };
    const k = levelKey(lvl);
    const date = new Date(`${r.date}T00:00:00.000Z`);
    try {
      await prisma.adCost.upsert({
        where: { levelKey_date_source: { levelKey: k, date, source: "CSV" } },
        create: {
          ...lvl,
          levelKey: k,
          date,
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          currency: r.currency ?? "EUR",
          source: "CSV",
          importBatchId: batch.id,
        },
        update: {
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          currency: r.currency ?? "EUR",
          importBatchId: batch.id,
        },
      });
      imported++;
    } catch (err) {
      failed++;
      importErrors.push(`${r.date} ${key} : ${err instanceof Error ? err.message : "erreur"}`);
    }
  }
  const report = [...skippedToReportLines(skipped), ...importErrors];
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, errors: report.slice(0, 200) as unknown as Prisma.InputJsonValue },
  });
  // Mémorise la correspondance colonne → champ pour la prochaine fois (par plateforme).
  const saved = mappingToSaved(table.headers, map);
  await prisma.setting.upsert({
    where: { key: mappingKey(platform) },
    create: { key: mappingKey(platform), value: saved },
    update: { value: saved },
  });
  const summary = importReportText(imported, skipped, failed);
  await audit({
    userId: actor.userId,
    action: "import.costs",
    entityType: "ImportBatch",
    entityId: batch.id,
    metadata: withVia(actor, {
      platform,
      filename,
      rows: table.rows.length,
      imported,
      skipped: skipped.length,
      failed,
      numberFormat: read.numberFormat,
      dateFormat: read.dateFormat,
    }),
  });
  // Coûts de jours anciens (hors fenêtre du recalcul horaire) : recalcul complet des statistiques journalières.
  await refreshCampaignStats();
  revalidatePath("/campaigns");
  const ok = `Import de ${filename} terminé : ${summary}.`;
  return done(ok, { path: "/campaigns/imports", params: { batch: batch.id, ok } }, {
    batchId: batch.id,
    imported,
    failed,
    skipped: skipped.length,
  });
};
