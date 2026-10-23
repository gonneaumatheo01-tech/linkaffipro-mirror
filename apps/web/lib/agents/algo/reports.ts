/**
 * Rapports hebdomadaires « Ce qui marche » (`InsightReport`, phase 21) : lecture tolérante de `stats` (écrit par le
 * moteur) : chiffres par profil de conversation (`stats.conversations`, forme `ConversationProfileStats`) et
 * relecture de l'IA (`stats.conversationReview` : motifs courts seulement, jamais un message entier). Pures, testées.
 */
import type { ConversationProfileStats } from "@linkaffipro/agents";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Une ligne `ConversationProfileStats` valide, ou null. */
export function parseProfile(v: unknown): ConversationProfileStats | null {
  if (!isObj(v) || typeof v.key !== "string" || typeof v.botId !== "string") return null;
  return {
    key: v.key,
    botId: v.botId,
    botLabel: str(v.botLabel) ?? "Bot",
    kind: v.kind === "ACCOUNT" ? "ACCOUNT" : "BOT",
    personaId: str(v.personaId),
    personaName: str(v.personaName),
    source: str(v.source),
    conversations: num(v.conversations) ?? 0,
    replyRate: num(v.replyRate),
    medianMessagesBeforeLink: num(v.medianMessagesBeforeLink),
    dropStage: str(v.dropStage),
    medianReplyDelaySec: num(v.medianReplyDelaySec),
    replyHours: Array.isArray(v.replyHours)
      ? (v.replyHours as unknown[]).filter((h): h is number => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23)
      : [],
    linksSent: num(v.linksSent) ?? 0,
    clicks: num(v.clicks) ?? 0,
    registrations: num(v.registrations) ?? 0,
    ftds: num(v.ftds) ?? 0,
    aiCostEur: num(v.aiCostEur) ?? 0,
    costPerRegistrationEur: num(v.costPerRegistrationEur),
    enoughData: v.enoughData === true,
  };
}

export function parseProfiles(stats: unknown): ConversationProfileStats[] {
  const list = isObj(stats) && Array.isArray(stats.conversations) ? (stats.conversations as unknown[]) : [];
  return list.map(parseProfile).filter((p): p is ConversationProfileStats => p !== null);
}

export type ReviewNotes = { key: string | null; label: string | null; works: string[]; fails: string[]; drops: string[] };

const SHORT = 80;
function shortList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : isObj(x) ? (str(x.text) ?? str(x.pattern) ?? str(x.label)) : null))
    .filter((x): x is string => !!x)
    .map((x) => (x.length > SHORT ? `${x.slice(0, SHORT - 1)}…` : x))
    .slice(0, 5);
}

function notesOf(key: string | null, v: Record<string, unknown>): ReviewNotes {
  return {
    key: str(v.key) ?? str(v.profileKey) ?? key,
    label: str(v.label) ?? str(v.personaName),
    works: shortList(v.works ?? v.hooks ?? v.goodHooks ?? v.whatWorks),
    fails: shortList(v.fails ?? v.repellents ?? v.badHooks ?? v.whatFails),
    drops: shortList(v.drops ?? v.dropReasons ?? v.dropPatterns),
  };
}

/** Motifs relevés par profil (tableau `profiles`, tableau direct ou objet par clé de profil). */
export function parseReview(review: unknown): ReviewNotes[] {
  let entries: Array<[string | null, unknown]> = [];
  if (Array.isArray(review)) entries = review.map((v) => [null, v]);
  else if (isObj(review) && Array.isArray(review.profiles)) entries = (review.profiles as unknown[]).map((v) => [null, v]);
  else if (isObj(review)) entries = Object.entries(review);
  return entries
    .filter((e): e is [string | null, Record<string, unknown>] => isObj(e[1]))
    .map(([k, v]) => notesOf(k, v))
    .filter((n) => n.works.length + n.fails.length + n.drops.length > 0);
}

/** « 2 min 30 s », « 45 s », « 3 h 05 ». */
export function delayText(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Source du `/start` en mots (« sans source » si absente). */
export function sourceText(source: string | null): string {
  return source ? source : "sans source";
}
