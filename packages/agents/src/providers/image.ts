/**
 * Fournisseur d'images (phase 20) : photos neuves du personnage générées avec son LoRA (fal.ai Flux + LoRA).
 */
export type ImageAspect = "portrait" | "square" | "landscape";

export type ImageGenerateInput = {
  loraUrl: string;
  triggerWord: string;
  loraScale?: number;
  /** Le prompt contient toujours le mot déclencheur. */
  prompt: string;
  count: number;
  aspect: ImageAspect;
};

export type ImageGenerateResult = { images: { url: string; width?: number; height?: number }[]; cents: number };

export type ImageProvider = {
  name: "fal" | "fake";
  estimateCents(input: Pick<ImageGenerateInput, "count" | "aspect">): number;
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
  download(url: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }>;
};
