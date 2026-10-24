/**
 * Phase 26, section 4 — ce qu'il faut savoir de la demande en cours pour juger si un membre peut y répondre
 * (`repondre_demande`, `plus_tard`) : adressée à lui, réservée à l'admin, adressée à un autre membre, posée dans une
 * autre conversation. Utilisé par `rightsScopeFor` (execute.ts) pour remplir `BossRightsScope`.
 */
import { currentHumanRequest } from "../../human/requests";
import { teamAdminOnlyRequest } from "../../human/delivery";
import type { AgentsDeps } from "../../types";
import type { BossChat } from "../contract";

export type BossRequestScope = {
  assignedToSpeaker: boolean;
  request: { adminOnly: boolean; assignedToOther: boolean; otherChat: boolean } | null;
};

type Cur = { kind: string; teamKey?: string | null; onAnswer?: unknown; chatId?: bigint | null; assigneeTelegramId?: bigint | null };

/** Règle pure : demande en cours (ou null) × membre qui parle (jamais l'admin) × conversation. */
export function requestScopeOf(cur: Cur | null, speakerTelegramId: bigint, chat: BossChat | null | undefined): BossRequestScope {
  if (!cur) return { assignedToSpeaker: false, request: null };
  const assignee = cur.assigneeTelegramId ?? null;
  const reqChat = cur.chatId ?? null;
  // Une question posée dans le groupe se remplit dans le groupe. En privé, un membre n'est jamais dans la
  // conversation d'une question (elles sont posées dans le groupe ou chez l'admin) ; une clé, elle, passe par
  // `memberPrivateSecret` (team/incoming.ts), jamais par ici.
  const otherChat = chat?.type === "group" ? reqChat !== chat.chatId : true;
  return {
    assignedToSpeaker: assignee !== null && assignee === speakerTelegramId && !otherChat,
    request: { adminOnly: teamAdminOnlyRequest(cur), assignedToOther: assignee !== null && assignee !== speakerTelegramId, otherChat },
  };
}

/** Lecture de la demande en cours puis `requestScopeOf`. */
export async function bossRequestScope(deps: AgentsDeps, speakerTelegramId: bigint, chat: BossChat | null | undefined): Promise<BossRequestScope> {
  const cur = (await currentHumanRequest(deps)) as Cur | null;
  return requestScopeOf(cur, speakerTelegramId, chat);
}
