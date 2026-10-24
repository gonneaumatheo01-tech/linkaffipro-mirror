/**
 * Paramètres des actions du Boss (phase 26) : une seule déclaration donne le schéma JSON strict envoyé à l'IA
 * (`additionalProperties: false`, `required`) et la validation par le code (`parse`). Aucune dépendance : le paquet
 * n'a pas zod. Les textes sont bornés (200 caractères), les nombres bornés, les listes fermées.
 */

export type ParamField =
  | { kind: "string"; description: string; optional?: boolean; maxLength?: number }
  | { kind: "int"; description: string; optional?: boolean; min: number; max: number }
  | { kind: "number"; description: string; optional?: boolean; min: number; max: number }
  | { kind: "bool"; description: string; optional?: boolean }
  | { kind: "enum"; description: string; optional?: boolean; values: readonly string[] };

export type ParamSpec = Record<string, ParamField>;

export type ParseResult<P> = { ok: true; params: P } | { ok: false; error: string };

export const str = (description: string, opts: { optional?: boolean; maxLength?: number } = {}): ParamField => ({
  kind: "string",
  description,
  ...opts,
});
export const int = (description: string, min: number, max: number, optional = false): ParamField => ({
  kind: "int",
  description,
  min,
  max,
  optional,
});
export const num = (description: string, min: number, max: number, optional = false): ParamField => ({
  kind: "number",
  description,
  min,
  max,
  optional,
});
export const bool = (description: string, optional = false): ParamField => ({ kind: "bool", description, optional });
export const oneOf = (description: string, values: readonly string[], optional = false): ParamField => ({
  kind: "enum",
  description,
  values,
  optional,
});

/** Schéma JSON strict (paramètres d'un outil). */
export function jsonSchemaOf(spec: ParamSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, f] of Object.entries(spec)) {
    if (!f.optional) required.push(name);
    switch (f.kind) {
      case "string":
        properties[name] = { type: "string", description: f.description, maxLength: f.maxLength ?? 200 };
        break;
      case "int":
        properties[name] = { type: "integer", description: f.description, minimum: f.min, maximum: f.max };
        break;
      case "number":
        properties[name] = { type: "number", description: f.description, minimum: f.min, maximum: f.max };
        break;
      case "bool":
        properties[name] = { type: "boolean", description: f.description };
        break;
      case "enum":
        properties[name] = { type: "string", enum: [...f.values], description: f.description };
        break;
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(?:[.,]\d+)?$/.test(v.trim())) return Number(v.trim().replace(",", "."));
  return null;
}

/** Validation par le code : objet simple, aucune clé inconnue, chaque champ du bon type et dans ses bornes. */
export function parseWith<P>(spec: ParamSpec, input: unknown): ParseResult<P> {
  const raw = input ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "paramètres : objet attendu" };
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!(k in spec)) return { ok: false, error: `paramètre inconnu : ${k}` };
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(spec)) {
    const v = obj[name];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "" && f.kind !== "string")) {
      if (f.optional) continue;
      return { ok: false, error: `paramètre manquant : ${name}` };
    }
    switch (f.kind) {
      case "string": {
        if (typeof v !== "string") return { ok: false, error: `${name} : texte attendu` };
        const t = v.trim();
        if (!t) {
          if (f.optional) continue;
          return { ok: false, error: `${name} : texte vide` };
        }
        if (t.length > (f.maxLength ?? 200)) return { ok: false, error: `${name} : texte trop long` };
        out[name] = t;
        break;
      }
      case "int":
      case "number": {
        const n = asNumber(v);
        if (n === null) return { ok: false, error: `${name} : nombre attendu` };
        if (f.kind === "int" && !Number.isInteger(n)) return { ok: false, error: `${name} : nombre entier attendu` };
        if (n < f.min || n > f.max) return { ok: false, error: `${name} : entre ${f.min} et ${f.max}` };
        out[name] = n;
        break;
      }
      case "bool": {
        if (typeof v !== "boolean") return { ok: false, error: `${name} : vrai ou faux attendu` };
        out[name] = v;
        break;
      }
      case "enum": {
        if (typeof v !== "string" || !f.values.includes(v)) return { ok: false, error: `${name} : valeur non permise` };
        out[name] = v;
        break;
      }
    }
  }
  return { ok: true, params: out as P };
}
