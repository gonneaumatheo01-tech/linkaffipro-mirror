/** Fournisseur d'images (phase 20 : photos de la persona). Interface seulement en phase 19. */
export type ImageRequest = { prompt: string; personaId?: string | null; width?: number; height?: number };
export type ImageResult = { ok: boolean; bytes?: Uint8Array; mimeType?: string; costCents: number; error?: string };
export type ImageProvider = { name: string; generate(req: ImageRequest): Promise<ImageResult> };
