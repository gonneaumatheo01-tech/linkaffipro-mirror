import { AiError } from "./errors";
import { AI_LABELS, AI_LANGUAGES, type AiLanguage, type AiVersion } from "./types";

/** Isole l'objet JSON d'une réponse (tolère un bloc de code ou une phrase autour). */
export function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start)
    throw new AiError("invalid_output", "La réponse de l'IA n'est pas au format attendu.");
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new AiError("invalid_output", "La réponse de l'IA n'est pas un JSON valide.");
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `{ versions: [{ text, why }] }` → versions (au moins une, `why` facultatif remplacé par une phrase neutre). */
export function parseVersions(raw: string): AiVersion[] {
  const data = extractJson(raw);
  if (!isRecord(data) || !Array.isArray(data.versions))
    throw new AiError("invalid_output", "La réponse de l'IA ne contient pas de versions.");
  const versions: AiVersion[] = [];
  for (const v of data.versions) {
    if (!isRecord(v) || typeof v.text !== "string" || !v.text.trim()) continue;
    versions.push({
      text: v.text.trim(),
      why: typeof v.why === "string" && v.why.trim() ? v.why.trim() : "Version reformulée.",
    });
  }
  if (versions.length === 0)
    throw new AiError(
      "invalid_output",
      "La réponse de l'IA ne contient aucune version exploitable.",
    );
  return versions.slice(0, 3);
}

/** `{ translations: { en: "…" } }` → une version par langue connue. */
export function parseTranslations(raw: string): AiVersion[] {
  const data = extractJson(raw);
  if (!isRecord(data) || !isRecord(data.translations))
    throw new AiError("invalid_output", "La réponse de l'IA ne contient pas de traductions.");
  const versions: AiVersion[] = [];
  for (const lang of AI_LANGUAGES) {
    const t = data.translations[lang];
    if (typeof t === "string" && t.trim())
      versions.push({ text: t.trim(), why: `Traduction : ${languageName(lang)}.`, lang });
  }
  if (versions.length === 0)
    throw new AiError(
      "invalid_output",
      "La réponse de l'IA ne contient aucune traduction exploitable.",
    );
  return versions;
}

function languageName(lang: AiLanguage): string {
  return AI_LABELS.language[lang].toLowerCase();
}
