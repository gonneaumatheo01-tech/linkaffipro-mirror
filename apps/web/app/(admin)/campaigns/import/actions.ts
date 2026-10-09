"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import {
  detectColumns,
  parseCsv,
  toCostRows,
  type ColumnMap,
  type CostField,
  type CostRow,
} from "@/lib/campaigns/csv";
import { levelKey, matchRow, type CampaignTree, type RowMatch } from "@/lib/campaigns/match";
import { campaignTree } from "@/lib/campaigns/queries";

export type Platform = "TIKTOK" | "META" | "OTHER";

export type PreviewState = {
  error: string | null;
  preview: null | {
    platform: Platform;
    filename: string;
    csvB64: string;
    headers: string[];
    map: ColumnMap;
    totalRows: number;
    sample: CostRow[];
    errors: string[];
    matches: Array<{ key: string; count: number; spend: number; match: RowMatch }>;
  };
};

const MAX_BYTES = 2 * 1024 * 1024;
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

function readMapOverrides(formData: FormData, headers: string[], base: ColumnMap): ColumnMap {
  const map: ColumnMap = { ...base };
  for (const f of FIELDS) {
    const v = formData.get(`col_${f}`);
    if (typeof v !== "string") continue;
    if (v === "") delete map[f];
    else {
      const idx = Number(v);
      if (Number.isInteger(idx) && idx >= 0 && idx < headers.length) map[f] = idx;
    }
  }
  return map;
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

/** Étape 1 : lecture du fichier, détection des colonnes et aperçu des correspondances. */
export async function previewImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const user = await requireUser();
  const platform = (
    ["TIKTOK", "META", "OTHER"].includes(String(formData.get("platform")))
      ? String(formData.get("platform"))
      : "OTHER"
  ) as Platform;
  let csvB64 = String(formData.get("csvB64") ?? "");
  let filename = String(formData.get("filename") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES)
      return { error: "Fichier trop volumineux (2 Mo maximum).", preview: null };
    csvB64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    filename = file.name;
  }
  if (!csvB64) return { error: "Choisissez d'abord un fichier CSV.", preview: null };
  const text = Buffer.from(csvB64, "base64").toString("utf8");
  const table = parseCsv(text);
  if (table.headers.length === 0)
    return {
      error: "Le fichier est vide ou illisible : exportez-le de nouveau au format CSV.",
      preview: null,
    };
  const map = readMapOverrides(formData, table.headers, detectColumns(table.headers));
  const { rows, errors } = toCostRows(table, map, platform);
  const tree = await campaignTree();
  await audit({
    userId: user.id,
    action: "import.costs_previewed",
    metadata: { platform, filename, rows: rows.length, errors: errors.length },
  });
  return {
    error: null,
    preview: {
      platform,
      filename,
      csvB64,
      headers: table.headers,
      map,
      totalRows: rows.length,
      sample: rows.slice(0, 20),
      errors: errors.slice(0, 20),
      matches: summarize(rows, tree).slice(0, 200),
    },
  };
}

/** Étape 2 : import confirmé (création des pubs manquantes, coûts par jour, historique). */
export async function confirmImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const platform = z.enum(["TIKTOK", "META", "OTHER"]).parse(formData.get("platform"));
  const csvB64 = z.string().min(1).parse(formData.get("csvB64"));
  const filename = String(formData.get("filename") ?? "import.csv");
  const text = Buffer.from(csvB64, "base64").toString("utf8");
  const table = parseCsv(text);
  const map = readMapOverrides(formData, table.headers, detectColumns(table.headers));
  const { rows, errors } = toCostRows(table, map, platform);
  if (rows.length === 0)
    redirect(
      `/campaigns/import?${new URLSearchParams({ error: "Aucune ligne importable : vérifiez les colonnes date et dépense." })}`,
    );

  const batch = await prisma.importBatch.create({
    data: {
      kind:
        platform === "META" ? "META_CSV" : platform === "TIKTOK" ? "TIKTOK_CSV" : "COSTS_MANUAL",
      filename,
      rows: rows.length,
      createdById: user.id,
    },
  });
  let tree = await campaignTree();
  const resolved = new Map<string, { campaignId: string; adSetId?: string; adId?: string }>();
  let imported = 0;
  const importErrors: string[] = [...errors];

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
      importErrors.push(`${r.date} ${key} : ${err instanceof Error ? err.message : "erreur"}`);
    }
  }
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, errors: importErrors.slice(0, 100) as unknown as Prisma.InputJsonValue },
  });
  await audit({
    userId: user.id,
    action: "import.costs",
    entityType: "ImportBatch",
    entityId: batch.id,
    metadata: { platform, filename, rows: rows.length, imported },
  });
  tree = [];
  revalidatePath("/campaigns");
  redirect(
    `/campaigns/imports?${new URLSearchParams({ ok: `${imported} ligne${imported > 1 ? "s" : ""} de coût importée${imported > 1 ? "s" : ""} depuis ${filename}${importErrors.length ? ` (${importErrors.length} erreur${importErrors.length > 1 ? "s" : ""})` : ""}.` })}`,
  );
}
