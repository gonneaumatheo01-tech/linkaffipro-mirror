/**
 * Verdict du Contrôle qualité (règle pure). Les règles du code (contenu, doublon, média) priment toujours : l'avis de
 * l'IA peut demander de refaire ou de valider, jamais faire publier un texte qu'une règle refuse.
 * - règle refusée : refaire une fois (retour à Rédaction avec le motif), puis validation humaine ; un texte corrigé
 *   par l'admin qui ne passe pas les règles repart en validation ;
 * - règles passées : texte validé par l'admin → publier ; IA « non » → refaire une fois puis valider ; sinon le niveau
 *   d'autonomie décide (le « doute » de l'IA est une nouveauté).
 */
import { autonomyDecision, type AutonomyFacts } from "../../orchestrator/autonomy";

export type Judgement = "oui" | "non" | "doute" | null;

export type VerdictInput = {
  ruleProblems: string[];
  judgement: Judgement;
  judgementReason?: string | null;
  approved: boolean;
  redone: boolean;
  autonomyLevel: 0 | 1 | 2;
  facts: Omit<AutonomyFacts, "controlDoubt">;
};

export type Verdict =
  | { verdict: "publish"; reasons: string[] }
  | { verdict: "redo"; reasons: string[] }
  | { verdict: "validate"; reasons: string[]; reason: string };

export function decideVerdict(i: VerdictInput): Verdict {
  if (i.ruleProblems.length) {
    if (i.approved) return { verdict: "validate", reasons: i.ruleProblems, reason: `texte corrigé refusé par les règles : ${i.ruleProblems.join(" ; ")}` };
    if (!i.redone) return { verdict: "redo", reasons: i.ruleProblems };
    return { verdict: "validate", reasons: i.ruleProblems, reason: `refusé deux fois par les règles : ${i.ruleProblems.join(" ; ")}` };
  }
  if (i.approved) return { verdict: "publish", reasons: [] };
  if (i.judgement === "non") {
    const why = `relecture : ${i.judgementReason || "texte jugé peu naturel"}`;
    if (!i.redone) return { verdict: "redo", reasons: [why] };
    return { verdict: "validate", reasons: [why], reason: why };
  }
  const d = autonomyDecision(i.autonomyLevel, { ...i.facts, controlDoubt: i.judgement === "doute" });
  if (d.validate) return { verdict: "validate", reasons: [], reason: d.reason ?? "validation demandée" };
  return { verdict: "publish", reasons: [] };
}

/** Réponse JSON stricte de l'IA de relecture : `{ "verdict": "oui" | "non" | "doute", "reason": "…" }`. */
export function parseJudgement(raw: string): { judgement: Judgement; reason: string | null } {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) return { judgement: "doute", reason: "réponse de relecture illisible" };
  try {
    const d = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>;
    const v = typeof d.verdict === "string" ? d.verdict.toLowerCase().trim() : "";
    const reason = typeof d.reason === "string" ? d.reason.slice(0, 200) : null;
    if (v === "oui" || v === "non" || v === "doute") return { judgement: v, reason };
    return { judgement: "doute", reason: "réponse de relecture inattendue" };
  } catch {
    return { judgement: "doute", reason: "réponse de relecture illisible" };
  }
}

export const JUDGE_SYSTEM = [
  "Tu relis un post Telegram avant publication.",
  "Question : ce texte a-t-il l'air écrit par un humain, et respecte-t-il la fiche du canal ?",
  "Réponds UNIQUEMENT par un objet JSON : {\"verdict\": \"oui\" | \"non\" | \"doute\", \"reason\": \"…\"} (raison en une phrase).",
].join("\n");

/** Limites raisonnables d'un média de post (Bot API : 50 Mo en envoi, 10 Mo pour une photo). */
export const MEDIA_LIMITS = { videoBytes: 50 * 1024 * 1024, photoBytes: 10 * 1024 * 1024, videoSeconds: 600 };

export function mediaProblem(
  asset: { mimeType: string; size: number; duration: number | null } | null,
  format: string | undefined,
): string | null {
  if (!asset) return "média introuvable dans la médiathèque";
  const isVideo = asset.mimeType.startsWith("video/");
  const isPhoto = asset.mimeType.startsWith("image/");
  if (!isVideo && !isPhoto) return `type de média non accepté (${asset.mimeType})`;
  if (format === "video" && !isVideo) return "une vidéo était attendue";
  if (format === "photo" && !isPhoto) return "une photo était attendue";
  if (isVideo && asset.size > MEDIA_LIMITS.videoBytes) return "vidéo trop lourde (plus de 50 Mo)";
  if (isPhoto && asset.size > MEDIA_LIMITS.photoBytes) return "photo trop lourde (plus de 10 Mo)";
  if (isVideo && asset.duration !== null && asset.duration > MEDIA_LIMITS.videoSeconds) return "vidéo trop longue (plus de 10 minutes)";
  if (asset.size <= 0) return "média vide";
  return null;
}
