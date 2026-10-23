/**
 * Fournisseur vidéo (phase 20 : remplacement du personnage, fal.ai / Magic Hour). Interface seulement en phase 19.
 */
export type VideoJobRequest = { sourceAssetId: string; referenceImageUrl?: string | null; personaId?: string | null };
export type VideoJobResult = { status: "done" | "pending" | "failed"; assetId?: string; costCents: number; error?: string };
export type VideoProvider = {
  name: string;
  submit(req: VideoJobRequest): Promise<VideoJobResult & { jobRef?: string }>;
  poll?(jobRef: string): Promise<VideoJobResult>;
};
