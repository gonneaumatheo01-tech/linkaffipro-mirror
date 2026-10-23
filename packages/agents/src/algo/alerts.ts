/**
 * Alertes de décrochage de l'équipe Algorithme (toutes les heures, file `agents-algo`) :
 * - `agents_channel_drop` : vues (à 24 h) ou clics sur l'offre des posts d'un canal en baisse de plus de `dropPct` %
 *   sur 7 jours par rapport aux 7 jours précédents, avec assez de données. Les posts des dernières 24 h sont exclus
 *   (leurs vues ne sont pas encore comparables) ;
 * - `agents_persona_drop` : profil de conversation dont le taux de réponse ou d'inscription chute (agent Conversations).
 * Écrites dans `Alert` (notifiées par le passage d'alertes du worker), une par cible et par 24 h, coupables dans
 * Réglages → Alertes ; une alerte ouverte dont la baisse a disparu est résolue.
 */
import { ALERT_SETTINGS_KEY, parseAlertSwitches } from "@linkaffipro/core";
import type { AgentsDeps } from "../types";
import { nowOf } from "../admin/journal";
import { computePersonaDropAlerts } from "../agents/conversations/drop-alert";
import { loadAlgoTeam, type AlgoSettings } from "./settings";

export const CHANNEL_DROP_KIND = "agents_channel_drop";
export const PERSONA_DROP_KIND = "agents_persona_drop";
export const DROP_DEDUP_MS = 24 * 3_600_000;
const DAY = 86_400_000;

export type ChannelWeekFigures = { channelId: string; title: string; views: number; offerClicks: number; prevViews: number; prevOfferClicks: number };
export type DropCandidate = { kind: string; key: string; message: string; payload: Record<string, unknown> };

/** Canaux en baisse (pur). Assez de données : `minViews` vues ou `minPosts` clics la semaine d'avant. */
export function channelDrops(rows: readonly ChannelWeekFigures[], s: Pick<AlgoSettings, "dropPct" | "minViews" | "minPosts">): DropCandidate[] {
  const out: DropCandidate[] = [];
  for (const r of rows) {
    const checks: Array<["vues" | "clics sur l'offre", number, number, number]> = [
      ["vues", r.prevViews, r.views, s.minViews],
      ["clics sur l'offre", r.prevOfferClicks, r.offerClicks, s.minPosts],
    ];
    for (const [what, prev, cur, min] of checks) {
      if (prev < Math.max(1, min)) continue;
      const drop = ((prev - cur) / prev) * 100;
      if (drop <= s.dropPct) continue;
      out.push({
        kind: CHANNEL_DROP_KIND,
        key: `${r.channelId}:${what === "vues" ? "views" : "clicks"}`,
        message: `Le canal « ${r.title} » décroche : ${what} en baisse de ${Math.round(drop)} % sur 7 jours (${prev.toLocaleString("fr-FR")} → ${cur.toLocaleString("fr-FR")}). Regardez Agents → Ce qui marche.`,
        payload: { key: `${r.channelId}:${what === "vues" ? "views" : "clicks"}`, channelId: r.channelId, metric: what, previous: prev, current: cur, dropPct: Math.round(drop) },
      });
      break;
    }
  }
  return out;
}

