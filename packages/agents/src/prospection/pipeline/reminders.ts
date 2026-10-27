/**
 * Phase 31, chantier C — rappels du suivi (tâche `prospection.reminders`, 09:05 Paris).
 *
 * - Contacté depuis plus de `prospection.reminder_days` jours sans réponse → « Ça fait 6 jours pour @x, tu relances ? »
 *   avec ✅ Relancé · ⏰ 3 jours · ❌ Abandon.
 * - En négociation depuis plus de `prospection.negotiation_reminder_days` jours → « La négo avec @x dure depuis
 *   11 jours, on en est où ? » avec 🤝 Signé · ⏰ 3 jours · ❌ Abandon.
 * - `prospection.reminders_daily_cap` rappels par jour au plus (les plus anciens d'abord), jamais le samedi ni le
 *   dimanche sauf `prospection.reminders_weekend`, jamais deux fois le même rappel avant le délai (`ProspectEvent`
 *   REMINDER), rien pendant un « ⏰ 3 jours » ou après un « ✅ Relancé » (`snoozedUntil`).
 * Textes fixes à variantes (`pick`, voix de Kevin) : le prompt cite Haiku pour ces textes, des gabarits suffisent
 * (aucune donnée à résumer, aucun appel payant) ; hors du QA Global comme tous les textes fixes de Kevin.
 */
import { esc } from "../../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../../boss/voice";
import { parisDay, parisDayStart, parisWeekday } from "../../rules/time";
import { PROSPECTION_SETTINGS, type ProspectionDeps } from "../contract";
import { handleOf } from "../score/format";
import { boolSetting, DAY_MS, numberSetting, objectOf } from "../score/settings";
import type { ProspectRow } from "../score/store";
import { contactedReminderButtons, negotiationReminderButtons } from "./cards";

type R = { handle: string; days: number };
const SAMPLES: R[] = [
  { handle: "@pronos_fr", days: 6 },
  { handle: "Casino Italia", days: 11 },
];

export const REMINDERS_VARIANTS = {
  contacted: voiceTemplate<R>(SAMPLES, (p) => [`Ça fait ${p.days} jours pour ${p.handle}, tu relances ?`, `${p.handle} n'a pas répondu depuis ${p.days} jours. Tu relances ?`]),
  negotiating: voiceTemplate<R>(SAMPLES, (p) => [`La négo avec ${p.handle} dure depuis ${p.days} jours, on en est où ?`, `${p.days} jours de négo avec ${p.handle}. Ça avance ?`]),
} satisfies VoiceTable;

export type ReminderKind = "contacted" | "negotiating";

type Due = { p: ProspectRow; kind: ReminderKind; days: number; since: Date };

export async function runReminders(deps: ProspectionDeps, now: Date): Promise<{ sent: number; skipped: "weekend" | null }> {
  const weekend = parisWeekday(now) >= 6;
  if (weekend && !(await boolSetting(deps, PROSPECTION_SETTINGS.remindersWeekend.key, PROSPECTION_SETTINGS.remindersWeekend.value))) return { sent: 0, skipped: "weekend" };
  if (!deps.admin) return { sent: 0, skipped: null };
  const [contactDays, negoDays, cap] = await Promise.all([
    numberSetting(deps, PROSPECTION_SETTINGS.reminderDays.key, PROSPECTION_SETTINGS.reminderDays.value),
    numberSetting(deps, PROSPECTION_SETTINGS.negotiationReminderDays.key, PROSPECTION_SETTINGS.negotiationReminderDays.value),
    numberSetting(deps, PROSPECTION_SETTINGS.remindersDailyCap.key, PROSPECTION_SETTINGS.remindersDailyCap.value),
  ]);

  // Rappels déjà envoyés aujourd'hui (plafond du jour).
  const dayStart = parisDayStart(parisDay(now));
  const todays = (await deps.prisma.prospectEvent.findMany({ where: { type: "REMINDER", createdAt: { gte: dayStart } } })) as Array<{ payload: unknown }>;
  let budget = Math.max(0, Math.round(cap) - todays.filter((e) => objectOf(e.payload).sent === true).length);
  if (budget <= 0) return { sent: 0, skipped: null };

  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["CONTACTED", "NEGOTIATING"] } } })) as unknown as ProspectRow[];
  const due: Due[] = [];
  for (const p of rows) {
    if (p.snoozedUntil && p.snoozedUntil.getTime() > now.getTime()) continue;
    const kind: ReminderKind = p.status === "CONTACTED" ? "contacted" : "negotiating";
    const since = kind === "contacted" ? (p.contactedAt ?? p.statusChangedAt) : p.statusChangedAt;
    if (!since) continue;
    if (kind === "contacted" && p.respondedAt) continue;
    const delay = kind === "contacted" ? contactDays : negoDays;
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (now.getTime() - since.getTime() <= delay * DAY_MS) continue;
    due.push({ p, kind, days, since });
  }
  due.sort((a, b) => a.since.getTime() - b.since.getTime());

  let sent = 0;
  for (const d of due) {
    if (budget <= 0) break;
    const delay = d.kind === "contacted" ? contactDays : negoDays;
    const last = (await deps.prisma.prospectEvent.findFirst({ where: { prospectId: d.p.id, type: "REMINDER" }, orderBy: { createdAt: "desc" } })) as { createdAt: Date; payload: unknown } | null;
    if (last && now.getTime() - last.createdAt.getTime() < delay * DAY_MS) continue;
    const handle = esc(handleOf(d.p));
    const html = pick(REMINDERS_VARIANTS[d.kind]({ handle, days: d.days }), `prospection.reminder.${d.kind}`, d.p.id);
    const res = await deps.admin.send(html, { buttons: d.kind === "contacted" ? contactedReminderButtons(d.p.id) : negotiationReminderButtons(d.p.id) });
    if (!res) continue;
    await deps.prisma.prospectEvent.create({ data: { prospectId: d.p.id, type: "REMINDER", payload: { kind: d.kind, days: d.days, sent: true, by: "system" }, createdAt: now } });
    sent++;
    budget--;
  }
  return { sent, skipped: null };
}
