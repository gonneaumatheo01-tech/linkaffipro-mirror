/**
 * Heures de relance par persona (logique programmée) : taux de réponse aux relances selon l'heure d'envoi (Paris).
 * Une relance « a eu une réponse » si la personne écrit dans les 24 h qui suivent. Proposition
 * `Persona.suggestedFollowUpHours` = heures (hors 22 h – 9 h) dont le taux atteint 80 % de la meilleure, seulement avec
 * assez de relances et une meilleure heure nettement au-dessus de la moyenne. Le moteur ne lit ce champ que si une
 * recommandation l'a appliqué.
 */
import { parisParts } from "../../rules/time";
import type { AgentsPrisma } from "../../types";

const REPLY_WINDOW_MS = 24 * 3_600_000;
/** Heures où une relance peut partir (le moteur décale 22 h – 9 h à 10 h). */
const FIRST_HOUR = 9;
const LAST_HOUR = 21;
export const MIN_FOLLOW_UPS_PER_HOUR = 5;
/** La meilleure heure doit faire au moins 10 % de mieux que la moyenne. */
const MIN_LIFT = 1.1;

export type FollowUpSend = { sentAt: Date; replied: boolean };
export type HourRate = { hour: number; sent: number; replied: number; rate: number };

/** Taux de réponse par heure d'envoi (pur), heures sans envoi omises. */
export function followUpRatesByHour(sends: readonly FollowUpSend[]): HourRate[] {
  const by = new Map<number, { sent: number; replied: number }>();
  for (const s of sends) {
    const h = parisParts(s.sentAt).hour;
    const cur = by.get(h) ?? { sent: 0, replied: 0 };
    cur.sent += 1;
    if (s.replied) cur.replied += 1;
    by.set(h, cur);
  }
  return [...by.entries()]
    .map(([hour, v]) => ({ hour, sent: v.sent, replied: v.replied, rate: v.replied / v.sent }))
    .sort((a, b) => a.hour - b.hour);
}

/** Heures conseillées (pur) ou null quand les données ne permettent pas de conclure. */
export function suggestFollowUpHours(sends: readonly FollowUpSend[], minTotal: number): { hours: number[]; rates: HourRate[]; overall: number } | null {
  if (sends.length < minTotal) return null;
  const rates = followUpRatesByHour(sends);
  const candidates = rates.filter((r) => r.hour >= FIRST_HOUR && r.hour <= LAST_HOUR && r.sent >= MIN_FOLLOW_UPS_PER_HOUR);
  if (candidates.length < 2) return null;
  // Moyenne des seules heures possibles : une heure de nuit (décalée à 10 h par le moteur) ne fausse pas la comparaison.
  const sent = candidates.reduce((n, r) => n + r.sent, 0);
  const overall = candidates.reduce((n, r) => n + r.replied, 0) / sent;
  const best = Math.max(...candidates.map((r) => r.rate));
  if (best <= 0 || best < overall * MIN_LIFT) return null;
  const hours = candidates.filter((r) => r.rate >= best * 0.8).map((r) => r.hour);
  // Toutes les heures retenues : aucune préférence à appliquer.
  if (hours.length === candidates.length) return null;
  return { hours, rates: candidates, overall };
}

/** Relances envoyées dans la fenêtre, par persona, avec « réponse dans les 24 h ». */
export async function loadFollowUpSends(
  prisma: AgentsPrisma,
  window: { start: Date; end: Date },
): Promise<Map<string, { botIds: string[]; sends: FollowUpSend[] }>> {
  const events = await prisma.conversationEvent.findMany({
    where: { type: "follow_up_sent", createdAt: { gte: window.start, lt: window.end } },
    select: { conversationId: true, createdAt: true },
  });
  const out = new Map<string, { botIds: string[]; sends: FollowUpSend[] }>();
  if (!events.length) return out;
  const ids = [...new Set(events.map((e) => e.conversationId))];
  const [convs, inbound] = await Promise.all([
    prisma.conversation.findMany({ where: { id: { in: ids } }, select: { id: true, botId: true, personaId: true } }),
    prisma.conversationMessage.findMany({
      where: { conversationId: { in: ids }, direction: "IN", author: "MEMBER", createdAt: { gte: window.start } },
      select: { conversationId: true, createdAt: true, meta: true },
    }),
  ]);
  const convOf = new Map(convs.map((c) => [c.id, c]));
  const inboundOf = new Map<string, number[]>();
  for (const m of inbound) {
    if (m.meta && typeof m.meta === "object" && (m.meta as { command?: unknown }).command != null) continue;
    const list = inboundOf.get(m.conversationId) ?? [];
    list.push(m.createdAt.getTime());
    inboundOf.set(m.conversationId, list);
  }
  for (const e of events) {
    const c = convOf.get(e.conversationId);
    if (!c?.personaId) continue;
    const t = e.createdAt.getTime();
    const replied = (inboundOf.get(c.id) ?? []).some((x) => x > t && x <= t + REPLY_WINDOW_MS);
    const entry = out.get(c.personaId) ?? { botIds: [], sends: [] };
    entry.sends.push({ sentAt: e.createdAt, replied });
    if (!entry.botIds.includes(c.botId)) entry.botIds.push(c.botId);
    out.set(c.personaId, entry);
  }
  return out;
}
