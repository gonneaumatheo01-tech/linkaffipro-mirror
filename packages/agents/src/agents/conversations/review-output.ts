/**
 * Sortie JSON STRICTE de la relecture par l'IA, validée par le code (pur, testé) :
 * `{ "hooks": string[], "repellents": string[], "dropReasons": string[], "proposals": [{ "field", "value", "reason" }] }`.
 * JSON invalide, clé manquante ou en trop, mauvais type → toute la sortie est rejetée. Un élément de 80 caractères ou
 * plus, qui reprend un message entier ou qui contient encore une donnée personnelle → cet élément est rejeté. Une
 * proposition sur un champ non autorisé (identité, illusion, âge, règles adultes, /stop…) → rejetée.
 */
import { containsPersonalData } from "./anonymize";
import type { SampleConversation } from "./sample";
import { MAX_PATTERN_LENGTH, MAX_PROPOSALS_PER_PROFILE } from "./settings";

/** Champs de persona que l'IA peut proposer (les heures de relance sont calculées par le code, pas par l'IA). */
export const AI_PROPOSAL_FIELDS = ["styleExamples", "minExchangesBeforeOffer", "followUpAfterHours", "followUpsMax"] as const;
export type AiProposalField = (typeof AI_PROPOSAL_FIELDS)[number];

/** Bornes du formulaire Personas (`apps/web/lib/personas/form.ts`, `PERSONA_LIMITS`). */
export const PERSONA_FIELD_BOUNDS = {
  minExchangesBeforeOffer: { min: 1, max: 20 },
  followUpAfterHours: { min: 4, max: 168 },
  followUpsMax: { min: 0, max: 2 },
} as const;
export const STYLE_EXAMPLES_MAX_LENGTH = 1500;
export const MAX_STYLE_EXAMPLES_ADDED = 3;
const MAX_ITEMS = 5;
const OUTPUT_KEYS = ["hooks", "repellents", "dropReasons", "proposals"] as const;
const PROPOSAL_KEYS = ["field", "value", "reason"] as const;

export type AiProposal =
  | { field: "styleExamples"; value: string[]; reason: string }
  | { field: "minExchangesBeforeOffer" | "followUpAfterHours" | "followUpsMax"; value: number; reason: string };

export type ReviewOutput = { hooks: string[]; repellents: string[]; dropReasons: string[]; proposals: AiProposal[] };

export type ParseResult =
  | { ok: true; output: ReviewOutput; rejected: string[] }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(o);
  return have.length === keys.length && keys.every((k) => k in o);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/gu, " ").trim();

/** Messages de l'échantillon assez longs pour qu'une copie soit une citation (les « coucou » ne comptent pas). */
function quotedMessages(sample: readonly SampleConversation[]): string[] {
  return sample.flatMap((c) => c.messages.map((m) => norm(m.text))).filter((t) => t.length >= 15);
}

/** Motif court acceptable : moins de 80 caractères, sans donnée personnelle, jamais un message entier. */
export function checkPattern(item: unknown, quotes: readonly string[]): { ok: true; value: string } | { ok: false; why: string } {
  if (typeof item !== "string") return { ok: false, why: "pas un texte" };
  const value = item.replace(/\s+/gu, " ").trim();
  if (!value) return { ok: false, why: "vide" };
  if (value.length > MAX_PATTERN_LENGTH) return { ok: false, why: "trop long" };
  if (containsPersonalData(value)) return { ok: false, why: "donnée personnelle" };
  const n = norm(value);
  if (quotes.some((q) => q === n || (q.length >= 15 && n.includes(q)))) return { ok: false, why: "message entier" };
  return { ok: true, value };
}

function patternList(v: unknown, quotes: readonly string[], label: string, rejected: string[]): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const r = checkPattern(item, quotes);
    if (!r.ok) rejected.push(`${label} : ${r.why}`);
    else if (out.length >= MAX_ITEMS) rejected.push(`${label} : en trop`);
    else if (!out.includes(r.value)) out.push(r.value);
  }
  return out;
}

function isAiField(f: unknown): f is AiProposalField {
  return typeof f === "string" && (AI_PROPOSAL_FIELDS as readonly string[]).includes(f);
}

function checkProposal(p: unknown, quotes: readonly string[]): { ok: true; value: AiProposal } | { ok: false; why: string } {
  if (!isRecord(p) || !exactKeys(p, PROPOSAL_KEYS)) return { ok: false, why: "forme invalide" };
  if (!isAiField(p.field)) return { ok: false, why: `champ interdit (${String(p.field).slice(0, 40)})` };
  const reason = checkPattern(p.reason, quotes);
  if (!reason.ok) return { ok: false, why: `raison : ${reason.why}` };
  if (p.field === "styleExamples") {
    if (!Array.isArray(p.value) || p.value.length === 0 || p.value.length > MAX_STYLE_EXAMPLES_ADDED)
      return { ok: false, why: "exemples de style invalides" };
    const lines: string[] = [];
    for (const line of p.value) {
      const r = checkPattern(line, quotes);
      if (!r.ok) return { ok: false, why: `exemple de style : ${r.why}` };
      lines.push(r.value);
    }
    return { ok: true, value: { field: "styleExamples", value: lines, reason: reason.value } };
  }
  const bounds = PERSONA_FIELD_BOUNDS[p.field];
  const n = p.value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < bounds.min || n > bounds.max)
    return { ok: false, why: `valeur hors bornes (${p.field})` };
  return { ok: true, value: { field: p.field, value: n, reason: reason.value } };
}

/** Lit et valide la réponse de l'IA (texte brut : un objet JSON et rien d'autre). */
export function parseReviewOutput(text: string, sample: readonly SampleConversation[]): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: "JSON invalide" };
  }
  if (!isRecord(raw) || !exactKeys(raw, OUTPUT_KEYS)) return { ok: false, error: "clés attendues : hooks, repellents, dropReasons, proposals" };
  if (!Array.isArray(raw.proposals)) return { ok: false, error: "proposals doit être une liste" };
  const quotes = quotedMessages(sample);
  const rejected: string[] = [];
  const hooks = patternList(raw.hooks, quotes, "accroche", rejected);
  const repellents = patternList(raw.repellents, quotes, "tournure", rejected);
  const dropReasons = patternList(raw.dropReasons, quotes, "décrochage", rejected);
  if (!hooks || !repellents || !dropReasons) return { ok: false, error: "hooks, repellents et dropReasons doivent être des listes" };
  const proposals: AiProposal[] = [];
  for (const p of raw.proposals) {
    const r = checkProposal(p, quotes);
    if (!r.ok) rejected.push(`proposition : ${r.why}`);
    else if (proposals.length >= MAX_PROPOSALS_PER_PROFILE) rejected.push("proposition : plus de 3");
    else if (proposals.some((x) => x.field === r.value.field)) rejected.push("proposition : champ en double");
    else proposals.push(r.value);
  }
  return { ok: true, output: { hooks, repellents, dropReasons, proposals }, rejected };
}
