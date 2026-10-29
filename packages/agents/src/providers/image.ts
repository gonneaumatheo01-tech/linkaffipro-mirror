/**
 * Fournisseur d'images (phase 20) : photos neuves du personnage générées avec son LoRA (fal.ai Flux + LoRA).
 */
/** Fichier échangé avec un fournisseur : octets d'un `MediaAsset` (envoyés sur son propre stockage, jamais notre site). */
export type ProviderFile = { bytes: Uint8Array; mimeType: string; filename: string };

export type ImageAspect = "portrait" | "square" | "landscape";

export type ImageGenerateInput = {
  loraUrl: string;
  triggerWord: string;
  loraScale?: number;
  /** Le prompt contient toujours le mot déclencheur. */
  prompt: string;
  count: number;
  aspect: ImageAspect;
  /** Première image de référence de la persona (le faux fournisseur la renvoie). */
  referenceAssetId?: string | null;
};

export type ImageGenerateResult = { images: { url: string; width?: number; height?: number }[]; cents: number };

/** Travail photo déjà soumis (fal : identifiant et adresses), gardé dans la mission pour être relu sans resoumettre. */
export type ImageJobRef = { requestId: string; statusUrl: string; responseUrl: string; cents: number };

export type ImageGenerateOptions = {
  /** Travail déjà soumis à relire (aucune nouvelle soumission, donc aucun nouveau paiement). */
  resume?: ImageJobRef | null;
  /** Appelé juste après la soumission payante, avant toute attente (repère gardé dans la mission). */
  onSubmitted?: (job: ImageJobRef) => Promise<void>;
};

export type ImageProvider = {
  name: "fal" | "fake";
  estimateCents(input: Pick<ImageGenerateInput, "count" | "aspect">): number;
  generate(input: ImageGenerateInput, opts?: ImageGenerateOptions): Promise<ImageGenerateResult>;
  download(url: string): Promise<ProviderFile>;
};
