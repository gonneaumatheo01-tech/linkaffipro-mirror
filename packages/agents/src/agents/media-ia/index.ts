/**
 * Agent Média IA (phase 20, équipe Dating) : produit le média du post selon son format — vidéo (remplacement du
 * personnage dans une vidéo source) ou photo (LoRA) ; rien pour un post texte (étape sautée). Tous les appels passent
 * par les fournisseurs du registre (faux fournisseur en simulation sans clé).
 */
import type { AgentDefinition } from "../../types";
import { runPhoto } from "./photo";
import { runVideo } from "./video";

export const agent: AgentDefinition = {
  key: "media-ia",
  async run(mission, ctx) {
    const format = mission.payload.format ?? "text";
    if (format === "video") return runVideo(mission, ctx);
    if (format === "photo") {
      // Média déjà produit (étape rejouée) : rien à refaire.
      if (mission.payload.mediaAssetId) return { ok: true, summary: "photo déjà produite" };
      return runPhoto(mission, ctx);
    }
    return { ok: true, skipped: true, summary: "post texte : aucun média à produire" };
  },
};
