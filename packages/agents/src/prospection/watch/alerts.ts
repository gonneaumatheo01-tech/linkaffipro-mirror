/**
 * Phase 32, chantier A — écriture et gestion des alertes du Veilleur (`ProspectAlert` + `ProspectEvent` ALERT).
 *
 * - `recordAlerts` : une alerte détectée devient une ligne `ProspectAlert` ET un `ProspectEvent` de type `ALERT`
 *   (chronologie de la fiche). Même empreinte (`dedupeKey`) pour le même canal en 14 jours → ignorée ; les changements
 *   « une fois par objet » (`ONCE_PER_KEY_KINDS` : l'empreinte porte une date) ne reviennent jamais. Canal coupé
 *   (`watchMuted`) ou type coupé (`Setting prospection.alerts.muted_kinds`) → l'alerte est gardée en MUTED (visible
 *   sur le site, jamais envoyée).
 * - Lecture et actions pour Kevin et le site : `listAlerts`, `markAlertSeen`, `muteAlertKind`, `unmuteAlertKind`,
 *   `muteProspectAlerts`, `unmuteProspectAlerts`, `mutedAlertKinds`.
 */
import { agentEvent } from "../../admin/journal";
import type { ProspectionDeps } from "../contract";
import { WATCH_LIMITS, type DetectedAlert, type ProspectAlertFamily, type ProspectAlertKind, type ProspectAlertStatus } from "../contract-advanced";
import { handleOf } from "../score/format";
import { DAY_MS, prospectionNow, rawProspectionSetting, stringArray } from "../score/settings";
import { ONCE_PER_KEY_KINDS } from "./diff";

export const MUTED_KINDS_KEY = "prospection.alerts.muted_kinds";
/** Types déjà proposés à la coupure (une seule proposition par type) : `{ [kind]: ISO }`. */
export const MUTE_OFFERED_KEY = "prospection.alerts.mute_offered";

export const ALERT_KINDS: readonly ProspectAlertKind[] = [
  "AFFILIATE_DROPPED",
  "NEW_AFFILIATE",
  "AFFILIATE_SWITCHED",
  "GROWTH_SPIKE",
  "DECLINE",
  "WENT_SILENT",
  "STARTED_SELLING_ADS",
  "MARKETPLACE_LISTED",
  "CONTACT_CHANGED",
  "TIER_UP",
  "TIER_DOWN",
  "AFFILIATE_NOT_POSTING",
  "AFFILIATE_PUSHES_COMPETITOR",
  "AFFILIATE_RISKY_CLAIM",
  "AFFILIATE_SILENT",
];
export const isAlertKind = (v: unknown): v is ProspectAlertKind => typeof v === "string" && (ALERT_KINDS as readonly string[]).includes(v);

