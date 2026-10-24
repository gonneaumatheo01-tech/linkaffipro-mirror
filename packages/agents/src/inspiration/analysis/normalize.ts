/**
 * Phase 27, chantier B : lignes `ReferencePost` (référence) et `Post` + `PostInsight` (canal du client) → `AnalysisPost`.
 * Les colonnes de mesures et `features` (écrites à la lecture par le chantier A) priment ; une mesure absente de
 * `features` est recalculée sur le texte s'il est encore là (30 jours), sinon elle vaut 0 / non.
 */
import { textLength } from "@linkaffipro/core";
import { countEmojis } from "../../agents/posts/features";
import type { ReferenceMediaKind } from "../contract";
import { textSignals, visibleText, type TextSignals } from "./patterns";
import type { AnalysisPost } from "./types";

/** Colonnes de `ReferencePost` lues par l'analyse. */
export type ReferencePostRow = {
  externalId: number;
  postedAt: Date;
  text: string | null;
  textPurgedAt?: Date | null;
  length: number;
  lines: number;
  emojiCount: number;
  mediaKind: string;
  views: number | null;
  hasLink: boolean;
  hasButton: boolean;
  hasPrice: boolean;
  hasOdds: boolean;
  hasVipCall: boolean;
  features: unknown;
};

const MEDIA_KINDS: readonly ReferenceMediaKind[] = ["text", "photo", "video", "poll", "document", "other"];

export function mediaKindOf(v: unknown): ReferenceMediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v) ? (v as ReferenceMediaKind) : "other";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Nombre d'une mesure de `features` (nombre, liste, ou booléen) ; undefined si absente. */
function countFeature(f: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
    if (Array.isArray(v)) return v.length;
    if (typeof v === "boolean") return v ? 1 : 0;
  }
  return undefined;
}

/** Booléen d'une mesure de `features` (vrai, nombre > 0, liste ou texte non vides) ; undefined si absente. */
function flagFeature(f: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    if (!(k in f)) continue;
    const v = f[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") return v.trim() !== "" && v !== "none" && v !== "no";
    if (Array.isArray(v)) return v.length > 0;
    if (v === null) return false;
  }
  return undefined;
}

function ratioFeature(f: Record<string, unknown>, key: string): number | undefined {
  const v = f[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return v > 1 ? Math.min(1, v / 100) : v;
}

/** Ligne `ReferencePost` → post analysé (le texte effacé reste null ; les mesures restent). */
export function fromReferencePost(row: ReferencePostRow): AnalysisPost {
  const f = record(row.features);
  const text = row.textPurgedAt ? null : row.text?.trim() ? row.text : null;
  const s: TextSignals | null = text ? textSignals(text) : null;
  const pick = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
  return {
    id: String(row.externalId),
    postedAt: row.postedAt,
    text,
    length: row.length,
    lines: row.lines,
    emojiCount: row.emojiCount,
    mediaKind: mediaKindOf(row.mediaKind),
    views: typeof row.views === "number" ? row.views : null,
    hasLink: row.hasLink,
    hasButton: row.hasButton,
    hasPrice: row.hasPrice,
    hasOdds: row.hasOdds,
    hasVipCall: row.hasVipCall,
    hashtags: pick(countFeature(f, "hashtags", "hashtagCount"), s?.hashtags ?? 0),
    mentions: pick(countFeature(f, "mentions", "mentionCount"), s?.mentions ?? 0),
    questions: pick(countFeature(f, "questions", "questionCount"), s?.questions ?? 0),
    capsRatio: pick(ratioFeature(f, "capsRatio"), s?.capsRatio ?? 0),
    hasMatch: pick(flagFeature(f, "match", "hasMatch"), s?.hasMatch ?? false),
    isBetResult: pick(flagFeature(f, "betResult", "isBetResult"), s?.isBetResult ?? false),
    hasBonus: pick(flagFeature(f, "bonus", "hasBonus"), s?.hasBonus ?? false),
    hasPromoCode: pick(flagFeature(f, "promoCode", "hasPromoCode", "promo"), s?.hasPromoCode ?? false),
    gainClaim: pick(flagFeature(f, "gainClaim"), s?.gainClaim ?? false),
    aiMention: pick(flagFeature(f, "aiMention"), s?.aiMention ?? false),
    free: pick(flagFeature(f, "free"), s?.free ?? false),
    paid: pick(flagFeature(f, "paid"), s?.paid ?? false),
  };
}

/** Post du client (texte HTML Telegram) → post analysé ; mêmes règles que la référence, calculées sur le texte. */
export function fromClientPost(input: {
  id: string;
  sentAt: Date;
  html: string;
  mediaKind: ReferenceMediaKind;
  views: number | null;
  hasButton: boolean;
}): AnalysisPost {
  const text = visibleText(input.html);
  const s = textSignals(text);
  return {
    id: input.id,
    postedAt: input.sentAt,
    text: text.trim() ? text : null,
    length: textLength(input.html),
    lines: text.trim() ? text.trim().split(/\n+/).filter((l) => l.trim()).length : 0,
    emojiCount: countEmojis(input.html),
    mediaKind: input.mediaKind,
    views: input.views,
    hasLink: s.hasLink,
    hasButton: input.hasButton,
    hasPrice: s.hasPrice,
    hasOdds: s.hasOdds,
    hasVipCall: s.hasVipCall,
    hashtags: s.hashtags,
    mentions: s.mentions,
    questions: s.questions,
    capsRatio: s.capsRatio,
    hasMatch: s.hasMatch,
    isBetResult: s.isBetResult,
    hasBonus: s.hasBonus,
    hasPromoCode: s.hasPromoCode,
    gainClaim: s.gainClaim,
    aiMention: s.aiMention,
    free: s.free,
    paid: s.paid,
  };
}
