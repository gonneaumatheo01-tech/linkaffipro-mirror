/**
 * Lecture en base des chiffres de l'assistant de conversation (`/conversations/stats`) pour une période (jours de
 * Paris, `lib/periods.ts`). Définitions et calcul : `stats.ts`. Les inscriptions et premiers dépôts sont ceux des
 * joueurs rattachés au clic d'un lien de l'offre envoyé par l'assistant (règle « nos joueurs » de `ourPlayers`), aux
 * dates réelles de Link Affi (`registeredAt`, `ftdAt`), comme les autres Statistiques. Persona et source d'un joueur :
 * celles de sa conversation, sinon celles copiées sur le lien de l'offre (conversation supprimée depuis). Coût de
 * l'IA : persona et source copiées sur chaque coût enregistré (`costsBetween`).
 */
import { Prisma, ourPlayers, prisma, type ConversationStage } from "@linkaffipro/db";
import { periodEnd, periodStart, type Period } from "@/lib/periods";
import type { ConversationUniverse } from "./labels";
import {
  aggregateConversationStats,
  type ConversationStats,
  type StatsConversation,
  type StatsCost,
  type StatsKeyed,
  type StatsPlayer,
} from "./stats";

/** Étapes qui supposent une réponse de la personne (le premier message de l'assistante laisse « Accueil »). */
const REPLY_STAGES = ["CHAT", "PROPOSAL", "LINK_SENT", "FOLLOW_UP", "CONVERTED"];

type ConversationRaw = {
  personaId: string | null;
  source: string | null;
  stage: string;
  replied: boolean;
  reached: string[] | null;
  converted: boolean;
  needsHuman: boolean;
};

/**
 * Conversations commencées entre `start` (inclus) et `end` (exclu), avec « la personne a répondu » : un message de la
 * personne (hors commande) après le premier message de l'assistante ou de l'équipe, ou une étape qui l'implique (le
 * fil peut avoir été effacé par /reset ; les passages d'étape restent), et « inscrite » : une inscription rattachée
 * (`convertedAt`), même arrivée pendant que la conversation était fermée (aucun passage d'étape n'est alors écrit).
 */
async function conversationsBetween(start: Date, end: Date): Promise<StatsConversation[]> {
  const rows = await prisma.$queryRaw<ConversationRaw[]>`
    SELECT c."personaId", c."source", c."stage"::text AS "stage",
           (
             EXISTS (
               SELECT 1 FROM "ConversationMessage" mi
                WHERE mi."conversationId" = c."id" AND mi."direction" = 'IN' AND mi."author" = 'MEMBER'
                  AND (mi."meta" ->> 'command') IS NULL
                  AND mi."createdAt" > (
                    SELECT MIN(mo."createdAt") FROM "ConversationMessage" mo
                     WHERE mo."conversationId" = c."id" AND mo."direction" = 'OUT'
                       AND mo."author" IN ('ASSISTANT', 'TEAM')
                  )
             )
             OR EXISTS (
               SELECT 1 FROM "ConversationEvent" e
                WHERE e."conversationId" = c."id" AND e."type" = 'stage_changed'
                  AND e."toStage"::text IN (${Prisma.join(REPLY_STAGES)})
             )
           ) AS "replied",
           ARRAY(
             SELECT DISTINCT e2."toStage"::text FROM "ConversationEvent" e2
              WHERE e2."conversationId" = c."id" AND e2."type" = 'stage_changed' AND e2."toStage" IS NOT NULL
           ) AS "reached",
           (c."convertedAt" IS NOT NULL) AS "converted",
           (c."needsHumanAt" IS NOT NULL) AS "needsHuman"
      FROM "Conversation" c
     WHERE c."createdAt" >= ${start} AND c."createdAt" < ${end}`;
  return rows.map((r) => ({
    personaId: r.personaId,
    source: r.source,
    stage: r.stage as ConversationStage,
    replied: Boolean(r.replied),
    reached: (r.reached ?? []) as ConversationStage[],
    converted: Boolean(r.converted),
    needsHuman: Boolean(r.needsHuman),
  }));
}

