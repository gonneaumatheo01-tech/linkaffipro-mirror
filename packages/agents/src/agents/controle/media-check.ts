/**
 * Contrôle d'un média produit par l'IA (phase 20) : 3 images d'une vidéo (début, milieu, fin, extraites par ffmpeg
 * dans le worker) ou la photo elle-même, soumises au modèle rapide avec une question fermée (défaut visible : mains,
 * visage, membres, texte déformé ?). Réponse JSON stricte `{ "defect": "oui" | "non" | "doute", "reason": "…" }`.
 * Un fichier illisible ou une durée hors bornes est un échec TECHNIQUE : le média n'est jamais publié.
 */
import { createHash } from "node:crypto";
import { mediaSettings } from "../../providers/registry";
import type { AgentContext, LlmImage, Mission } from "../../types";

export type Defect = "oui" | "non" | "doute";

export const MEDIA_JUDGE_SYSTEM = [
  "Tu contrôles un média (photo, ou 3 images d'une vidéo : début, milieu, fin) avant sa publication sur Telegram.",
  "Question : y a-t-il un défaut visible — mains ou doigts déformés, visage déformé ou incohérent, membres en trop ou",
  "manquants, texte ou logo déformé, image cassée ou floue au point d'être inutilisable ?",
  "Réponds UNIQUEMENT par un objet JSON : {\"defect\": \"oui\" | \"non\" | \"doute\", \"reason\": \"…\", \"frame\": 1}",
  "(« frame » : numéro de l'image la plus concernée, facultatif ; raison en une phrase).",
].join("\n");

/** Réponse stricte ; illisible ou inattendue → « doute » (jamais publié sans regard humain). */
export function parseDefect(raw: string): { defect: Defect; reason: string; frame: number | null } {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return { defect: "doute", reason: "réponse du contrôle illisible", frame: null };
  try {
    const d = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
    const v = typeof d.defect === "string" ? d.defect.toLowerCase().trim() : "";
    const reason = typeof d.reason === "string" && d.reason.trim() ? d.reason.trim().slice(0, 200) : "sans précision";
    const frame = typeof d.frame === "number" && Number.isInteger(d.frame) && d.frame >= 1 ? d.frame : null;
    if (v === "oui" || v === "non" || v === "doute") return { defect: v, reason, frame };
    return { defect: "doute", reason: "réponse du contrôle inattendue", frame: null };
  } catch {
    return { defect: "doute", reason: "réponse du contrôle illisible", frame: null };
  }
}

/** Bornes de durée d'une vidéo produite (pur) : au moins 0,5 s, au plus la durée maximale des sources + 5 s. */
export function durationProblem(durationSec: number | null | undefined, maxSourceSeconds: number): string | null {
  if (durationSec === null || durationSec === undefined) return null;
  if (durationSec < 0.5) return `vidéo trop courte (${durationSec.toFixed(1)} s)`;
  if (durationSec > maxSourceSeconds + 5) return `vidéo trop longue (${Math.round(durationSec)} s)`;
  return null;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type MediaCheck =
  | { kind: "skip" }
  | { kind: "technical"; reason: string }
  | { kind: "judged"; defect: Defect; reason: string; costCents: number; frame: Uint8Array | null; frameMime: string };

/** Contrôle du média de la mission (rien pour un média déposé par l'équipe ou un post texte). */
export async function checkProducedMedia(mission: Mission, ctx: AgentContext): Promise<MediaCheck> {
  const id = mission.payload.mediaAssetId;
  if (!id) return { kind: "skip" };
  const asset = await ctx.prisma.mediaAsset.findUnique({
    where: { id },
    select: { bytes: true, mimeType: true, origin: true, kind: true },
  });
  if (!asset || asset.origin !== "AI") return { kind: "skip" };
  const bytes = new Uint8Array(asset.bytes);
  if (!bytes.length) return { kind: "technical", reason: "fichier vide" };
  const isVideo = asset.mimeType.startsWith("video/");
  let frames: Uint8Array[];
  let mime = "image/jpeg";
  if (isVideo) {
    if (!ctx.frames) return { kind: "judged", defect: "doute", reason: "images de la vidéo non extraites ici", costCents: 0, frame: null, frameMime: mime };
    const res = await ctx.frames({ bytes, mimeType: asset.mimeType }, 3).catch(() => null);
    if (!res || !res.frames.length) return { kind: "technical", reason: "vidéo illisible" };
    const bad = durationProblem(res.durationSec, mediaSettings(ctx.settings).maxVideoSeconds);
    if (bad) return { kind: "technical", reason: bad };
    frames = res.frames;
  } else {
    if (!IMAGE_TYPES.has(asset.mimeType)) return { kind: "technical", reason: `format d'image non lu (${asset.mimeType})` };
    frames = [bytes];
    mime = asset.mimeType;
  }
  const llm = ctx.providers.llm;
  if (!llm) return { kind: "judged", defect: "doute", reason: "aucune IA pour regarder le média", costCents: 0, frame: frames[Math.floor(frames.length / 2)]!, frameMime: mime };
  const images: LlmImage[] = frames.map((f) => ({ mediaType: mime as LlmImage["mediaType"], base64: Buffer.from(f).toString("base64") }));
  const res = await llm.complete({
    model: ctx.settings.models.fast,
    system: MEDIA_JUDGE_SYSTEM,
    user: ["Tâche : controle-media", isVideo ? "Média : 3 images d'une vidéo (début, milieu, fin)." : "Média : une photo."].join("\n"),
    maxTokens: 300,
    images,
  });
  const d = parseDefect(res.text);
  const idx = d.frame && d.frame <= frames.length ? d.frame - 1 : Math.floor(frames.length / 2);
  return { kind: "judged", defect: d.defect, reason: d.reason, costCents: res.costCents, frame: frames[idx] ?? null, frameMime: mime };
}

/** Range l'image du doute (jointe à la validation) ; rend son identifiant. */
export async function storeControlFrame(ctx: AgentContext, mission: Mission, frame: Uint8Array, mimeType: string): Promise<string> {
  const sha256 = createHash("sha256").update(frame).update(`controle:${mission.id}`).digest("hex");
  const existing = await ctx.prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) return existing.id;
  const row = await ctx.prisma.mediaAsset.create({
    data: {
      filename: `controle-${mission.id}.${mimeType === "image/png" ? "png" : "jpg"}`,
      mimeType,
      size: frame.byteLength,
      sha256,
      bytes: Buffer.from(frame),
      teamKey: mission.teamKey,
      personaId: typeof mission.payload.personaId === "string" ? mission.payload.personaId : null,
      origin: "AI",
      tags: [mission.teamKey, "controle"],
    },
    select: { id: true },
  });
  return row.id;
}
