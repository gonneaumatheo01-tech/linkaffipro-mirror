/**
 * Faux fournisseurs déterministes : tests, et IA de repli quand aucune clé Anthropic n'est réglée (Réglages → IA).
 * Le faux LLM reconnaît la tâche par la ligne « Tâche : <clé> » du message utilisateur (prompts des agents) et rend un
 * JSON valide ; texte choisi par une empreinte du message, donc stable pour une même demande.
 */
import type { LlmRequest, LlmResponse } from "../types";
import type { AgentLlmProvider } from "./llm";

const HOOKS = [
  "Ce soir, on ne fait pas les choses à moitié 🔥",
  "Tu sais ce qui manque à ta soirée ?",
  "Petit secret entre nous 🤫",
  "Dernière chance avant minuit ⏳",
  "Celle-là, tu ne l'as pas vue venir 😏",
  "On t'attendait, tu le sais ?",
  "Juste un clic et tout change ✨",
  "Rien de tel qu'un vendredi soir pour oser",
];
const BODIES = [
  "Une rencontre, un message, et la suite t'appartient.",
  "Les plus rapides ont déjà commencé, ne reste pas sur le banc.",
  "Ose le premier pas, le reste suit tout seul.",
  "Une ambiance que tu ne trouveras nulle part ailleurs.",
  "Ceux qui hésitent regardent, les autres en profitent.",
  "Un moment rien que pour toi, sans détour.",
  "Tu mérites mieux qu'une soirée banale.",
  "Laisse-toi surprendre, c'est le moment.",
];
const TOPICS = ["soirée", "rencontre", "surprise", "urgence", "défi", "confidence", "nouveauté", "week-end"];

export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type FakeLlmOptions = {
  /** Réponse imposée par tâche (tests). */
  responses?: Partial<Record<string, string | ((req: LlmRequest) => string)>>;
  /** Coût simulé par appel (centimes). */
  costCents?: number;
  /** Erreurs à lever aux N premiers appels (tests de reprise). */
  failFirst?: number;
};

export function taskOf(req: LlmRequest): string {
  return /T[âa]che\s*:\s*([a-z-]+)/i.exec(req.user)?.[1]?.toLowerCase() ?? "redaction";
}

export function createFakeLlm(opts: FakeLlmOptions = {}): AgentLlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let failures = opts.failFirst ?? 0;
  return {
    name: "fake",
    fake: true,
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);
      if (failures > 0) {
        failures--;
        throw new Error("Panne simulée du faux fournisseur");
      }
      const task = taskOf(req);
      const forced = opts.responses?.[task];
      if (forced !== undefined) {
        return { text: typeof forced === "function" ? forced(req) : forced, costCents: opts.costCents ?? 0 };
      }
      if (task === "controle") return { text: JSON.stringify({ verdict: "oui", reason: "Texte naturel." }), costCents: opts.costCents ?? 0 };
      const h = hashOf(req.user);
      const hook = HOOKS[h % HOOKS.length]!;
      const body = BODIES[(h >>> 8) % BODIES.length]!;
      const topic = TOPICS[(h >>> 16) % TOPICS.length]!;
      const text = `<b>${hook}</b>\n${body}`;
      return { text: JSON.stringify({ text, hook, topic }), costCents: opts.costCents ?? 0 };
    },
  };
}