/** Liens de l'offre envoyés (`sentAt`) ou ouverts pour la première fois (`firstOpenedAt`) dans la période. */
async function offerLinksBetween(
  field: "sentAt" | "firstOpenedAt",
  start: Date,
  end: Date,
): Promise<StatsKeyed[]> {
  const rows = await prisma.assistantOfferLink.findMany({
    where: { [field]: { gte: start, lt: end } },
    select: {
      personaId: true,
      source: true,
      conversation: { select: { personaId: true, source: true } },
    },
  });
  return rows.map((r) => ({
    personaId: r.conversation?.personaId ?? r.personaId,
    source: r.conversation ? r.conversation.source : r.source,
  }));
}

/** Joueurs inscrits ou au premier dépôt dans la période, rattachés au clic d'un lien de l'offre de l'assistante. */
async function playersBetween(start: Date, end: Date): Promise<StatsPlayer[]> {
  const ours = await ourPlayers();
  const rows = await prisma.player.findMany({
    where: {
      AND: [
        ours,
        {
          click: {
            OR: [{ conversationId: { not: null } }, { assistantOffer: { isNot: null } }],
          },
        },
        {
          OR: [{ registeredAt: { gte: start, lt: end } }, { ftdAt: { gte: start, lt: end } }],
        },
      ],
    },
    select: {
      registeredAt: true,
      ftdAt: true,
      click: {
        select: {
          conversation: { select: { personaId: true, source: true } },
          assistantOffer: { select: { personaId: true, source: true } },
        },
      },
    },
  });
  const inPeriod = (d: Date | null) => Boolean(d && d >= start && d < end);
  return rows.map((p) => {
    const conv = p.click?.conversation ?? null;
    const offer = p.click?.assistantOffer ?? null;
    return {
      personaId: conv?.personaId ?? offer?.personaId ?? null,
      source: conv ? conv.source : (offer?.source ?? null),
      registered: inPeriod(p.registeredAt),
      ftd: inPeriod(p.ftdAt),
    };
  });
}

/**
 * Coût de l'IA de la période (hors « Tester »), par persona et par source : la persona et la source copiées sur chaque
 * coût enregistré (`AiConversationUsage.personaId` / `source`), jamais relues sur la conversation (elle peut avoir été
 * supprimée depuis, à la demande de la personne : son coût reste compté avec sa source).
 */
export async function costsBetween(start: Date, end: Date): Promise<StatsCost[]> {
  const groups = await prisma.aiConversationUsage.groupBy({
    by: ["personaId", "source"],
    where: { createdAt: { gte: start, lt: end }, purpose: { not: "TEST" } },
    _sum: { costEur: true },
  });
  return groups.map((g) => ({
    personaId: g.personaId ?? null,
    source: g.source ?? null,
    costEur: Number(g._sum.costEur ?? 0),
  }));
}

/**
 * Tous les chiffres de la période (total, par univers, par persona, par source, parcours) ; `universe` : seulement
 * les personas de cet univers (Rencontres, Casino, Paris sportifs).
 */
export async function loadConversationStats(
  period: Period,
  opts: { universe?: ConversationUniverse | "" } = {},
): Promise<ConversationStats> {
  const start = periodStart(period);
  const end = periodEnd(period);
  const [conversations, linksSent, linksOpened, players, costs, personas] = await Promise.all([
    conversationsBetween(start, end),
    offerLinksBetween("sentAt", start, end),
    offerLinksBetween("firstOpenedAt", start, end),
    playersBetween(start, end),
    costsBetween(start, end),
    prisma.persona.findMany({ select: { id: true, name: true, universe: true } }),
  ]);
  return aggregateConversationStats(
    {
      conversations,
      linksSent,
      linksOpened,
      players,
      costs,
      personaNames: Object.fromEntries(personas.map((p) => [p.id, p.name])),
      personaUniverses: Object.fromEntries(personas.map((p) => [p.id, p.universe])),
    },
    opts,
  );
}

/** Au moins une conversation a-t-elle déjà eu lieu (sinon la page explique comment démarrer) ? */
export async function hasAnyConversation(): Promise<boolean> {
  return (await prisma.conversation.findFirst({ select: { id: true } })) !== null;
}
