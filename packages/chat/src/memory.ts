// Faits retenus sur la personne (contrat §3.5) : seulement ce qu'elle a dit d'elle-même, proposés par le modèle.
import { truncateVisible, wordsForm } from "./text-utils";

export const MAX_FACTS = 20;
export const MAX_FACT_CHARS = 120;

/** Faits critiques : jamais évincés par la limite de 20, sauf remplacement par un fait du même type. */
export const STICKY_PATTERNS: readonly RegExp[] = [
  /^pr[eé]nom\s*:/i,
  /^[aâ]ge\s*:/i,
  /^ville\s*:/i,
  /^pseudo\s*:/i,
];

/** Lecture tolérante de `Conversation.facts` (JSON) : textes non vides seulement. */
export function parseFacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .slice(-MAX_FACTS);
}

/**
 * Ajoute les nouveaux faits du modèle : espaces nettoyés, coupés à 120 caractères, sans doublon (casse et accents
 * ignorés), 20 au plus (les plus anciens partent en premier).
 */
export function mergeFacts(existing: readonly string[], incoming: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...existing, ...incoming]) {
    const fact = truncateVisible(raw.replace(/\s+/g, " ").trim(), MAX_FACT_CHARS);
    const key = wordsForm(fact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  if (out.length <= MAX_FACTS) return out;
  const sticky: string[] = [];
  const rest: string[] = [];
  for (const f of out) {
    if (STICKY_PATTERNS.some((p) => p.test(f))) sticky.push(f);
    else rest.push(f);
  }
  return [...rest.slice(-(MAX_FACTS - sticky.length)), ...sticky];
}
