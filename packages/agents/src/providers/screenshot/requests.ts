/**
 * File des demandes de capture en base (phase 23, sans migration) : une ligne `Setting`
 * `agents.capture.request.<id>` par demande. Sert à trois choses :
 * - le site (sans navigateur) demande un test de connexion au worker ;
 * - en mode « Mac », l'agent Capture dépose la demande et `pnpm agents:capture-runner` la prend sur le Mac ;
 * - le résultat (capture rangée en `MediaAsset`, cote lue, erreur classée) revient par la même ligne.
 * Prise atomique par comparaison de `updatedAt` (deux preneurs ne prennent jamais la même demande).
 */
import { randomUUID } from "node:crypto";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { CaptureErrorKind, CaptureRequest, CaptureResult } from "../screenshot";
import { storeCapturePng } from "./store";

export const CAPTURE_REQUEST_PREFIX = "agents.capture.request.";
/** Une demande prise mais sans résultat depuis 10 min est rendue (le preneur s'est arrêté). */
export const CAPTURE_CLAIM_TTL_MS = 10 * 60_000;
/** Une demande sans preneur depuis 24 h est abandonnée. */
export const CAPTURE_REQUEST_MAX_AGE_MS = 24 * 3600_000;

export type CaptureTarget = "server" | "mac";
export type CaptureRequestStatus = "PENDING" | "CLAIMED" | "DONE";

export type CaptureRequestResult =
  | { ok: true; assetId: string; readOdds: number; pageUrl: string }
  | { ok: false; kind: CaptureErrorKind; message: string };

export type StoredCaptureRequest = {
  id: string;
  kind: "capture" | "test";
  target: CaptureTarget;
  status: CaptureRequestStatus;
  bookmaker: string;
  /** Demande de capture (dates en ISO) ; absente pour un test de connexion. */
  request: (Omit<CaptureRequest, "kickoffAt"> & { kickoffAt: string }) | null;
  missionId: string | null;
  /** Prévenir l'admin par Telegram à la fin (test lancé par le bot). */
  notifyAdmin: boolean;
  createdAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  doneAt: string | null;
  result: CaptureRequestResult | null;
};

type Row = { key: string; value: unknown; updatedAt: Date };

function parse(v: unknown): StoredCaptureRequest | null {
  if (!v || typeof v !== "object") return null;
  const o = v as StoredCaptureRequest;
  return typeof o.id === "string" && typeof o.status === "string" && typeof o.bookmaker === "string" ? o : null;
}

export function captureRequestKey(id: string): string {
  return `${CAPTURE_REQUEST_PREFIX}${id}`;
}

export function toCaptureRequest(s: StoredCaptureRequest): CaptureRequest | null {
  return s.request ? { ...s.request, kickoffAt: new Date(s.request.kickoffAt) } : null;
}

export async function createCaptureRequest(
  prisma: PrismaClient,
  i: { kind: "capture" | "test"; target: CaptureTarget; bookmaker: string; request?: CaptureRequest | null; missionId?: string | null; notifyAdmin?: boolean; now?: Date },
): Promise<StoredCaptureRequest> {
  const now = i.now ?? new Date();
  const value: StoredCaptureRequest = {
    id: randomUUID(),
    kind: i.kind,
    target: i.target,
    status: "PENDING",
    bookmaker: i.bookmaker,
    request: i.request ? { ...i.request, kickoffAt: i.request.kickoffAt.toISOString() } : null,
    missionId: i.missionId ?? null,
    notifyAdmin: i.notifyAdmin ?? false,
    createdAt: now.toISOString(),
    claimedAt: null,
    claimedBy: null,
    doneAt: null,
    result: null,
  };
  await prisma.setting.create({ data: { key: captureRequestKey(value.id), value: value as never } });
  return value;
}

export async function readCaptureRequest(prisma: PrismaClient, id: string): Promise<StoredCaptureRequest | null> {
  const row = await prisma.setting.findUnique({ where: { key: captureRequestKey(id) } });
  return parse(row?.value);
}

