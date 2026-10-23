/**
 * Fournisseur vidéo (phase 20) : remplacement de la personne entière d'une vidéo source par le personnage de la
 * persona (fal.ai Wan 2.2 Animate « replace », Magic Hour en repli : visage seulement). Travail asynchrone : soumission,
 * puis état relu par l'étape `media-ia` qui se ré-enfile (pas de webhook public).
 */
export type VideoResolution = "480p" | "580p" | "720p";

/** Fichier d'entrée : octets d'un `MediaAsset` (le fournisseur l'envoie sur son propre stockage, jamais notre site). */
export type ProviderFile = { bytes: Uint8Array; mimeType: string; filename: string };

export type ReplaceInput = {
  sourceVideo: ProviderFile;
  /** Image de référence du personnage (première de `Persona.referenceImageIds`). */
  referenceImage: ProviderFile;
  resolution: VideoResolution;
  prompt?: string;
  /** Durée et images par seconde de la source, pour estimer le coût avant l'appel. */
  durationSec: number;
  fps?: number | null;
  /** `MediaAsset` de la vidéo source (le faux fournisseur la renvoie telle quelle). */
  sourceAssetId?: string;
};

/**
 * `ref` : adresses d'état et de résultat renvoyées par le fournisseur (fal : `status_url`, `response_url`), gardées
 * dans la mission et redonnées à `poll` (fal refuse une adresse reconstruite avec le chemin complet du modèle).
 */
export type ReplaceStart = { jobId: string; estimatedCents: number; ref?: VideoJobRef };
export type VideoJobRef = { statusUrl?: string; responseUrl?: string };

export type VideoPoll = {
  status: "queued" | "running" | "done" | "failed";
  outputUrl?: string;
  actualCents?: number;
  error?: string;
  /** Erreur passagère (429, 5xx, réseau) : relire plus tard, ne pas compter comme un échec. */
  transient?: boolean;
};

export type VideoProvider = {
  name: "fal" | "magichour" | "fake";
  /** Coût estimé en centimes d'euro, AVANT l'appel (plafonds). */
  estimateCents(input: Pick<ReplaceInput, "durationSec" | "fps" | "resolution">): number;
  startReplace(input: ReplaceInput): Promise<ReplaceStart>;
  poll(jobId: string, ref?: VideoJobRef): Promise<VideoPoll>;
  /** Téléchargement du résultat (adresse temporaire du fournisseur). */
  download(url: string): Promise<ProviderFile>;
};
