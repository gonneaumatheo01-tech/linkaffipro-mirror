/**
 * Échantillon d'un profil relu par l'IA (règle 5) : conversations marquées mineur, /stop ou fermées pour mineur
 * exclues ; au plus 40 conversations × 12 messages ; textes anonymisés et raccourcis ; aucun identifiant envoyé à l'IA.
 */
import type { AgentsPrisma } from "../../types";
import { anonymizeText } from "./anonymize";
import { hasReplied, type ProfileEventRow, type ProfileMessageRow, type ProfileRef } from "./profiles";
import { SAMPLE_MAX_CONVERSATIONS, SAMPLE_MAX_MESSAGES } from "./settings";

/** Longueur maximale d'un message de l'échantillon (assez pour juger le ton, jamais un long texte). */
export const SAMPLE_MESSAGE_MAX_CHARS = 280;
const EXCLUDED_CLOSE_REASONS = new Set(["MINOR", "STOP"]);
const EXCLUDING_EVENTS = new Set(["minor", "stopped"]);

export type SampleSourceMessage = {
  direction: "IN" | "OUT";
  author: string;
  text: string;
  isCommand: boolean;
  mediaKind: string | null;
  createdAt: Date;
};

export type SampleSourceConversation = {
  createdAt: Date;
  isMinor: boolean;
  stoppedAt: Date | null;
  closedReason: string | null;
  /** Types d'événements de la conversation (`minor`, `stopped`, `stage_changed`…). */
  eventTypes: readonly string[];
  stage: string;
  offerSends: number;
  converted: boolean;
  replied: boolean;
  /** Prénom, nom, pseudo de la personne ; prénom de la persona. */
  names: readonly (string | null)[];
  messages: readonly SampleSourceMessage[];
};

export type SampleMessage = { who: "personne" | "profil"; text: string };
export type SampleConversation = {
  n: string;
  replied: boolean;
  linkSent: boolean;
  converted: boolean;
  stage: string;
  messages: SampleMessage[];
};

/** Conversation exclue de tout échantillon (mineur, /stop, fermée pour mineur ou /stop). */
export function isExcludedFromSample(c: Pick<SampleSourceConversation, "isMinor" | "stoppedAt" | "closedReason" | "eventTypes">): boolean {
  return (
    c.isMinor ||
    c.stoppedAt !== null ||
    (c.closedReason !== null && EXCLUDED_CLOSE_REASONS.has(c.closedReason)) ||
    c.eventTypes.some((t) => EXCLUDING_EVENTS.has(t))
  );
}

function clip(s: string): string {
  const t = s.replace(/\s+/gu, " ").trim();
  return t.length > SAMPLE_MESSAGE_MAX_CHARS ? `${t.slice(0, SAMPLE_MESSAGE_MAX_CHARS - 1)}…` : t;
}

/** Échantillon d'un profil (pur) : les plus récentes d'abord, plafonds appliqués, tout anonymisé. */
export function buildSample(
  conversations: readonly SampleSourceConversation[],
  limits: { conversations?: number; messages?: number } = {},
): SampleConversation[] {
  const maxConv = Math.min(limits.conversations ?? SAMPLE_MAX_CONVERSATIONS, SAMPLE_MAX_CONVERSATIONS);
  const maxMsg = Math.min(limits.messages ?? SAMPLE_MAX_MESSAGES, SAMPLE_MAX_MESSAGES);
  return [...conversations]
    .filter((c) => !isExcludedFromSample(c))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((c) => {
      const names = c.names.filter((n): n is string => Boolean(n));
      const messages = [...c.messages]
        .filter((m) => !m.isCommand && (m.author === "MEMBER" || m.author === "ASSISTANT" || m.author === "TEAM"))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, maxMsg)
        .map((m): SampleMessage => {
          const raw = m.text.trim() ? m.text : m.mediaKind ? `[${m.mediaKind}]` : "";
          return { who: m.direction === "IN" ? "personne" : "profil", text: clip(anonymizeText(raw, { names })) };
        })
        .filter((m) => m.text !== "");
      return { c, messages };
    })
    .filter((x) => x.messages.length > 0)
    .slice(0, maxConv)
    .map(({ c, messages }, i) => ({
      n: `c${i + 1}`,
      replied: c.replied,
      linkSent: c.offerSends > 0,
      converted: c.converted,
      stage: c.stage,
      messages,
    }));
}

function mediaKindOf(media: unknown): string | null {
  const k = media && typeof media === "object" ? (media as { kind?: unknown }).kind : null;
  return typeof k === "string" ? k : null;
}

/** Lit en base les conversations d'un profil sur la fenêtre et construit son échantillon. */
export async function loadProfileSample(
  prisma: AgentsPrisma,
  ref: ProfileRef,
  window: { start: Date; end: Date },
  personaName: string | null,
): Promise<SampleConversation[]> {
  // Marge : une partie des conversations lues sera exclue (mineur, /stop, aucun message).
  const convs = await prisma.conversation.findMany({
    where: {
      botId: ref.botId,
      personaId: ref.personaId,
      source: ref.source,
      createdAt: { gte: window.start, lt: window.end },
      isMinor: false,
      stoppedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: SAMPLE_MAX_CONVERSATIONS * 2,
    select: {
      id: true,
      memberId: true,
      createdAt: true,
      isMinor: true,
      stoppedAt: true,
      closedReason: true,
      stage: true,
      offerSends: true,
      convertedAt: true,
    },
  });
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const [events, messages, members] = await Promise.all([
    prisma.conversationEvent.findMany({
      where: { conversationId: { in: ids } },
      select: { conversationId: true, type: true, fromStage: true, toStage: true, createdAt: true },
    }),
    prisma.conversationMessage.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { conversationId: true, direction: true, author: true, text: true, meta: true, media: true, createdAt: true },
    }),
    prisma.member.findMany({
      where: { id: { in: [...new Set(convs.map((c) => c.memberId))] } },
      select: { id: true, firstName: true, lastName: true, username: true },
    }),
  ]);
  const memberOf = new Map(members.map((m) => [m.id, m]));
  return buildSample(
    convs.map((c) => {
      const evs: ProfileEventRow[] = events
        .filter((e) => e.conversationId === c.id)
        .map((e) => ({ ...e, fromStage: e.fromStage ? String(e.fromStage) : null, toStage: e.toStage ? String(e.toStage) : null }));
      const msgs = messages
        .filter((m) => m.conversationId === c.id)
        .map((m) => ({
          direction: m.direction === "IN" ? ("IN" as const) : ("OUT" as const),
          author: String(m.author),
          text: m.text,
          isCommand: Boolean(m.meta && typeof m.meta === "object" && (m.meta as { command?: unknown }).command != null),
          mediaKind: mediaKindOf(m.media),
          createdAt: m.createdAt,
        }));
      const flat: ProfileMessageRow[] = msgs.map((m) => ({ conversationId: c.id, ...m }));
      const member = memberOf.get(c.memberId);
      return {
        createdAt: c.createdAt,
        isMinor: c.isMinor,
        stoppedAt: c.stoppedAt,
        closedReason: c.closedReason,
        eventTypes: evs.map((e) => e.type),
        stage: String(c.stage),
        offerSends: c.offerSends,
        converted: c.convertedAt !== null,
        replied: hasReplied(flat, evs),
        names: [member?.firstName ?? null, member?.lastName ?? null, member?.username ?? null, personaName],
        messages: msgs,
      };
    }),
  );
}