/** Compare-and-set : n'écrit que si la ligne n'a pas bougé depuis la lecture. */
async function swap(prisma: PrismaClient, row: Row, next: StoredCaptureRequest): Promise<boolean> {
  const r = await prisma.setting.updateMany({ where: { key: row.key, updatedAt: row.updatedAt }, data: { value: next as never } });
  return r.count === 1;
}

/** Prend la plus ancienne demande en attente pour cette cible (ou une prise abandonnée). */
export async function claimNextCaptureRequest(
  prisma: PrismaClient,
  target: CaptureTarget,
  by: string,
  now = new Date(),
): Promise<StoredCaptureRequest | null> {
  const rows = (await prisma.setting.findMany({ where: { key: { startsWith: CAPTURE_REQUEST_PREFIX } }, orderBy: { updatedAt: "asc" }, take: 200 })) as Row[];
  for (const row of rows) {
    const s = parse(row.value);
    if (!s || s.target !== target || s.status === "DONE") continue;
    const age = now.getTime() - new Date(s.createdAt).getTime();
    if (age > CAPTURE_REQUEST_MAX_AGE_MS) {
      await swap(prisma, row, { ...s, status: "DONE", doneAt: now.toISOString(), result: { ok: false, kind: "timeout", message: "demande de capture restée sans preneur" } });
      continue;
    }
    const stale = s.status === "CLAIMED" && s.claimedAt && now.getTime() - new Date(s.claimedAt).getTime() > CAPTURE_CLAIM_TTL_MS;
    if (s.status !== "PENDING" && !stale) continue;
    const next: StoredCaptureRequest = { ...s, status: "CLAIMED", claimedAt: now.toISOString(), claimedBy: by };
    if (await swap(prisma, row, next)) return next;
  }
  return null;
}

/** Résultat d'une demande : la capture est rangée (SCREENSHOT / HUMAN_SITE) et la ligne passe à DONE. */
export async function completeCaptureRequest(
  prisma: PrismaClient,
  id: string,
  result: CaptureResult,
  now = new Date(),
): Promise<StoredCaptureRequest | null> {
  const row = (await prisma.setting.findUnique({ where: { key: captureRequestKey(id) } })) as Row | null;
  const s = parse(row?.value);
  if (!row || !s || s.status === "DONE") return s;
  let stored: CaptureRequestResult;
  if (result.ok) {
    const asset = await storeCapturePng(prisma, {
      png: result.png,
      bookmaker: s.bookmaker,
      salt: `${s.id}`,
      tags: s.kind === "test" ? ["test-connexion"] : [],
    });
    stored = { ok: true, assetId: asset.id, readOdds: result.readOdds, pageUrl: result.pageUrl };
  } else stored = { ok: false, kind: result.kind, message: result.message.slice(0, 300) };
  const next: StoredCaptureRequest = { ...s, status: "DONE", doneAt: now.toISOString(), result: stored };
  await prisma.setting.update({ where: { key: row.key }, data: { value: next as never } });
  return next;
}

/** Attend le résultat (site : test de connexion). `null` si toujours en cours à l'échéance. */
export async function waitCaptureRequest(
  prisma: PrismaClient,
  id: string,
  opts: { timeoutMs: number; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<StoredCaptureRequest | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const s = await readCaptureRequest(prisma, id);
    if (!s || s.status === "DONE") return s;
    if (Date.now() >= deadline) return null;
    await sleep(opts.pollMs ?? 2_000);
  }
}

/** Ménage : demandes terminées depuis plus de 7 jours. */
export async function purgeCaptureRequests(prisma: PrismaClient, now = new Date()): Promise<number> {
  const rows = (await prisma.setting.findMany({ where: { key: { startsWith: CAPTURE_REQUEST_PREFIX } } })) as Row[];
  const old = rows.filter((r) => {
    const s = parse(r.value);
    return s?.status === "DONE" && s.doneAt && now.getTime() - new Date(s.doneAt).getTime() > 7 * 86400_000;
  });
  if (old.length) await prisma.setting.deleteMany({ where: { key: { in: old.map((r) => r.key) } } });
  return old.length;
}
