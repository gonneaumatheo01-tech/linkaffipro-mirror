/**
 * Équipe Rencontres (phase 20) à l'écran : plafond par défaut, mélange par défaut d'un canal, « Produire un post de
 * test », règles de dépôt des images de référence. Les vidéos IA ont été retirées le 29 octobre 2026 (décision du
 * client) : photos et textes seulement. Fonctions pures (testées dans dating.test.ts).
 */
import { z } from "zod";

/** Plafond mensuel par défaut de l'équipe Rencontres (centimes) : 15 € de photos. */
export const DATING_DEFAULT_BUDGETS = { image: 1_500 } as const;

/** Mélange par défaut d'un canal Rencontres (parts de la journée) : 3 photos pour 1 texte. */
export const DATING_DEFAULT_MIX = { video: 0, photo: 3, text: 1 } as const;

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export const TEST_POST_FORMATS = [
  { value: "photo", label: "Photo" },
  { value: "text", label: "Texte" },
] as const;
export type TestPostFormat = (typeof TEST_POST_FORMATS)[number]["value"];

/** « Produire un post de test » : type de post et persona (obligatoire pour une photo). */
export function parseTestPostForm(fd: FormData): FormResult<{ format: TestPostFormat; personaId: string | null }> {
  const f = z.enum(["photo", "text"]).safeParse(str(fd, "format"));
  if (!f.success) return { ok: false, error: "Choisissez le type de post : photo ou texte." };
  const personaId = str(fd, "personaId") || null;
  if (personaId && !/^[A-Za-z0-9_-]{1,64}$/.test(personaId))
    return { ok: false, error: "Persona inconnue : rechargez la page." };
  if (!personaId && f.data !== "text")
    return { ok: false, error: "Choisissez la persona : une photo est faite pour un personnage." };
  return { ok: true, data: { format: f.data, personaId } };
}

// ------------------------------------------------------------------
// Dépôt des médias des agents (route `/api/agents/media`)
// ------------------------------------------------------------------

const MB = 1024 * 1024;

export type AgentMediaPurpose = "reference";

/** Ce qui est accepté pour chaque dépôt : types et taille maximale. */
export const AGENT_MEDIA_RULES: Record<
  AgentMediaPurpose,
  { mimes: readonly string[]; maxBytes: number; kind: "REFERENCE"; noun: string; types: string }
> = {
  reference: {
    mimes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * MB,
    kind: "REFERENCE",
    noun: "image",
    types: "JPEG, PNG ou WebP",
  },
};

export function parsePurpose(v: unknown): AgentMediaPurpose | null {
  return v === "reference" ? v : null;
}

/** Un fichier déposé est-il acceptable ? Message clair sinon (type, taille). */
export function agentUploadProblem(purpose: AgentMediaPurpose, mime: string, size: number): string | null {
  const rule = AGENT_MEDIA_RULES[purpose];
  if (!rule.mimes.includes(mime))
    return `Choisissez une ${rule.noun} ${rule.types}.`;
  if (size <= 0) return "Fichier vide.";
  if (size > rule.maxBytes) {
    const mb = Math.round((size / MB) * 10) / 10;
    return `Image trop lourde (${String(mb).replace(".", ",")} Mo, ${rule.maxBytes / MB} Mo au plus) : réduisez-la avant de l'envoyer.`;
  }
  return null;
}

/**
 * Le même fichier existe déjà en base (même empreinte) : peut-on le ranger pour cette persona ? Refusé s'il est déjà
 * rangé pour une autre persona, ou rangé autrement.
 */
export function existingAssetProblem(
  existing: { personaId: string | null; kind: string | null },
  target: { personaId: string; kind: "REFERENCE" },
): string | null {
  if (existing.personaId && existing.personaId !== target.personaId)
    return "Ce fichier est déjà rangé pour une autre persona.";
  if (existing.kind && existing.kind !== target.kind && !(existing.kind === "PHOTO" && target.kind === "REFERENCE"))
    return "Ce fichier est déjà dans la médiathèque, rangé autrement.";
  return null;
}

/** Libellé court du type d'un média des agents. */
export const MEDIA_KIND_LABELS: Record<string, string> = {
  SOURCE: "Vidéo source",
  GENERATED: "Produit par les agents",
  PHOTO: "Photo",
  REFERENCE: "Image de référence",
};

export function providerLabel(name: string | null | undefined): string {
  if (!name) return "";
  if (name === "fal") return "fal.ai";
  if (name === "fake") return "simulation";
  return name;
}
