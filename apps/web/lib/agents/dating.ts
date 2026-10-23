/**
 * Équipe Rencontres (phase 20) à l'écran : fournisseur et résolution des vidéos, plafonds par défaut, mélange par
 * défaut d'un canal, « Produire un post de test », règles de dépôt des médias (images de référence, vidéos sources).
 * Fonctions pures (testées dans dating.test.ts). Réglages lus dans `AgentTeamConfig.settings` (`videoProvider`,
 * `videoResolution`) sans jamais effacer les autres clés que le moteur y range.
 */
import { z } from "zod";

/** Plafonds mensuels par défaut de l'équipe Rencontres (centimes) : 100 € de vidéos, 15 € de photos. */
export const DATING_DEFAULT_BUDGETS = { video: 10_000, image: 1_500 } as const;

/** Mélange par défaut d'un canal Rencontres (parts de la journée). */
export const DATING_DEFAULT_MIX = { video: 1, photo: 2, text: 1 } as const;

export const VIDEO_PROVIDERS = [
  { value: "fal", label: "fal.ai (personne entière remplacée)" },
  { value: "magichour", label: "Magic Hour (visage seulement)" },
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]["value"];

export const VIDEO_RESOLUTIONS = [
  { value: "480p", label: "480p : la moins chère" },
  { value: "580p", label: "580p : bon compromis (conseillé)" },
  { value: "720p", label: "720p : la plus nette, la plus chère" },
] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]["value"];

export const DEFAULT_VIDEO_PROVIDER: VideoProvider = "fal";
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "580p";

export type DatingMediaSettings = { videoProvider: VideoProvider; videoResolution: VideoResolution };

const providerSchema = z.enum(["fal", "magichour"]);
const resolutionSchema = z.enum(["480p", "580p", "720p"]);

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Réglages vidéo lus dans `AgentTeamConfig.settings` ; une valeur inconnue retombe sur la valeur par défaut. */
export function parseDatingSettings(settings: unknown): DatingMediaSettings {
  const s = record(settings);
  const p = providerSchema.safeParse(s.videoProvider);
  const r = resolutionSchema.safeParse(s.videoResolution);
  return {
    videoProvider: p.success ? p.data : DEFAULT_VIDEO_PROVIDER,
    videoResolution: r.success ? r.data : DEFAULT_VIDEO_RESOLUTION,
  };
}

/** Nouveaux réglages fusionnés dans les réglages existants (les autres clés du moteur sont gardées). */
export function mergeDatingSettings(settings: unknown, next: DatingMediaSettings): Record<string, unknown> {
  return { ...record(settings), videoProvider: next.videoProvider, videoResolution: next.videoResolution };
}

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Champs « Fournisseur des vidéos » et « Résolution » de la fiche d'équipe. */
export function parseDatingSettingsForm(fd: FormData): FormResult<DatingMediaSettings> {
  const p = providerSchema.safeParse(str(fd, "videoProvider"));
  if (!p.success) return { ok: false, error: "Fournisseur des vidéos : choisissez fal.ai ou Magic Hour." };
  const r = resolutionSchema.safeParse(str(fd, "videoResolution"));
  if (!r.success) return { ok: false, error: "Résolution des vidéos : choisissez 480p, 580p ou 720p." };
  return { ok: true, data: { videoProvider: p.data, videoResolution: r.data } };
}

export const TEST_POST_FORMATS = [
  { value: "video", label: "Vidéo" },
  { value: "photo", label: "Photo" },
  { value: "text", label: "Texte" },
] as const;
export type TestPostFormat = (typeof TEST_POST_FORMATS)[number]["value"];

/** « Produire un post de test » : type de post et persona (obligatoire pour une vidéo ou une photo). */
export function parseTestPostForm(fd: FormData): FormResult<{ format: TestPostFormat; personaId: string | null }> {
  const f = z.enum(["video", "photo", "text"]).safeParse(str(fd, "format"));
  if (!f.success) return { ok: false, error: "Choisissez le type de post : vidéo, photo ou texte." };
  const personaId = str(fd, "personaId") || null;
  if (personaId && !/^[A-Za-z0-9_-]{1,64}$/.test(personaId))
    return { ok: false, error: "Persona inconnue : rechargez la page." };
  if (!personaId && f.data !== "text")
    return { ok: false, error: "Choisissez la persona : une vidéo ou une photo est faite pour un personnage." };
  return { ok: true, data: { format: f.data, personaId } };
}

// ------------------------------------------------------------------
// Dépôt des médias des agents (route `/api/agents/media`)
// ------------------------------------------------------------------

const MB = 1024 * 1024;

export type AgentMediaPurpose = "reference" | "source";

/** Ce qui est accepté pour chaque dépôt : types et taille maximale. */
export const AGENT_MEDIA_RULES: Record<
  AgentMediaPurpose,
  { mimes: readonly string[]; maxBytes: number; kind: "REFERENCE" | "SOURCE"; noun: string; types: string }
> = {
  reference: {
    mimes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * MB,
    kind: "REFERENCE",
    noun: "image",
    types: "JPEG, PNG ou WebP",
  },
  source: {
    mimes: ["video/mp4", "video/quicktime", "video/webm"],
    maxBytes: 50 * MB,
    kind: "SOURCE",
    noun: "vidéo",
    types: "MP4, MOV ou WebM",
  },
};

export function parsePurpose(v: unknown): AgentMediaPurpose | null {
  return v === "reference" || v === "source" ? v : null;
}

/** Un fichier déposé est-il acceptable ? Message clair sinon (type, taille). */
export function agentUploadProblem(purpose: AgentMediaPurpose, mime: string, size: number): string | null {
  const rule = AGENT_MEDIA_RULES[purpose];
  if (!rule.mimes.includes(mime))
    return `Choisissez une ${rule.noun} ${rule.types}.`;
  if (size <= 0) return "Fichier vide.";
  if (size > rule.maxBytes) {
    const mb = Math.round((size / MB) * 10) / 10;
    return purpose === "source"
      ? `Vidéo trop lourde (${String(mb).replace(".", ",")} Mo, ${rule.maxBytes / MB} Mo au plus) : raccourcissez-la (15 secondes suffisent) ou exportez-la en 720p.`
      : `Image trop lourde (${String(mb).replace(".", ",")} Mo, ${rule.maxBytes / MB} Mo au plus) : réduisez-la avant de l'envoyer.`;
  }
  return null;
}

/**
 * Le même fichier existe déjà en base (même empreinte) : peut-on le ranger pour cette persona ? Refusé s'il est déjà
 * rangé pour une autre persona, ou rangé autrement (une vidéo produite n'est pas une vidéo source).
 */
export function existingAssetProblem(
  existing: { personaId: string | null; kind: string | null },
  target: { personaId: string; kind: "REFERENCE" | "SOURCE" },
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
  if (name === "magichour") return "Magic Hour";
  if (name === "fake") return "simulation";
  return name;
}
