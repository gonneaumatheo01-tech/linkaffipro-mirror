/**
 * Choix du créneau d'un post d'agent (pur) : quota de posts d'agent par jour, espacement minimal avec tout post du
 * canal (programmé ou envoyé, humain ou agent), fenêtre horaire et heures calmes en Europe/Paris, meilleurs horaires
 * du canal (`Setting` `besthours.<channelId>`) pour départager. Changement d'heure : chaque créneau est converti avec
 * le décalage de Paris de son propre instant.
 */
import {
  addDaysToDay,
  fromParis,
  hhmmToMinutes,
  parisDay,
  parisMinutes,
  parisWeekday,
} from "./time";

export type SlotPlan = {
  postsPerDay: number;
  /** « HH:MM » Paris. */
  windowStart: string;
  windowEnd: string;
  minSpacingMinutes: number;
};

export type QuietRange = { start: string; end: string };

export type SlotInput = {
  now: Date;
  /** Pas avant cet instant (mission reportée au lendemain…). */
  notBefore?: Date | null;
  plan: SlotPlan;
  quietHours?: readonly QuietRange[];
  /** Posts du canal déjà programmés ou envoyés (tous auteurs) : espacement. */
  occupied?: readonly Date[];
  /** Créneaux des autres posts d'agent du canal : quota du jour (et espacement). */
  agentSlots?: readonly Date[];
  /** Score par « jour-heure » (1 = lundi, heure de Paris), plus haut = meilleur. */
  preferred?: ReadonlyMap<string, number>;
  /** Délai minimal avant le premier créneau (5 min par défaut). */
  leadMinutes?: number;
  /** Pas entre deux créneaux candidats (15 min par défaut). */
  stepMinutes?: number;
  /** Jours explorés (7 par défaut). */
  horizonDays?: number;
  /** Espacements supplémentaires (phase 20 : jamais deux vidéos à moins de 6 h sur un canal). */
  extraSpacing?: ReadonlyArray<{ times: readonly Date[]; minutes: number }>;
};

/** Écart minimal entre deux vidéos d'un même canal. */
export const VIDEO_MIN_GAP_MINUTES = 6 * 60;
/** Équipe Casino (phase 22) : jamais deux vidéos à moins de 4 h sur un canal. */
export const CASINO_VIDEO_GAP_MINUTES = 4 * 60;

/** Écart minimal entre deux vidéos d'un canal selon l'équipe. */
export function videoGapMinutes(teamKey: string): number {
  return teamKey === "casino" ? CASINO_VIDEO_GAP_MINUTES : VIDEO_MIN_GAP_MINUTES;
}

export type SlotResult = { ok: true; at: Date } | { ok: false; reason: string };

export const DEFAULT_SLOT_PLAN: SlotPlan = {
  postsPerDay: 3,
  windowStart: "09:00",
  windowEnd: "22:00",
  minSpacingMinutes: 90,
};

/** Une minute de la journée (0-1439) est-elle dans une plage calme ? Une plage peut passer minuit (22:00 → 08:00). */
export function inQuietHours(minute: number, ranges: readonly QuietRange[] = []): boolean {
  for (const r of ranges) {
    const s = hhmmToMinutes(r.start);
    const e = hhmmToMinutes(r.end);
    if (s === null || e === null || s === e) continue;
    if (s < e ? minute >= s && minute < e : minute >= s || minute < e) return true;
  }
  return false;
}

/** Clé des meilleurs horaires : « 2-19 » = mardi 19 h. */
export function preferredKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

/**
 * Lit `Setting` `besthours.<channelId>` (forme écrite par le worker, `apps/web/lib/besthours/types.ts`) : score par
 * jour-heure tiré de la catégorie « all » (taux de clic, sinon clics par post). Forme inattendue → carte vide.
 */
export function preferredFromBestHours(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const cats = (value as { categories?: Record<string, { cells?: unknown }> } | null)?.categories;
  const cells = cats?.all?.cells;
  if (!Array.isArray(cells)) return out;
  for (const c of cells as Array<Record<string, unknown>>) {
    const day = Number(c.day);
    const hour = Number(c.hour);
    if (!Number.isInteger(day) || !Number.isInteger(hour)) continue;
    const score = typeof c.ctr === "number" ? c.ctr : typeof c.clicksPerPost === "number" ? c.clicksPerPost : 0;
    if (score > 0) out.set(preferredKey(day, hour), score);
  }
  return out;
}

/** Prochain créneau libre. */
export function pickSlot(input: SlotInput): SlotResult {
  const { plan } = input;
  const start = hhmmToMinutes(plan.windowStart);
  const endRaw = hhmmToMinutes(plan.windowEnd);
  if (start === null || endRaw === null) return { ok: false, reason: "Fenêtre horaire du canal invalide." };
  const end = endRaw <= start ? 24 * 60 : endRaw;
  if (plan.postsPerDay <= 0) return { ok: false, reason: "Le plan du canal prévoit 0 post par jour." };
  const lead = (input.leadMinutes ?? 5) * 60_000;
  const step = Math.max(1, input.stepMinutes ?? 15);
  const spacing = Math.max(0, plan.minSpacingMinutes) * 60_000;
  const minAt = Math.max(input.now.getTime() + lead, input.notBefore?.getTime() ?? 0);
  const occupied = [...(input.occupied ?? []), ...(input.agentSlots ?? [])].map((d) => d.getTime());
  const perDay = new Map<string, number>();
  for (const d of input.agentSlots ?? []) perDay.set(parisDay(d), (perDay.get(parisDay(d)) ?? 0) + 1);

  const firstDay = parisDay(new Date(minAt));
  const horizon = input.horizonDays ?? 7;
  let quotaFull = false;
  for (let i = 0; i <= horizon; i++) {
    const day = addDaysToDay(firstDay, i);
    if ((perDay.get(day) ?? 0) >= plan.postsPerDay) {
      quotaFull = true;
      continue;
    }
    let best: { at: number; score: number } | null = null;
    const seen = new Set<number>();
    for (let m = start; m < end; m += step) {
      const at = fromParis(day, m);
      const t = at.getTime();
      // Heure qui n'existe pas (passage à l'heure d'été) : la conversion retombe sur une autre minute ou un autre jour.
      if (seen.has(t) || parisDay(at) !== day || parisMinutes(at) !== m) continue;
      seen.add(t);
      if (t < minAt) continue;
      if (inQuietHours(m, input.quietHours)) continue;
      if (occupied.some((o) => Math.abs(o - t) < spacing)) continue;
      if (input.extraSpacing?.some((x) => x.times.some((o) => Math.abs(o.getTime() - t) < x.minutes * 60_000))) continue;
      const score = input.preferred?.get(preferredKey(parisWeekday(at), Math.floor(m / 60))) ?? 0;
      if (!best || score > best.score) best = { at: t, score };
    }
    if (best) return { ok: true, at: new Date(best.at) };
  }
  return {
    ok: false,
    reason: quotaFull
      ? `Aucun créneau libre sur ${horizon + 1} jours : quota de ${plan.postsPerDay} post(s) par jour atteint.`
      : `Aucun créneau libre sur ${horizon + 1} jours (fenêtre, heures calmes ou espacement).`,
  };
}
