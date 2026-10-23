/**
 * « Médias du personnage » d'une persona (phase 20) : images de référence (1 à 3, la première sert au remplacement
 * dans les vidéos), fichier du personnage (adresse https du fichier LoRA), mot déclencheur, poids, consignes de tenue
 * et d'ambiance. Lecture et validation pures (testées dans media.test.ts) ; l'existence des images est vérifiée par
 * `media-save.ts`.
 */
import { z } from "zod";

export const PERSONA_MEDIA_LIMITS = {
  references: 3,
  loraUrl: 1000,
  loraTrigger: 60,
  loraScale: { min: 0.1, max: 1.5, def: 0.8 },
  mediaNotes: 2000,
} as const;

export type PersonaMediaInput = {
  referenceImageIds: string[];
  loraUrl: string | null;
  loraTrigger: string | null;
  loraScale: number;
  mediaNotes: string | null;
};

export type PersonaMediaErrors = Partial<Record<keyof PersonaMediaInput, string>>;

export type PersonaMediaValidation =
  | { ok: true; data: PersonaMediaInput }
  | { ok: false; error: string; errors: PersonaMediaErrors };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `Persona.referenceImageIds` (JSON) → identifiants, sans doublon, 3 au plus ; une valeur abîmée donne []. */
export function parseReferenceIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && ID.test(x) && !out.includes(x)) out.push(x);
  return out.slice(0, PERSONA_MEDIA_LIMITS.references);
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

/** Lit le formulaire « Médias du personnage » (champ caché `referenceImageIds` : identifiants séparés par des virgules). */
export function validatePersonaMediaForm(fd: FormData): PersonaMediaValidation {
  const L = PERSONA_MEDIA_LIMITS;
  const errors: PersonaMediaErrors = {};

  const rawIds = str(fd, "referenceImageIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const referenceImageIds: string[] = [];
  for (const id of rawIds) if (!referenceImageIds.includes(id)) referenceImageIds.push(id);
  if (referenceImageIds.some((id) => !ID.test(id)))
    errors.referenceImageIds = "Une image n'a pas pu être lue : rechargez la page.";
  else if (referenceImageIds.length > L.references)
    errors.referenceImageIds = `${L.references} images au plus : retirez-en une.`;

  const loraUrl = str(fd, "loraUrl").trim();
  if (loraUrl.length > L.loraUrl) errors.loraUrl = `${L.loraUrl} caractères au plus.`;
  else if (loraUrl && !httpsUrl.safeParse(loraUrl).success)
    errors.loraUrl = "Collez une adresse complète qui commence par https://";

  const loraTrigger = str(fd, "loraTrigger").replace(/\s+/g, " ").trim();
  if (loraTrigger.length > L.loraTrigger) errors.loraTrigger = `${L.loraTrigger} caractères au plus.`;

  const scaleRaw = str(fd, "loraScale").trim().replace(",", ".");
  let loraScale: number = L.loraScale.def;
  if (scaleRaw) {
    const n = Number(scaleRaw);
    if (!Number.isFinite(n) || n < L.loraScale.min || n > L.loraScale.max)
      errors.loraScale = "Un nombre de 0,1 à 1,5 (0,8 conseillé).";
    else loraScale = Math.round(n * 100) / 100;
  }

  const mediaNotes = str(fd, "mediaNotes").trim();
  if (mediaNotes.length > L.mediaNotes) errors.mediaNotes = `${L.mediaNotes} caractères au plus.`;

  if (loraUrl && !loraTrigger && !errors.loraUrl)
    errors.loraTrigger = "Indiquez le mot déclencheur qui va avec ce fichier (donné avec le fichier).";

  const count = Object.keys(errors).length;
  if (count > 0)
    return {
      ok: false,
      error: count === 1 ? "Un champ est à corriger." : `${count} champs sont à corriger.`,
      errors,
    };
  return {
    ok: true,
    data: {
      referenceImageIds,
      loraUrl: loraUrl || null,
      loraTrigger: loraTrigger || null,
      loraScale,
      mediaNotes: mediaNotes || null,
    },
  };
}

/** Champs modifiés (pour le journal), jamais les valeurs elles-mêmes. */
export function changedMediaFields(
  before: PersonaMediaInput,
  after: PersonaMediaInput,
): Array<keyof PersonaMediaInput> {
  const out: Array<keyof PersonaMediaInput> = [];
  if (before.referenceImageIds.join(",") !== after.referenceImageIds.join(",")) out.push("referenceImageIds");
  for (const k of ["loraUrl", "loraTrigger", "loraScale", "mediaNotes"] as const)
    if (before[k] !== after[k]) out.push(k);
  return out;
}

/** Domaine de l'adresse du fichier (le journal ne garde jamais l'adresse entière, qui peut porter une signature). */
export function urlHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
