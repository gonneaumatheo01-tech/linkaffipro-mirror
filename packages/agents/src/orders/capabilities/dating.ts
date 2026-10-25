/**
 * Capacités du Chef Rencontres (phase 33) : programmer des posts, un post de test, changer le plan d'un canal,
 * question (missions, validations, stock de médias par persona, conversations de l'assistante de la phase 17).
 */
import { nowOf } from "../../admin/journal";
import { stockFacts } from "../../boss/facts";
import { DATING_DEFAULT_MIX } from "../../chiefs/dating-format";
import type { AgentsDeps } from "../../types";
import { changePlan, postUnique, programPosts, questionCapability, teamDayFacts, type PostsTeam } from "./posts";

const AGENTS = ["mediatheque", "media-ia", "redaction", "planification", "controle", "publication"];

export const DATING_TEAM: PostsTeam = {
  teamKey: "dating",
  agents: AGENTS,
  usesPersona: true,
  defaultMix: { ...DATING_DEFAULT_MIX },
  // Sujets libres pour les Rencontres : gardés tels quels (courts).
  async themes(_deps, p) {
    return { ok: true, themes: (p.themes ?? []).map((t) => t.trim().slice(0, 60)).filter(Boolean) };
  },
};

async function datingFacts(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const [day, stock] = await Promise.all([teamDayFacts(deps, "dating"), stockFacts(deps, "dating")]);
  const since = new Date(nowOf(deps).getTime() - 24 * 3600_000);
  const conversations = await deps.prisma.conversation.count({ where: { updatedAt: { gte: since } } });
  return {
    facts: { ...day.facts, stock: stock.facts, conversations24h: conversations },
    lines: [...day.lines, ...stock.lines, `Conversations de l'assistante (24 h) : ${conversations}.`],
  };
}

export const DATING_CAPABILITIES = [
  programPosts(DATING_TEAM),
  postUnique(DATING_TEAM),
  changePlan(DATING_TEAM),
  questionCapability("dating", AGENTS, "Répondre à une question sur l'équipe Rencontres (missions, validations, stock de médias, conversations)", datingFacts),
];
