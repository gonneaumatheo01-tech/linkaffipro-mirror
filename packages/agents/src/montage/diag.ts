/**
 * Phase 28, chantier D — diagnostic du montage (`pnpm montage:diag`) : ffmpeg (version, codecs, filtres), place libre
 * du dossier de travail, file `agents-montage`, dernier montage. Tableau en français ; code 1 si un point bloque.
 */
import { mkdir, statfs } from "node:fs/promises";
import { MONTAGE_LIMITS, type FfmpegRunner } from "./contract";
import type { MontagePipelineDeps } from "./runtime";

export type MontageDiagRow = { label: string; ok: boolean; detail: string; blocking?: boolean };

export const DIAG_CODECS = [
  { name: "h264", encoder: "libx264", label: "H.264 (libx264)" },
  { name: "hevc", encoder: "libx265", label: "H.265 (libx265)", optional: true },
  { name: "aac", encoder: "aac", label: "AAC" },
] as const;
export const DIAG_FILTERS = ["drawtext", "overlay", "scale", "pad", "subtitles", "blackdetect"] as const;

/** Place libre minimale du dossier de travail : une vidéo de 2 Go + ses shorts. */
export const MIN_FREE_BYTES = 3 * 1024 ** 3;

export type MontageDiagDeps = {
  ffmpeg: FfmpegRunner | null;
  workDir?: string;
  prisma?: MontagePipelineDeps["prisma"] | null;
  /** Taille de la file (BullMQ `getJobCounts`) ; null : Redis injoignable. */
  queueCounts?: () => Promise<Record<string, number> | null>;
  /** Place libre (octets) ; par défaut `statfs`. */
  freeBytes?: (dir: string) => Promise<number>;
};

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
  return `${Math.round(n / 1024 ** 2)} Mo`;
}

/** Encodeurs annoncés par `ffmpeg -encoders` (pur). */
export function parseEncoders(stdout: string): Set<string> {
  const out = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (m) out.add(m[1]!);
  }
  return out;
}

/** Filtres annoncés par `ffmpeg -filters` (pur). */
export function parseFilters(stdout: string): Set<string> {
  const out = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*[TSC.]{2,3}\s+(\S+)\s+\S+->\S+/.exec(line);
    if (m) out.add(m[1]!);
  }
  return out;
}

async function defaultFree(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/**
 * Les listes (`-version`, `-encoders`, `-filters`) partent sur la sortie standard : elles sont lues par `ffprobe`, qui
 * partage les bibliothèques de ffmpeg (mêmes codecs, mêmes filtres) et dont l'exécuteur rend la sortie standard.
 */
async function probeText(runner: FfmpegRunner, args: string[]): Promise<{ code: number; text: string }> {
  const r = await runner.ffprobe(["-hide_banner", ...args], { timeoutMs: 20_000 });
  return { code: r.code, text: `${r.stdout}\n${r.stderr}` };
}

export async function runMontageDiag(deps: MontageDiagDeps): Promise<{ ok: boolean; rows: MontageDiagRow[] }> {
  const rows: MontageDiagRow[] = [];
  if (!deps.ffmpeg) rows.push({ label: "ffmpeg", ok: false, detail: "introuvable", blocking: true });
  else {
    const v = await deps.ffmpeg.ffmpeg(["-hide_banner", "-version"], { timeoutMs: 20_000 }).catch((err: Error) => ({ code: 1, stderr: err.message }));
    const p = await probeText(deps.ffmpeg, ["-version"]).catch((err: Error) => ({ code: 1, text: err.message }));
    const version = /(?:ffprobe|ffmpeg) version (\S+)/.exec(p.text)?.[1];
    rows.push({ label: "ffmpeg", ok: v.code === 0, detail: v.code === 0 ? (version ? `version ${version}` : "présent") : "ne répond pas", blocking: true });
    rows.push({ label: "ffprobe", ok: p.code === 0, detail: p.code === 0 ? "présent" : "ne répond pas", blocking: true });
    if (p.code === 0) {
      const enc = parseEncoders((await probeText(deps.ffmpeg, ["-encoders"]).catch(() => ({ code: 1, text: "" }))).text);
      for (const c of DIAG_CODECS) {
        const has = enc.has(c.encoder);
        rows.push({ label: `codec ${c.label}`, ok: has, detail: has ? "présent" : "absent", blocking: !("optional" in c && c.optional) });
      }
      const filters = parseFilters((await probeText(deps.ffmpeg, ["-filters"]).catch(() => ({ code: 1, text: "" }))).text);
      for (const f of DIAG_FILTERS) rows.push({ label: `filtre ${f}`, ok: filters.has(f), detail: filters.has(f) ? "présent" : "absent", blocking: true });
    }
  }
  const dir = deps.workDir ?? MONTAGE_LIMITS.workDir;
  try {
    const free = await (deps.freeBytes ?? defaultFree)(dir);
    rows.push({ label: `place libre (${dir})`, ok: free >= MIN_FREE_BYTES, detail: `${fmtBytes(free)} (${fmtBytes(MIN_FREE_BYTES)} au moins)`, blocking: true });
  } catch (err) {
    rows.push({ label: `place libre (${dir})`, ok: false, detail: `illisible : ${(err as Error).message}`, blocking: true });
  }
  if (deps.queueCounts) {
    const counts = await deps.queueCounts().catch(() => null);
    if (!counts) rows.push({ label: "file agents-montage", ok: false, detail: "Redis injoignable", blocking: true });
    else {
      const waiting = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
      rows.push({
        label: "file agents-montage",
        ok: (counts.failed ?? 0) === 0,
        detail: `${waiting} en attente, ${counts.active ?? 0} en cours, ${counts.failed ?? 0} en échec`,
        blocking: false,
      });
    }
  }
  if (deps.prisma) {
    try {
      const last = await deps.prisma.montageJob.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, currentStep: true, createdAt: true, shortCount: true } });
      if (!last) rows.push({ label: "dernier montage", ok: true, detail: "aucun pour l'instant" });
      else {
        const when = last.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
        const err = last.error ? ` ; erreur : ${last.error.slice(0, 120)}` : "";
        rows.push({ label: "dernier montage", ok: last.status !== "FAILED", detail: `${last.status} (${last.currentStep ?? "—"}), ${last.shortCount} shorts, ${when}${err}`, blocking: false });
      }
    } catch (err) {
      rows.push({ label: "dernier montage", ok: false, detail: `base illisible : ${(err as Error).message.slice(0, 120)}`, blocking: true });
    }
  }
  return { ok: rows.every((r) => r.ok || r.blocking === false), rows };
}

/** Tableau texte (une ligne par point). */
export function formatMontageDiag(result: { ok: boolean; rows: MontageDiagRow[] }): string {
  const width = Math.max(...result.rows.map((r) => r.label.length), 10);
  const lines = result.rows.map((r) => `${r.ok ? "OK  " : r.blocking === false ? "NOTE" : "KO  "}  ${r.label.padEnd(width)}  ${r.detail}`);
  lines.push("", result.ok ? "Montage prêt." : "Montage pas prêt : voir les lignes KO.");
  return lines.join("\n");
}