async function channelFigures(deps: AgentsDeps, now: Date): Promise<ChannelWeekFigures[]> {
  const end = new Date(now.getTime() - DAY);
  const mid = new Date(end.getTime() - 7 * DAY);
  const start = new Date(mid.getTime() - 7 * DAY);
  const rows = (await deps.prisma.postInsight.findMany({
    where: { sentAt: { gte: start, lt: end } },
    select: { channelId: true, sentAt: true, views24h: true, viewsFinal: true, offerClicks: true },
  })) as Array<{ channelId: string; sentAt: Date; views24h: number | null; viewsFinal: number; offerClicks: number }>;
  const by = new Map<string, ChannelWeekFigures>();
  for (const r of rows) {
    const f = by.get(r.channelId) ?? { channelId: r.channelId, title: "", views: 0, offerClicks: 0, prevViews: 0, prevOfferClicks: 0 };
    const v = r.views24h ?? r.viewsFinal;
    if (r.sentAt >= mid) {
      f.views += v;
      f.offerClicks += r.offerClicks;
    } else {
      f.prevViews += v;
      f.prevOfferClicks += r.offerClicks;
    }
    by.set(r.channelId, f);
  }
  if (!by.size) return [];
  const titles = (await deps.prisma.channel.findMany({ where: { id: { in: [...by.keys()] }, isActive: true }, select: { id: true, title: true } })) as Array<{ id: string; title: string }>;
  return titles.map((t) => ({ ...by.get(t.id)!, title: t.title }));
}

type AlertRow = { id: string; kind: string; payload: unknown; createdAt: Date; resolvedAt: Date | null };
const keyOf = (a: AlertRow) => String((a.payload as { key?: unknown } | null)?.key ?? "");

/** Crée les alertes manquantes (une par cible et 24 h) et résout celles dont la baisse a disparu. */
export async function syncDropAlerts(deps: AgentsDeps, kind: string, detected: readonly DropCandidate[], now: Date): Promise<{ created: number; resolved: number }> {
  const recent = (await deps.prisma.alert.findMany({ where: { kind, OR: [{ resolvedAt: null }, { createdAt: { gte: new Date(now.getTime() - DROP_DEDUP_MS) } }] } })) as AlertRow[];
  let created = 0;
  for (const d of detected) {
    if (recent.some((a) => keyOf(a) === d.key && (!a.resolvedAt || now.getTime() - a.createdAt.getTime() < DROP_DEDUP_MS))) continue;
    await deps.prisma.alert.create({ data: { kind, severity: "WARNING", message: d.message, payload: JSON.parse(JSON.stringify({ ...d.payload, key: d.key })), createdAt: now } });
    created++;
  }
  const keys = new Set(detected.map((d) => d.key));
  const gone = recent.filter((a) => !a.resolvedAt && !keys.has(keyOf(a)));
  if (gone.length) await deps.prisma.alert.updateMany({ where: { id: { in: gone.map((a) => a.id) } }, data: { resolvedAt: now } });
  return { created, resolved: gone.length };
}

export type DropAlertsResult = Record<string, { created: number; resolved: number; detected: number } | { skipped: string } | { error: string }>;

export async function runDropAlerts(deps: AgentsDeps): Promise<DropAlertsResult> {
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const row = await deps.prisma.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } });
  const switches = parseAlertSwitches(row?.value);
  const out: DropAlertsResult = {};
  const parts: Array<[keyof typeof switches, () => Promise<DropCandidate[]>]> = [
    [CHANNEL_DROP_KIND, async () => channelDrops(await channelFigures(deps, now), settings)],
    [
      PERSONA_DROP_KIND,
      async () =>
        (await computePersonaDropAlerts(deps, { minConversations: settings.minConversations, threshold: settings.dropPct / 100 })).map((c) => ({
          kind: PERSONA_DROP_KIND,
          key: c.key,
          message: c.message,
          payload: { key: c.key, personaId: c.personaId, metric: c.metric, previous: c.previous, current: c.current, drop: c.drop },
        })),
    ],
  ];
  for (const [kind, detect] of parts) {
    try {
      // Coupée : rien n'est évalué, et une alerte ouverte se ferme (comme les autres alertes à interrupteur).
      const found = switches[kind] ? await detect() : [];
      const r = await syncDropAlerts(deps, kind, found, now);
      out[kind] = switches[kind] ? { ...r, detected: found.length } : { skipped: "alerte désactivée" };
    } catch (err) {
      out[kind] = { error: (err as Error).message };
      deps.logger?.warn({ kind, err: (err as Error).message }, "[agents] alerte de décrochage impossible à évaluer");
    }
  }
  return out;
}
