// Lecture robuste de la réponse du modèle : texte brut, barrières ```json, phrase autour, blocs <think>. Une réponse
// coupée (finish_reason "length") est toujours rejetée : son JSON serait incomplet ou tronqué.
import { checkTurnOutput, type TurnOutput } from "./schema";

export type TurnParseFailure = {
  ok: false;
  code: "truncated" | "invalid_output";
  errors: string[];
};
export type TurnParseResult = { ok: true; output: TurnOutput } | TurnParseFailure;

/** Retire les blocs de raisonnement `<think>…</think>` (bloc jamais refermé : tout ce qui suit ; fin orpheline : ce qui précède). */
export function removeThinkBlocks(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  const close = out.search(/<\/think>/i);
  if (close >= 0) out = out.slice(close + "</think>".length);
  return out.trim();
}

/** Fin de l'objet JSON qui commence à `start` (accolades équilibrées hors chaînes), -1 si l'objet n'est pas fermé. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Premier objet JSON lisible d'un texte (null si aucun) : on essaie d'abord le contenu des barrières ```json, puis
 * chaque « { » du texte, dans l'ordre.
 */
export function extractJsonObject(raw: string): unknown {
  const text = removeThinkBlocks(raw);
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g))
    if (m[1]) candidates.push(m[1]);
  candidates.push(text);
  for (const candidate of candidates) {
    for (
      let start = candidate.indexOf("{");
      start >= 0;
      start = candidate.indexOf("{", start + 1)
    ) {
      const end = objectEnd(candidate, start);
      if (end < 0) continue;
      try {
        const value: unknown = JSON.parse(candidate.slice(start, end + 1));
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // objet suivant
      }
    }
  }
  return null;
}

/** Réponse du modèle → sortie d'un tour (forme vérifiée), ou rejet avec un code stable et des erreurs lisibles. */
export function parseTurnOutput(res: {
  text: string;
  finishReason: string | null;
}): TurnParseResult {
  if (res.finishReason === "length")
    return {
      ok: false,
      code: "truncated",
      errors: ["Réponse coupée (longueur maximale atteinte)."],
    };
  const value = extractJsonObject(res.text ?? "");
  if (value === null)
    return {
      ok: false,
      code: "invalid_output",
      errors: ["Aucun objet JSON lisible dans la réponse."],
    };
  const checked = checkTurnOutput(value);
  if (!checked.ok) return { ok: false, code: "invalid_output", errors: checked.errors };
  return { ok: true, output: checked.value };
}
