/**
 * Phase 32, chantier A — message du matin des alertes (09:10, après le Top 10) et boutons `pra:`.
 *
 * Règle 2 du prompt (« la veille ne spamme pas ») :
 * - un seul envoi par jour (repère posé par `jobs-advanced.ts`), 8 alertes au plus, ordre `ALERT_FAMILY_ORDER`
 *   (opportunités > affiliés signés > pipeline > informations) puis force ; seules les alertes NEW des 7 derniers jours ;
 * - une empreinte déjà envoyée pour le même canal dans les 14 derniers jours n'est pas renvoyée ;
 * - TOUT le texte passe le QA Global (`ALERT`, par `qaGate` → `requireApproval`) ; refus ou panne → rien n'est envoyé,
 *   les alertes restent NEW, Kevin le dit par un texte fixe ;
 * - un message d'en-tête, puis un message par alerte avec ses boutons `✅ Vu` `📝 Note` `🔕 Plus pour ce canal` ;
 * - un type dont les 5 dernières alertes envoyées n'ont jamais été vues : Kevin propose UNE fois de le couper
 *   (bouton `pra:<alertId>:kind`), au plus une proposition par matin.
 * « 📝 Note » ouvre une question courte (`Setting prospection.pending_alert_note.<chatId>`, 30 minutes) comme la
 * question du montant d'un deal (phase 31) : `answerPendingAlertNote` est appelé par le chemin rapide de Kevin.
 */
import { esc } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { qaGate } from "../../qa-gates/gate";
import type { QaDeps } from "../../qa/contract";
import { parisDay } from "../../rules/time";
import type { AdminButton } from "../../types";
import { PROSPECTION_TEAM_KEY, type ProspectionDeps } from "../contract";
import { ALERT_CALLBACK_PREFIX, ALERT_FAMILY_ORDER, WATCH_LIMITS, type ProspectAlertAction, type ProspectAlertKind } from "../contract-advanced";
import type { ProspectCallbackOutcome } from "../kevin-port";
import { canActOnProspects, type ProspectCallbackDeps } from "../pipeline/callbacks";
import { addProspectNote } from "../pipeline/status";
import { handleOf, maskPublicContactsForQa } from "../score/format";
import { DAY_MS, objectOf, prospectionNow, rawProspectionSetting } from "../score/settings";
import { MUTE_OFFERED_KEY, markAlertSeen, muteAlertKind, mutedAlertKinds, muteProspectAlerts, offeredKinds, type ProspectAlertRow } from "./alerts";
import { ALERT_BUTTONS, ALERT_KIND_LABELS, WATCH_DIGEST_VARIANTS as V, alertVariants, evidenceLine } from "./texts";

/** Actions des boutons : celles du contrat + `kind` (couper un type, proposé après 5 alertes ignorées). */
export type AlertCallbackAction = ProspectAlertAction | "kind";
const ACTIONS: readonly AlertCallbackAction[] = ["seen", "note", "mute", "kind"];

export const PENDING_ALERT_NOTE_PREFIX = "prospection.pending_alert_note.";
export const PENDING_ALERT_NOTE_TTL_MS = 30 * 60_000;
/** Alertes NEW plus vieilles que ça : plus proposées le matin (toujours visibles sur le site). */
export const DIGEST_MAX_AGE_DAYS = 7;

export function alertCallback(alertId: string, action: AlertCallbackAction): string {
  const data = `${ALERT_CALLBACK_PREFIX}${alertId}:${action}`;
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error("callback_data trop long");
  return data;
}

export function parseAlertCallback(data: string): { alertId: string; action: AlertCallbackAction } | null {
  const m = /^pra:([A-Za-z0-9_-]{1,40}):([a-z]{1,8})$/.exec(data);
  if (!m || !(ACTIONS as readonly string[]).includes(m[2]!)) return null;
  return { alertId: m[1]!, action: m[2] as AlertCallbackAction };
}