export type ProspectAlertRow = {
  id: string;
  prospectId: string;
  kind: ProspectAlertKind;
  dedupeKey: string;
  family: ProspectAlertFamily;
  strength: number;
  data: unknown;
  evidence: string | null;
  status: ProspectAlertStatus;
  sentAt: Date | null;
  seenAt: Date | null;
  createdAt: Date;
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

/** Preuve ramenée à 15 mots au plus (règle 3). */
export function clipEvidence(e: string | null | undefined): string | null {
  const words = (e ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, WATCH_LIMITS.evidenceMaxWords).join(" ").slice(0, 200);
}

export async function mutedAlertKinds(deps: Pick<ProspectionDeps, "prisma">): Promise<ProspectAlertKind[]> {
  return stringArray(await rawProspectionSetting(deps, MUTED_KINDS_KEY)).filter(isAlertKind);
}

async function writeKinds(deps: Pick<ProspectionDeps, "prisma">, kinds: readonly string[]): Promise<void> {
  const value = [...new Set(kinds)].sort();
  await deps.prisma.setting.upsert({ where: { key: MUTED_KINDS_KEY }, create: { key: MUTED_KINDS_KEY, value }, update: { value } });
}

/** Écrit les alertes détectées pour un prospect (anti-répétition, coupures). Rend les alertes créées. */
export async function recordAlerts(
  deps: ProspectionDeps,
  prospect: { id: string; watchMuted?: boolean | null },
  detected: readonly DetectedAlert[],
  now: Date = prospectionNow(deps),
): Promise<ProspectAlertRow[]> {
  if (!detected.length) return [];
  const muted = new Set(await mutedAlertKinds(deps));
  const since = new Date(now.getTime() - WATCH_LIMITS.repeatDays * DAY_MS);
  const created: ProspectAlertRow[] = [];
  const keys = new Set<string>();
  for (const a of detected) {
    if (keys.has(a.dedupeKey)) continue;
    keys.add(a.dedupeKey);
    const where = ONCE_PER_KEY_KINDS.has(a.kind) ? { prospectId: prospect.id, dedupeKey: a.dedupeKey } : { prospectId: prospect.id, dedupeKey: a.dedupeKey, createdAt: { gte: since } };
    if (await deps.prisma.prospectAlert.findFirst({ where })) continue;
    const status: ProspectAlertStatus = prospect.watchMuted || muted.has(a.kind) ? "MUTED" : "NEW";
    const evidence = clipEvidence(a.evidence);
    const row = (await deps.prisma.prospectAlert.create({
      data: {
        prospectId: prospect.id,
        kind: a.kind,
        dedupeKey: a.dedupeKey,
        family: a.family,
        strength: Math.max(0, Math.min(100, Math.round(a.strength))),
        data: json(a.data),
        evidence,
        status,
        sentAt: null,
        seenAt: null,
        createdAt: now,
      },
    })) as unknown as ProspectAlertRow;
    await deps.prisma.prospectEvent.create({
      data: { prospectId: prospect.id, type: "ALERT", payload: json({ alertId: row.id, kind: a.kind, family: a.family, strength: row.strength, dedupeKey: a.dedupeKey, data: a.data, evidence, muted: status === "MUTED", by: "system" }), createdAt: now },
    });
    created.push(row);
  }
  return created;
}

export type AlertListItem = ProspectAlertRow & { handle: string; prospect: { id: string; username: string | null; title: string; status: string; tier: string | null } | null };

/** Alertes pour Kevin et le site (les plus récentes d'abord). */
export async function listAlerts(
  deps: Pick<ProspectionDeps, "prisma">,
  opts: { kinds?: ProspectAlertKind[] | null; status?: ProspectAlertStatus | ProspectAlertStatus[] | null; limit?: number | null; prospectId?: string | null } = {},
): Promise<AlertListItem[]> {
  const where: Record<string, unknown> = {};
  if (opts.kinds?.length) where.kind = { in: opts.kinds };
  if (opts.status) where.status = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
  if (opts.prospectId) where.prospectId = opts.prospectId;
  const take = Math.max(1, Math.min(500, Math.round(opts.limit ?? 50)));
  const rows = (await deps.prisma.prospectAlert.findMany({ where, orderBy: { createdAt: "desc" }, take })) as unknown as ProspectAlertRow[];
  const ids = [...new Set(rows.map((r) => r.prospectId))];
  const prospects = ids.length
    ? ((await deps.prisma.prospect.findMany({ where: { id: { in: ids } } })) as unknown as Array<{ id: string; username: string | null; title: string; status: string; tier: string | null }>)
    : [];
  const byId = new Map(prospects.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.prospectId) ?? null;
    return { ...r, handle: p ? handleOf(p) : "canal supprimé", prospect: p ? { id: p.id, username: p.username, title: p.title, status: p.status, tier: p.tier } : null };
  });
}

