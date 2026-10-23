/**
 * Prompt des photos du personnage (Flux + LoRA, règle pure) : mot déclencheur du LoRA en tête, une scène du quotidien
 * tirée de l'identifiant de la mission (variée mais stable si l'étape est rejouée), consignes de la fiche persona
 * (`mediaNotes`), toujours une photo de téléphone réaliste, habillée et sans rien d'explicite.
 */
import { hashOf } from "../../providers/fake";

export const PHOTO_SCENES = [
  "casual selfie in a cozy apartment, soft window light",
  "mirror selfie in a stylish outfit, evening",
  "sitting at a coffee shop table, natural daylight, candid smile",
  "walking in a city street at golden hour",
  "relaxing on a sofa with a book, warm lamp light",
  "on a seaside boardwalk, summer afternoon",
  "restaurant terrace at night, soft bokeh lights",
  "getting ready in front of a mirror, playful look",
  "in a park on a sunny day, relaxed pose",
  "in the car passenger seat, daylight, friendly smile",
] as const;

export function buildPhotoPrompt(i: { trigger: string; mediaNotes?: string | null; theme?: string | null; seed: string }): string {
  const scene = PHOTO_SCENES[hashOf(i.seed) % PHOTO_SCENES.length]!;
  const parts = [
    i.trigger.trim(),
    scene,
    i.theme ? `mood: ${i.theme}` : null,
    "realistic smartphone photo, natural skin texture, fully clothed, tasteful, nothing explicit, no text, no watermark",
    i.mediaNotes ? `Notes: ${i.mediaNotes.replace(/\s+/g, " ").slice(0, 400)}` : null,
  ];
  return parts.filter(Boolean).join(", ");
}
