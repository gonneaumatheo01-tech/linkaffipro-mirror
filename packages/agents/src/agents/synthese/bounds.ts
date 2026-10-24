/**
 * Bornes des recommandations (règles pures, revérifiées au moment d'appliquer) :
 * - mélange : ne bouge pas de plus de `maxMixShiftPoints` points (parts en %) par rapport au mélange du début de semaine,
 *   ni de plus de 10 points par proposition (mélange effectif : Casino non réglé = 2 / 1 / 1) ;
 * - fenêtre : dans les heures autorisées du canal ;
 * - quota : de 1 au maximum fixé par le client ;
 * - consignes de style : texte court ;
 * - persona : seulement les réglages permis, avec la validation du formulaire Personas (`validatePersonaTuning`) ;
 * - tout autre champ (identité, illusion, âge, règles adultes, /stop, règles de contenu et de rythme…) : refusé.
 * Niveaux : 0 = rien d'appliqué seul, 1 = petits réglages (SMALL) seuls, 2 = tout dans les bornes.
 */
import { PERSONA_TUNING_FIELDS, validatePersonaTuning } from "@linkaffipro/core";
import { hhmmToMinutes } from "../../rules/time";
import type { AlgoSettings, HourRange } from "../../algo/settings";
import type { Mix } from "../experimentation/variants";
import { MAX_MIX_POINTS_PER_PROPOSAL } from "../../algo/mix";

export const RECOMMENDATION_TARGETS = ["CHANNEL_PLAN", "TEAM_CONFIG", "PERSONA"] as const;
export type RecommendationTarget = (typeof RECOMMENDATION_TARGETS)[number];

/** Champs permis par cible. `window` = `{ windowStart, windowEnd }`. */
export const ALLOWED_FIELDS: Record<RecommendationTarget, readonly string[]> = {
  CHANNEL_PLAN: ["mix", "window", "postsPerDay", "styleNotes"],
  TEAM_CONFIG: ["styleGuidelines"],
  PERSONA: PERSONA_TUNING_FIELDS,
};

/** Champs jamais touchés par une recommandation (refus explicite, en plus de la liste blanche). */
export const FORBIDDEN_FIELDS = [
  "identityKind",
  "illusion",
  "age",
  "adultRules",
  "stop",
  "isActive",
  "forbiddenWords",
  "maxTextLength",
  "quietHours",
  "minSpacingMinutes",
  "simulation",
  "autonomyLevel",
  "monthlyBudgetCents",
  "paused",
  "enabled",
  "personaId",
  "campaignId",
] as const;

export const STYLE_NOTES_MAX = 600;
export const STYLE_GUIDELINES_MAX = 2000;

export type BoundsInput = { target: string; field: string; after: unknown };
export type BoundsContext = {
  settings: AlgoSettings;
  /** Mélange du début de semaine (avant toute recommandation appliquée cette semaine), sinon le mélange actuel. */
  weekBaseMix?: Mix | null;
  /** Mélange effectif actuel : une proposition ne le déplace pas de plus de 10 points d'un coup. */
  currentMix?: Mix | null;
  allowedHours?: HourRange;
  personaIdentity?: string;
};
export type BoundsResult = { ok: true; value: unknown } | { ok: false; reason: string };

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseMixValue(v: unknown): Mix | null {
  const r = record(v);
  const vals = [r.video, r.photo, r.text];
  if (!vals.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) return null;
  const m = { video: r.video as number, photo: r.photo as number, text: r.text as number };
  return m.video + m.photo + m.text > 0 ? m : null;
}

/** Parts en % d'un mélange. */
export function mixShares(m: Mix): Mix {
  const t = m.video + m.photo + m.text;
  return { video: (m.video / t) * 100, photo: (m.photo / t) * 100, text: (m.text / t) * 100 };
}

