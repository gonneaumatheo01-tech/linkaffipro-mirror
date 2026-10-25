/**
 * Phase 33 — « dis à l'agent X de … » (section 5 bis) : l'agent est retrouvé dans l'annuaire (`findAgent`), ses
 * capacités dans le registre (`capabilitiesForAgent`, champ `agents` de chaque capacité) ; le planificateur ne reçoit
 * que ces capacités en indice et le plan est ramené à elles AVANT la validation par le code. La suite est celle de
 * tout ordre : récapitulatif, OUI si un vrai canal est touché, puis le Grand Chef (`runOrder`) confie l'étape au Chef.
 * Kevin ne parle jamais directement à un agent. Fonctions pures, sauf la lecture du registre.
 */
import { findAgent, type AgentEntry } from "./agents-dict";
import type { OrderPlan } from "./contract";
import { capabilitiesForAgent, type AnyCapability } from "./ports";
import { voiceTemplate, type VoiceTable } from "../boss/voice";

/**
 * Textes de Kevin de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`) : morceaux repris dans le récapitulatif d'un
 * ordre (« ce qui ne passe pas »). Fonctions pures : la première variante est prise (pas de rotation ici).
 */
export const AGENT_ORDER_VARIANTS = {
  notHisJob: voiceTemplate<{ agent: string }>([{ agent: "Rédaction" }], (p) => [`ce n'est pas le travail de l'agent ${p.agent}`, `l'agent ${p.agent} ne s'occupe pas de ça`]),
  cannot: voiceTemplate<{ agent: string; role: string }>([{ agent: "Horaires", role: "choisit les meilleures heures de chaque canal" }], (p) => [
    `l'agent ${p.agent} ne sait pas faire ça (${p.role})`,
    `ça ne rentre pas dans ce que fait l'agent ${p.agent} (${p.role})`,
  ]),
  thisInstruction: ["cette consigne", "ta consigne"],
} satisfies VoiceTable;

/** « dis à l'agent Rédaction d'écrire plus court » → { name: "Rédaction", rest: "écrire plus court" } (pur). */
export function agentAddressOf(text: string): { name: string; rest: string } | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const re =
    /^(?:kevin[, ]+)?(?:dis|demande|explique|transmets?|fais savoir|rappelle)\s+(?:à|a)\s+(?:l['’]\s*agent|l['’]équipe de l['’]agent|l['’]agente)\s+(.+?)\s+(?:de\s+|d['’]\s*|qu['’]\s*|que\s+)(.+)$/iu;
  const m = re.exec(t);
  if (m) return { name: m[1]!.replace(/[,:]+$/, "").trim(), rest: m[2]!.trim() };
  const m2 = /^(?:kevin[, ]+)?l['’]\s*agent\s+([^,:]+?)\s*[,:]\s*(.+)$/iu.exec(t);
  if (m2 && !/\b(fait quoi|il fait|elle fait|conseille|a écrit|a fait|va faire|qu['’]est-ce)\b/iu.test(m2[2]!)) return { name: m2[1]!.trim(), rest: m2[2]!.trim() };
  return null;
}

export type AgentTarget = { agent: AgentEntry; capabilities: AnyCapability[] };

/** Agent visé par la phrase, s'il est trouvé sans ambiguïté (lecture du registre). */
export function agentTargetOf(text: string): AgentTarget | { unknown: string } | null {
  const a = agentAddressOf(text);
  if (!a) return null;
  const f = findAgent(a.name);
  if (f.status !== "found") return { unknown: a.name };
  return { agent: f.agent, capabilities: capabilitiesForAgent(f.agent.key) };
}

/** Indice pour le planificateur : l'agent et les seules capacités à utiliser (données, pur). */
export function agentHint(t: AgentTarget): string {
  // voix-hors-charte:début (indice envoyé à l'IA du planificateur, pas un texte de Kevin)
  return `agent visé : ${t.agent.label} ; capacités à utiliser (une seule de préférence) : ${t.capabilities.map((c) => `${c.teamKey}.${c.key}`).join(", ")}`;
  // voix-hors-charte:fin
}

/**
 * Ramène un plan aux capacités de l'agent visé (pur) : une étape qui ne passe pas par lui devient une partie
 * impossible, avec ses capacités en replis (règle 3 : jamais un refus sec).
 */
export function restrictPlanToAgent<P extends OrderPlan>(plan: P, t: AgentTarget): P {
  const allowed = new Set(t.capabilities.map((c) => `${c.teamKey}:${c.key}`));
  const kept = plan.steps.filter((s) => allowed.has(`${s.teamKey}:${s.capability}`));
  const dropped = plan.steps.filter((s) => !allowed.has(`${s.teamKey}:${s.capability}`));
  if (!dropped.length && kept.length) return plan;
  const alternatives = t.capabilities.slice(0, 3).map((c) => ({ label: c.description.charAt(0).toLowerCase() + c.description.slice(1) }));
  const impossible = [
    ...plan.impossible,
    ...(kept.length
      ? dropped.map((s) => ({ part: s.capability.replace(/_/g, " "), reason: AGENT_ORDER_VARIANTS.notHisJob({ agent: t.agent.label })[0]!, alternatives }))
      : [
          {
            part: AGENT_ORDER_VARIANTS.thisInstruction[0]!,
            reason: AGENT_ORDER_VARIANTS.cannot({ agent: t.agent.label, role: `${t.agent.role.charAt(0).toLowerCase()}${t.agent.role.slice(1).replace(/\.$/, "")}` })[0]!,
            alternatives,
          },
        ]),
  ];
  return { ...plan, steps: kept, impossible };
}