export function alertButtons(alertId: string): AdminButton[][] {
  return [
    [
      { text: ALERT_BUTTONS.seen, callbackData: alertCallback(alertId, "seen") },
      { text: ALERT_BUTTONS.note, callbackData: alertCallback(alertId, "note") },
      { text: ALERT_BUTTONS.mute, callbackData: alertCallback(alertId, "mute") },
    ],
  ];
}

const FAMILY_RANK = new Map(ALERT_FAMILY_ORDER.map((f, i) => [f, i]));

/** Ordre du message du matin : famille, puis force, puis la plus récente. Pur. */
export function sortAlertsForDigest<T extends Pick<ProspectAlertRow, "family" | "strength" | "createdAt">>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => (FAMILY_RANK.get(a.family) ?? 9) - (FAMILY_RANK.get(b.family) ?? 9) || b.strength - a.strength || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

/**
 * Choix du matin (pur) : NEW, pas une empreinte déjà envoyée pour ce canal (`recentlySent` : `prospectId|dedupeKey`),
 * une seule alerte par empreinte, `max` au plus, dans l'ordre du message.
 */
export function selectDigestAlerts<T extends Pick<ProspectAlertRow, "prospectId" | "dedupeKey" | "family" | "strength" | "createdAt" | "status">>(
  rows: readonly T[],
  recentlySent: ReadonlySet<string>,
  max: number = WATCH_LIMITS.digestMax,
): T[] {
  const out: T[] = [];
  const keys = new Set<string>();
  for (const r of sortAlertsForDigest(rows.filter((x) => x.status === "NEW"))) {
    const k = `${r.prospectId}|${r.dedupeKey}`;
    if (recentlySent.has(k) || keys.has(k)) continue;
    keys.add(k);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Types à proposer à la coupure : les `n` dernières alertes envoyées du type sont toutes restées SENT (jamais vues),
 * type ni coupé ni déjà proposé. Pur. `sent` : alertes envoyées (sentAt posé), toutes familles.
 */
export function kindsToOfferMute(
  sent: ReadonlyArray<Pick<ProspectAlertRow, "id" | "kind" | "status" | "sentAt">>,
  opts: { muted: ReadonlySet<string>; offered: ReadonlySet<string>; n?: number },
): Array<{ kind: ProspectAlertKind; lastAlertId: string }> {
  const n = opts.n ?? WATCH_LIMITS.ignoredBeforeMuteOffer;
  const byKind = new Map<ProspectAlertKind, Array<Pick<ProspectAlertRow, "id" | "kind" | "status" | "sentAt">>>();
  for (const a of sent) if (a.sentAt) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  const out: Array<{ kind: ProspectAlertKind; lastAlertId: string }> = [];
  for (const [kind, list] of byKind) {
    if (opts.muted.has(kind) || opts.offered.has(kind)) continue;
    const last = [...list].sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime()).slice(0, n);
    if (last.length >= n && last.every((a) => a.status === "SENT")) out.push({ kind, lastAlertId: last[0]!.id });
  }
  return out;
}

type DigestItem = { alert: ProspectAlertRow; handle: string; html: string; contacts: Array<{ type: string; value: string }> };

export type DigestDeps = ProspectionDeps & QaDeps;

/** Message du matin : rend le nombre d'alertes envoyées. */
export async function sendAlertsDigest(deps: DigestDeps, now: Date = prospectionNow(deps)): Promise<{ sent: number; qaBlocked: boolean }> {
  if (!deps.admin) return { sent: 0, qaBlocked: false };
  const since = new Date(now.getTime() - DIGEST_MAX_AGE_DAYS * DAY_MS);
  const fresh = (await deps.prisma.prospectAlert.findMany({ where: { status: "NEW", createdAt: { gte: since } } })) as unknown as ProspectAlertRow[];
  const muted = new Set<string>(await mutedAlertKinds(deps));
  const candidates = fresh.filter((a) => !muted.has(a.kind));
  const repeatSince = new Date(now.getTime() - WATCH_LIMITS.repeatDays * DAY_MS);
  const recent = (await deps.prisma.prospectAlert.findMany({ where: { sentAt: { gte: repeatSince } } })) as unknown as ProspectAlertRow[];
  const recentlySent = new Set(recent.map((a) => `${a.prospectId}|${a.dedupeKey}`));

  // Proposition de coupure (sur les envois des jours précédents), une au plus par matin, hors QA (texte fixe).
  const allSent = (await deps.prisma.prospectAlert.findMany({ where: { sentAt: { not: null } } })) as unknown as ProspectAlertRow[];
  const offered = await offeredKinds(deps);
  const offers = kindsToOfferMute(allSent, { muted, offered: new Set(Object.keys(offered)) });

  // Canaux coupés : jamais dans le message.
  const prospectIds = [...new Set(candidates.map((a) => a.prospectId))];
  const prospects = prospectIds.length
    ? ((await deps.prisma.prospect.findMany({ where: { id: { in: prospectIds } } })) as unknown as Array<{ id: string; username: string | null; title: string; watchMuted?: boolean | null }>)
    : [];
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const usable = candidates.filter((a) => byId.has(a.prospectId) && !byId.get(a.prospectId)!.watchMuted);
  const chosen = selectDigestAlerts(usable, recentlySent);

  if (offers.length) {
    const o = offers[0]!;
    const res = await deps.admin.send(pick(V.muteOffer({ kind: ALERT_KIND_LABELS[o.kind], n: WATCH_LIMITS.ignoredBeforeMuteOffer }), `prospection.alerts.muteOffer`), {
      buttons: [[{ text: ALERT_BUTTONS.kind, callbackData: alertCallback(o.lastAlertId, "kind") }]],
    });
    if (res) {
      const value = { ...offered, [o.kind]: now.toISOString() };
      await deps.prisma.setting.upsert({ where: { key: MUTE_OFFERED_KEY }, create: { key: MUTE_OFFERED_KEY, value }, update: { value } });
    }
  }
  if (!chosen.length) return { sent: 0, qaBlocked: false };

  const items: DigestItem[] = [];
  for (const alert of chosen) {
    const p = byId.get(alert.prospectId)!;
    const handle = handleOf(p);
    const line = pick(alertVariants(alert.kind, handle, alert.data), `prospection.alert.${alert.kind}`);
    const ev = evidenceLine(alert.evidence);
    const contacts = (await deps.prisma.prospectContact.findMany({ where: { prospectId: p.id, type: "EMAIL" } })) as Array<{ type: string; value: string }>;
    items.push({ alert, handle, html: ev ? `${line}\n${ev}` : line, contacts });
  }
  const header = pick(V.header({ n: items.length }), "prospection.alerts.header");
  const text = [header, ...items.map((i) => i.html)].join("\n\n");
  const gate = await qaGate(deps, {
    contentType: "ALERT",
    contentId: `prospection-alerts:${parisDay(now)}:${items.length}`,
    teamKey: PROSPECTION_TEAM_KEY,
    content: maskPublicContactsForQa({ text, prospectIds: items.map((i) => i.alert.prospectId) }, items.flatMap((i) => i.contacts)),
  });
  if (gate.kind !== "approved") {
    await deps.admin.send(pick(gate.kind === "unavailable" ? V.qaUnavailable : V.qaRejected, `prospection.alerts.qa.${gate.kind}`));
    return { sent: 0, qaBlocked: true };
  }

  await deps.admin.send(header);
  let sent = 0;
  for (const item of items) {
    const res = await deps.admin.send(item.html, { buttons: alertButtons(item.alert.id) });
    if (!res) continue;
    sent++;
    await deps.prisma.prospectAlert.update({ where: { id: item.alert.id }, data: { status: "SENT", sentAt: now } });
  }
  return { sent, qaBlocked: false };
}

// ————— Boutons —————

type PendingNote = { alertId: string; prospectId: string; at: string };

const toastOf = (s: string) => s.replace(/<[^>]*>/g, "").slice(0, 190);

/** Bouton `pra:<alertId>:<action>` ; null si ce n'est pas un bouton d'alerte. */
export async function handleAlertCallback(
  deps: ProspectionDeps & Partial<Pick<ProspectCallbackDeps, "isAllowed">>,
  input: { data: string; chatId: string; actorTelegramId: string },
): Promise<ProspectCallbackOutcome | null> {
  if (!input.data.startsWith(ALERT_CALLBACK_PREFIX)) return null;
  const chat = input.chatId;
  const say = (entry: readonly string[], key: string) => pick(entry, `prospection.alertcb.${key}`, chat);
  const parsed = parseAlertCallback(input.data);
  if (!parsed) return { handled: true, toast: say(V.unknown, "unknown") };
  if (!(await canActOnProspects(deps as ProspectCallbackDeps, input.actorTelegramId, chat))) return { handled: true, toast: say(V.notAllowed, "notAllowed") };
  const alert = (await deps.prisma.prospectAlert.findUnique({ where: { id: parsed.alertId } })) as ProspectAlertRow | null;
  if (!alert) return { handled: true, toast: say(V.unknown, "unknown") };
  const p = (await deps.prisma.prospect.findUnique({ where: { id: alert.prospectId } })) as { id: string; username: string | null; title: string } | null;
  const h = esc(p ? handleOf(p) : "ce canal");
  const by = `telegram:${input.actorTelegramId}`;
  switch (parsed.action) {
    case "seen":
      await markAlertSeen(deps, alert.id, by);
      return { handled: true, toast: say(V.seen, "seen"), removeButtons: true };
    case "note": {
      const key = `${PENDING_ALERT_NOTE_PREFIX}${chat}`;
      const value: PendingNote = { alertId: alert.id, prospectId: alert.prospectId, at: prospectionNow(deps).toISOString() };
      await deps.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await markAlertSeen(deps, alert.id, by);
      const text = say(V.askNote({ h }), "askNote");
      return { handled: true, toast: toastOf(text), reply: text };
    }
    case "mute": {
      await muteProspectAlerts(deps, alert.prospectId, by);
      await deps.prisma.prospectAlert.update({ where: { id: alert.id }, data: { status: "MUTED" } });
      return { handled: true, toast: toastOf(say(V.mutedProspect({ h }), "mutedProspect")), removeButtons: true };
    }
    case "kind": {
      await muteAlertKind(deps, alert.kind, by);
      const text = say(V.mutedKind({ kind: ALERT_KIND_LABELS[alert.kind] }), "mutedKind");
      return { handled: true, toast: toastOf(text), reply: text, removeButtons: true };
    }
  }
}

/**
 * Réponse à « 📝 Note » (moins de 30 minutes après le bouton) : note ajoutée à la fiche, réponse de Kevin. Null s'il
 * n'y a pas de question ouverte (Kevin traite alors le message normalement). Branché par le chemin rapide de Kevin.
 */
export async function answerPendingAlertNote(deps: ProspectionDeps, chatId: string, text: string): Promise<string | null> {
  const key = `${PENDING_ALERT_NOTE_PREFIX}${chatId}`;
  const v = objectOf(await rawProspectionSetting(deps, key));
  if (typeof v.prospectId !== "string" || typeof v.at !== "string") return null;
  const now = prospectionNow(deps);
  if (now.getTime() - Date.parse(v.at) > PENDING_ALERT_NOTE_TTL_MS) {
    await deps.prisma.setting.deleteMany({ where: { key } });
    return null;
  }
  const r = await addProspectNote(deps, v.prospectId, text, "client");
  if (!r.ok) return pick(V.noteEmpty, "prospection.alertnote.empty", chatId);
  await deps.prisma.setting.deleteMany({ where: { key } });
  const p = (await deps.prisma.prospect.findUnique({ where: { id: v.prospectId } })) as { username: string | null; title: string } | null;
  return pick(V.noteSaved({ h: esc(p ? handleOf(p) : "ce canal") }), "prospection.alertnote.saved", chatId);
}