/** Plus grand déplacement (points) entre deux mélanges. */
export function mixShiftPoints(a: Mix, b: Mix): number {
  const x = mixShares(a);
  const y = mixShares(b);
  return Math.max(Math.abs(x.video - y.video), Math.abs(x.photo - y.photo), Math.abs(x.text - y.text));
}

export function checkBounds(rec: BoundsInput, ctx: BoundsContext): BoundsResult {
  if ((FORBIDDEN_FIELDS as readonly string[]).includes(rec.field)) return { ok: false, reason: `Champ jamais modifié par l'équipe Algorithme : ${rec.field}.` };
  const target = rec.target as RecommendationTarget;
  if (!ALLOWED_FIELDS[target]?.includes(rec.field)) return { ok: false, reason: `Réglage non permis : ${rec.target}.${rec.field}.` };
  const s = ctx.settings;
  if (target === "PERSONA") {
    const r = validatePersonaTuning(rec.field, rec.after, ctx.personaIdentity);
    return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
  }
  switch (rec.field) {
    case "mix": {
      const m = parseMixValue(rec.after);
      if (!m) return { ok: false, reason: "Mélange invalide." };
      if (ctx.currentMix) {
        const step = mixShiftPoints(ctx.currentMix, m);
        if (step > MAX_MIX_POINTS_PER_PROPOSAL + 0.5)
          return { ok: false, reason: `Le mélange bougerait de ${Math.round(step)} points d'un coup (${MAX_MIX_POINTS_PER_PROPOSAL} au plus par proposition).` };
      }
      if (ctx.weekBaseMix) {
        const shift = mixShiftPoints(ctx.weekBaseMix, m);
        if (shift > s.maxMixShiftPoints + 0.5)
          return { ok: false, reason: `Le mélange bougerait de ${Math.round(shift)} points cette semaine (${s.maxMixShiftPoints} au plus).` };
      }
      return { ok: true, value: m };
    }
    case "window": {
      const r = record(rec.after);
      const a = typeof r.windowStart === "string" ? hhmmToMinutes(r.windowStart) : null;
      const b = typeof r.windowEnd === "string" ? hhmmToMinutes(r.windowEnd) : null;
      if (a === null || b === null || b <= a) return { ok: false, reason: "Fenêtre horaire invalide." };
      const allowed = ctx.allowedHours ?? s.allowedHours.default;
      const lo = hhmmToMinutes(allowed.start) ?? 0;
      const hi = hhmmToMinutes(allowed.end) ?? 1440;
      if (a < lo || b > hi) return { ok: false, reason: `La fenêtre sortirait des heures autorisées du canal (${allowed.start}-${allowed.end}).` };
      return { ok: true, value: { windowStart: r.windowStart, windowEnd: r.windowEnd } };
    }
    case "postsPerDay": {
      const n = rec.after;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return { ok: false, reason: "Quota invalide." };
      if (n > s.maxPostsPerDay) return { ok: false, reason: `Quota au-dessus du maximum fixé (${s.maxPostsPerDay} par jour).` };
      return { ok: true, value: n };
    }
    case "styleNotes":
    case "styleGuidelines": {
      const max = rec.field === "styleNotes" ? STYLE_NOTES_MAX : STYLE_GUIDELINES_MAX;
      if (rec.after !== null && typeof rec.after !== "string") return { ok: false, reason: "Texte attendu." };
      const t = ((rec.after as string | null) ?? "").trim();
      if (t.length > max) return { ok: false, reason: `Consigne trop longue (${max} caractères au plus).` };
      return { ok: true, value: rec.field === "styleNotes" ? t || null : t };
    }
  }
  return { ok: false, reason: "Réglage inconnu." };
}

/** Le Grand Chef applique-t-il seul cette recommandation (pur) ? */
export function shouldAutoApply(level: 0 | 1 | 2, size: string): boolean {
  if (level === 2) return true;
  if (level === 1) return size === "SMALL";
  return false;
}
