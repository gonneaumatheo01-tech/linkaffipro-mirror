/**
 * Phase 30 — verrou du QA Global au point d'envoi des posts (`sendPost`, avant le choix bot / compte connecté).
 * Un post d'agent (`agentMissionId`) ne part que si une approbation existe pour l'empreinte de son contenu ACTUEL
 * (texte, médias, boutons, canal) ; sinon le QA vérifie maintenant (30 s au plus) :
 * - indisponible (délai, erreur, plafond) → post remis en SCHEDULED 5 min plus tard, sans compter d'échec, raison claire ;
 * - refusé → post CANCELLED avec le motif (jamais envoyé), la mission revient à la Rédaction avec les corrections ;
 * - 3e refus → post retenu en DRAFT, Kevin demande au client de trancher (« Publier quand même » / « Non »).
 * Un post de l'équipe humaine (sans mission) n'est jamais touché.
 */
import { agentPostSendGate, type AgentPostRow, type SendGateDecision } from "@linkaffipro/agents";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { workerAgentsDeps } from "../agents/deps";

type PostRef = AgentPostRow & { botId?: string | null };

/** Rend vrai si le post peut partir ; sinon il est déjà retenu (statut et raison écrits). */
export async function passesQaGate(post: PostRef, decide: (p: AgentPostRow) => Promise<SendGateDecision> = (p) => agentPostSendGate(workerAgentsDeps(), p)): Promise<boolean> {
  if (!post.agentMissionId) return true;
  const d = await decide(post);
  if (d.decision === "send") return true;
  const data =
    d.decision === "held"
      ? { status: "SCHEDULED" as const, scheduledAt: d.retryAt, lastError: d.reason }
      : d.decision === "human"
        ? { status: "DRAFT" as const, lastError: d.reason.slice(0, 500) }
        : { status: "CANCELLED" as const, lastError: d.reason.slice(0, 500) };
  await prisma.post.update({ where: { id: post.id }, data });
  await recordEvent({
    type: `qa.post.${d.decision}`,
    channelId: post.channelId,
    botId: post.botId ?? null,
    payload: toJsonValue({ postId: post.id, missionId: post.agentMissionId, ...(d.decision === "held" ? { retryAt: d.retryAt.toISOString() } : {}) }),
  });
  return false;
}