/** « ✅ Vu » : SENT ou NEW → SEEN. */
export async function markAlertSeen(deps: ProspectionDeps, alertId: string, by: string): Promise<{ ok: boolean; message?: string | null }> {
  const a = (await deps.prisma.prospectAlert.findUnique({ where: { id: alertId } })) as ProspectAlertRow | null;
  if (!a) return { ok: false, message: "alerte introuvable" };
  if (a.status === "SEEN") return { ok: true };
  const now = prospectionNow(deps);
  await deps.prisma.prospectAlert.update({ where: { id: alertId }, data: { status: "SEEN", seenAt: now } });
  await deps.prisma.prospectEvent.create({ data: { prospectId: a.prospectId, type: "ALERT_SEEN", payload: { alertId, kind: a.kind, by }, createdAt: now } });
  return { ok: true };
}

/** Coupe un type d'alerte (les alertes NEW de ce type passent en MUTED). */
export async function muteAlertKind(deps: ProspectionDeps, kind: ProspectAlertKind, by: string): Promise<{ ok: boolean; kinds: ProspectAlertKind[]; message?: string | null }> {
  if (!isAlertKind(kind)) return { ok: false, kinds: await mutedAlertKinds(deps), message: "type d'alerte inconnu" };
  const kinds = [...new Set([...(await mutedAlertKinds(deps)), kind])];
  await writeKinds(deps, kinds);
  await deps.prisma.prospectAlert.updateMany({ where: { kind, status: "NEW" }, data: { status: "MUTED" } });
  await agentEvent(deps, "prospection.alerts.kind_muted", { kind, by });
  return { ok: true, kinds };
}

/** Remet un type d'alerte (et autorise de nouveau la proposition de coupure). */
export async function unmuteAlertKind(deps: ProspectionDeps, kind: ProspectAlertKind, by: string): Promise<{ ok: boolean; kinds: ProspectAlertKind[]; message?: string | null }> {
  if (!isAlertKind(kind)) return { ok: false, kinds: await mutedAlertKinds(deps), message: "type d'alerte inconnu" };
  const kinds = (await mutedAlertKinds(deps)).filter((k) => k !== kind);
  await writeKinds(deps, kinds);
  const offered = { ...(await offeredKinds(deps)) };
  if (kind in offered) {
    delete offered[kind];
    await deps.prisma.setting.upsert({ where: { key: MUTE_OFFERED_KEY }, create: { key: MUTE_OFFERED_KEY, value: offered }, update: { value: offered } });
  }
  await agentEvent(deps, "prospection.alerts.kind_unmuted", { kind, by });
  return { ok: true, kinds };
}

/** « 🔕 Plus pour ce canal » : plus aucune alerte envoyée pour ce prospect (gardées en MUTED). */
export async function muteProspectAlerts(deps: ProspectionDeps, prospectId: string, by: string): Promise<{ ok: boolean; message?: string | null }> {
  const p = await deps.prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!p) return { ok: false, message: "prospect introuvable" };
  const now = prospectionNow(deps);
  await deps.prisma.prospect.update({ where: { id: prospectId }, data: { watchMuted: true } });
  await deps.prisma.prospectAlert.updateMany({ where: { prospectId, status: "NEW" }, data: { status: "MUTED" } });
  await deps.prisma.prospectEvent.create({ data: { prospectId, type: "ALERTS_MUTED", payload: { by }, createdAt: now } });
  return { ok: true };
}

export async function unmuteProspectAlerts(deps: ProspectionDeps, prospectId: string, by: string): Promise<{ ok: boolean; message?: string | null }> {
  const p = await deps.prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!p) return { ok: false, message: "prospect introuvable" };
  await deps.prisma.prospect.update({ where: { id: prospectId }, data: { watchMuted: false } });
  await deps.prisma.prospectEvent.create({ data: { prospectId, type: "ALERTS_UNMUTED", payload: { by }, createdAt: prospectionNow(deps) } });
  return { ok: true };
}

export async function offeredKinds(deps: Pick<ProspectionDeps, "prisma">): Promise<Record<string, string>> {
  const v = await rawProspectionSetting(deps, MUTE_OFFERED_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
}
