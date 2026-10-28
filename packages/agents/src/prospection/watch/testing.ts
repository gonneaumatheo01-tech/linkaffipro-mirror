/**
 * Phase 32, chantier A — outils des tests du Veilleur et des réseaux (fixtures `fixtures/prospection/watch/`, aucun
 * réseau). Jamais importé par le code de production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProspectPost } from "../contract";
import type { SnapshotPoint } from "../contract-advanced";

export const WATCH_FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "prospection", "watch");
export const WATCH_NOW = new Date("2026-10-26T09:00:00Z");

export function readWatchFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(WATCH_FIXTURES_DIR, name), "utf8")) as T;
}

type RawPoint = Partial<Record<keyof SnapshotPoint, unknown>>;

/** Point d'historique : `base` complété (dates ISO → Date). */
export function pointOf(base: RawPoint, over: RawPoint): SnapshotPoint {
  const m = { ...base, ...over } as Record<string, unknown>;
  const d = (v: unknown) => (typeof v === "string" ? new Date(v) : (v as Date | null) ?? null);
  return { ...(m as unknown as SnapshotPoint), takenAt: d(m.takenAt) ?? WATCH_NOW, lastPostAt: d(m.lastPostAt) };
}

/** Posts simulés (texte, liens, boutons), du plus récent au plus ancien, un par jour. */
export function postsOf(raw: Array<{ text: string; links?: string[]; buttons?: Array<{ text: string; url: string }>; forwardedFrom?: string | null; signature?: string | null }>, now = WATCH_NOW): ProspectPost[] {
  return raw.map((r, i) => ({
    id: 100 - i,
    postedAt: new Date(now.getTime() - (i + 1) * 86_400_000),
    text: r.text,
    mediaKind: "text",
    views: 1000,
    forwardedFrom: r.forwardedFrom ?? null,
    comments: null,
    reactions: null,
    buttons: r.buttons ?? [],
    signature: r.signature ?? null,
    links: r.links ?? [],
    mentions: [],
  }));
}
