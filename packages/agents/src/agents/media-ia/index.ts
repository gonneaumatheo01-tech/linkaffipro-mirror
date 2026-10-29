/**
 * Agent Média IA (phase 20, équipe Dating) : produit la photo du post (LoRA) ; rien pour un post texte (étape
 * sautée). Les vidéos IA ont été retirées le 29 octobre 2026 (décision du client) : une ancienne mission « vidéo »
 * reprise devient une photo. Tous les appels passent par le registre (faux fournisseur en simulation sans clé).
 */
import type { AgentDefinition } from "../../types";
import { runPhoto } from "./photo";

export const agent: AgentDefinition = {
  key: "media-ia",
  async run(mission, ctx) {
    const format = mission.payload.format ?? "text";
    if (format === "photo" || format === "video") {
      // Média déjà produit (étape rejouée) : rien à refaire.
      if (format === "photo" && mission.payload.mediaAssetId) return { ok: true, summary: "photo déjà produite" };
      const m = format === "video" ? { ...mission, payload: { ...mission.payload, format: "photo" as const, mediaAssetId: null, sourceAssetId: null } } : mission;
      const res = await runPhoto(m, ctx);
      return format === "video" && res.ok ? { ...res, output: { format: "photo", sourceAssetId: null, mediaJob: null, ...(res.output ?? {}) } } : res;
    }
    return { ok: true, skipped: true, summary: "post texte : aucun média à produire" };
  },
};
