/**
 * Lecture de la boîte de réception (`/conversations`) : conversations triées par dernier message (le plus récent
 * d'abord), filtres (étape, qui répond, source, persona, non lues), pagination, compteurs des pastilles, choix des
 * filtres, et lignes de l'export CSV (sans aucun texte de conversation). Une seule requête SQL par liste : le dernier
 * message de chaque conversation est lu par une jointure latérale (index `conversationId, createdAt`).
 *
 * « Non lue » : le dernier message vient de la personne ET quelqu'un peut encore lui répondre. Une conversation
 * définitive (/stop, moins de 18 ans, bloquée par l'équipe : `isFinal`) n'est jamais « non lue » : la personne peut
 * continuer d'écrire, mais plus rien ne peut lui être envoyé et l'équipe ne pourrait jamais la sortir de la liste.
 */
import { Prisma, prisma, type ConversationStage, type ConversationStatus } from "@linkaffipro/db";
import { isAssistantTeamMember } from "@linkaffipro/telegram";
import { PAGE_SIZE, pageCount, pageSkip } from "@/components/admin/pagination";
import { loadAssistantConfig } from "@/lib/assistant/config";
import type { InboxFilters } from "./filters";
import { NONE_KEY } from "./labels";
import { replyBlock, type ReplyBlock } from "./reply-state";
import { isFinal } from "./rules";

/** Ligne de la boîte de réception. */
export type InboxRow = {
  id: string;
  createdAt: Date;
  stage: ConversationStage;
  status: ConversationStatus;
  source: string | null;
  personaId: string | null;
  personaName: string | null;
  personaGender: string | null;
  closedReason: string | null;
  stoppedAt: Date | null;
  isMinor: boolean;
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    anonymizedAt: Date | null;
  };
  last: {
    direction: "IN" | "OUT";
    author: "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM";
    text: string;
    media: unknown;
    meta: unknown;
    at: Date;
  } | null;
  /** Dernier message de la personne, sans réponse, dans une conversation qui n'est pas définitive (`isFinal`). */
  unread: boolean;
  /** Dernière activité (dernier message, sinon le début de la conversation). */
  activityAt: Date;
};

type RawRow = {
  id: string;
  createdAt: Date;
  stage: string;
  status: string;
  source: string | null;
  personaId: string | null;
  personaName: string | null;
  personaGender: string | null;
  closedReason: string | null;
  stoppedAt: Date | null;
  isMinor: boolean;
  memberId: string;
  memberTelegramId: string;
  botActive: boolean;
  botMode: string;
  personaActive: boolean | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  anonymizedAt: Date | null;
  lastDirection: string | null;
  lastAuthor: string | null;
  lastText: string | null;
  lastMedia: unknown;
  lastMeta: unknown;
  lastAt: Date | null;
};

/**
 * « Non lue » en SQL (sur `c` et `lm`) : dernier message de la personne, conversation pas définitive (même règle que
 * `isFinal` : ni /stop, ni mineur, ni bloquée par l'équipe). `IS DISTINCT FROM` : une raison vide ne retire rien.
 */
const UNREAD = Prisma.sql`(lm."direction" = 'IN' AND c."stoppedAt" IS NULL AND NOT c."isMinor"
  AND (c."status" <> 'CLOSED' OR c."closedReason" IS DISTINCT FROM 'TEAM'))`;

/** Conditions SQL des filtres (sur `c` : conversation, `lm` : dernier message). */
export function inboxWhere(f: InboxFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.stage) parts.push(Prisma.sql`c."stage"::text = ${f.stage}`);
  if (f.status) parts.push(Prisma.sql`c."status"::text = ${f.status}`);
  if (f.source === NONE_KEY) parts.push(Prisma.sql`c."source" IS NULL`);
  else if (f.source) parts.push(Prisma.sql`c."source" = ${f.source}`);
  if (f.persona === NONE_KEY) parts.push(Prisma.sql`c."personaId" IS NULL`);
  else if (f.persona) parts.push(Prisma.sql`c."personaId" = ${f.persona}`);
  if (f.unread) parts.push(UNREAD);
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

const FROM = Prisma.sql`
  FROM "Conversation" c
  JOIN "Member" m ON m."id" = c."memberId"
  JOIN "Bot" b ON b."id" = c."botId"
  LEFT JOIN "Persona" p ON p."id" = c."personaId"
  LEFT JOIN "Persona" bp ON bp."id" = b."personaId"
  LEFT JOIN LATERAL (
    SELECT x."direction", x."author", x."text", x."media", x."meta", x."createdAt"
      FROM "ConversationMessage" x
     WHERE x."conversationId" = c."id"
     ORDER BY x."createdAt" DESC, x."id" DESC
     LIMIT 1
  ) lm ON true`;

function toRow(r: RawRow): InboxRow {
  const last =
    r.lastAt && r.lastDirection && r.lastAuthor
      ? {
          direction: r.lastDirection as "IN" | "OUT",
          author: r.lastAuthor as "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM",
          text: r.lastText ?? "",
          media: r.lastMedia,
          meta: r.lastMeta,
          at: new Date(r.lastAt),
        }
      : null;
  return {
    id: r.id,
    createdAt: new Date(r.createdAt),
    stage: r.stage as ConversationStage,
    status: r.status as ConversationStatus,
    source: r.source,
    personaId: r.personaId,
    personaName: r.personaName,
    personaGender: r.personaGender,
    closedReason: r.closedReason,
    stoppedAt: r.stoppedAt ? new Date(r.stoppedAt) : null,
    isMinor: Boolean(r.isMinor),
    member: {
      id: r.memberId,
      firstName: r.firstName,
      lastName: r.lastName,
      username: r.username,
      anonymizedAt: r.anonymizedAt ? new Date(r.anonymizedAt) : null,
    },
    last,
    unread:
      last?.direction === "IN" &&
      !isFinal({
        status: r.status as ConversationStatus,
        stoppedAt: r.stoppedAt,
        isMinor: Boolean(r.isMinor),
        closedReason: r.closedReason,
      }),
    activityAt: last?.at ?? new Date(r.createdAt),
  };
}

const SELECT = Prisma.sql`
  SELECT c."id", c."createdAt", c."stage"::text AS "stage", c."status"::text AS "status", c."source",
         c."personaId", p."name" AS "personaName", p."gender" AS "personaGender", c."closedReason",
         c."stoppedAt", c."isMinor",
         m."id" AS "memberId", m."telegramUserId"::text AS "memberTelegramId", m."firstName", m."lastName",
         m."username", m."anonymizedAt",
         b."isActive" AS "botActive", b."mode"::text AS "botMode",
         COALESCE(p."isActive", bp."isActive") AS "personaActive",
         lm."direction"::text AS "lastDirection", lm."author"::text AS "lastAuthor", lm."text" AS "lastText",
         lm."media" AS "lastMedia", lm."meta" AS "lastMeta", lm."createdAt" AS "lastAt"`;

const ORDER = Prisma.sql`ORDER BY COALESCE(lm."createdAt", c."createdAt") DESC, c."id" DESC`;

/** Ligne affichée de la boîte de réception : avec « l'assistante répondra-t-elle à cette personne ? ». */
export type InboxListRow = InboxRow & {
  /** Pourquoi personne ne répondrait si la conversation est laissée à l'assistante (`reply-state.ts`) ; null : elle répond. */
  replyBlock: ReplyBlock | null;
};

/**
 * Qui répond vraiment, ligne par ligne (même règle que le webhook) : activation, bot actif et en mode assistant, persona
 * de la conversation (sinon du bot) active, et pour l'essai « Seulement l'équipe », le compte de l'équipe (cherché pour
 * les seules personnes de la page).
 */
async function withReplyBlocks(raw: RawRow[]): Promise<InboxListRow[]> {
  const { activation } = await loadAssistantConfig();
  const team = new Set<string>();
  if (activation === "team") {
    const ids = [...new Set(raw.map((r) => r.memberTelegramId))];
    const checks = await Promise.all(
      ids.map(async (id) => [id, await isAssistantTeamMember(BigInt(id))] as const),
    );
    for (const [id, ok] of checks) if (ok) team.add(id);
  }
  return raw.map((r) => ({
    ...toRow(r),
    replyBlock: replyBlock({
      activation,
      botActive: Boolean(r.botActive),
      botMode: r.botMode,
      personaActive: r.personaActive === null ? null : Boolean(r.personaActive),
      isTeamMember: team.has(r.memberTelegramId),
    }),
  }));
}

/** Une page de la boîte de réception (50 conversations), triée par dernier message. */
export async function listConversations(
  f: InboxFilters,
  opts: { pageSize?: number } = {},
): Promise<{ rows: InboxListRow[]; total: number; pages: number; page: number }> {
  const size = opts.pageSize ?? PAGE_SIZE;
  const where = inboxWhere(f);
  const [countRows, raw] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint | number }>>`SELECT COUNT(*) AS "n" ${FROM} ${where}`,
    prisma.$queryRaw<RawRow[]>`${SELECT} ${FROM} ${where} ${ORDER}
      LIMIT ${size} OFFSET ${pageSkip(f.page, size)}`,
  ]);
  const total = Number(countRows[0]?.n ?? 0);
  const pages = pageCount(total, size);
  return { rows: await withReplyBlocks(raw), total, pages, page: Math.min(f.page, pages) };
}

/**
 * Compteurs des pastilles : conversations non lues (hors conversations définitives) et conversations où l'équipe a la
 * main (toutes, sans filtre).
 */
export async function inboxCounts(): Promise<{ all: number; unread: number; human: number }> {
  const rows = await prisma.$queryRaw<Array<{ all: bigint; unread: bigint; human: bigint }>>`
    SELECT COUNT(*) AS "all",
           COUNT(*) FILTER (WHERE ${UNREAD}) AS "unread",
           COUNT(*) FILTER (WHERE c."status" = 'HUMAN') AS "human"
    ${FROM}`;
  const r = rows[0];
  return { all: Number(r?.all ?? 0), unread: Number(r?.unread ?? 0), human: Number(r?.human ?? 0) };
}

export type InboxOptions = {
  personas: Array<{ id: string; name: string }>;
  sources: string[];
  /** Au moins une conversation sans source / sans persona. */
  hasNoSource: boolean;
  hasNoPersona: boolean;
};

/** Choix des filtres Persona et Source (personas existantes, sources déjà vues, 200 au plus). */
export async function loadInboxOptions(): Promise<InboxOptions> {
  const [personas, sources, noSource, noPersona] = await Promise.all([
    prisma.persona.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.conversation.findMany({
      where: { source: { not: null } },
      distinct: ["source"],
      select: { source: true },
      orderBy: { source: "asc" },
      take: 200,
    }),
    prisma.conversation.count({ where: { source: null } }),
    prisma.conversation.count({ where: { personaId: null } }),
  ]);
  return {
    personas,
    sources: sources.map((s) => s.source).filter((s): s is string => Boolean(s)),
    hasNoSource: noSource > 0,
    hasNoPersona: noPersona > 0,
  };
}

/** Ligne de l'export CSV d'une conversation (aucun texte de la conversation). */
export type InboxExportRow = InboxRow & {
  botUsername: string;
  language: string | null;
  memberMessages: number;
  linksSent: number;
  linksOpened: number;
  registeredAt: Date | null;
  ftdAt: Date | null;
  costEur: number;
};

/** Toutes les conversations de la liste filtrée (5 000 au plus) avec leurs chiffres, pour l'export CSV. */
export async function exportConversations(
  f: InboxFilters,
  limit = 5000,
): Promise<InboxExportRow[]> {
  const raw = await prisma.$queryRaw<
    RawRow[]
  >`${SELECT} ${FROM} ${inboxWhere(f)} ${ORDER} LIMIT ${limit}`;
  const rows = raw.map(toRow);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [convs, links, costs, players] = await Promise.all([
    prisma.conversation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        language: true,
        memberMessages: true,
        bot: { select: { username: true } },
      },
    }),
    prisma.assistantOfferLink.findMany({
      where: { conversationId: { in: ids } },
      select: { conversationId: true, firstOpenedAt: true },
    }),
    prisma.aiConversationUsage.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: ids }, purpose: { not: "TEST" } },
      _sum: { costEur: true },
    }),
    prisma.player.findMany({
      where: { click: { conversationId: { in: ids } } },
      select: { registeredAt: true, ftdAt: true, click: { select: { conversationId: true } } },
    }),
  ]);
  const conv = new Map(convs.map((c) => [c.id, c]));
  const sent = new Map<string, number>();
  const opened = new Map<string, number>();
  for (const l of links) {
    if (!l.conversationId) continue;
    sent.set(l.conversationId, (sent.get(l.conversationId) ?? 0) + 1);
    if (l.firstOpenedAt) opened.set(l.conversationId, (opened.get(l.conversationId) ?? 0) + 1);
  }
  const cost = new Map(costs.map((c) => [c.conversationId ?? "", Number(c._sum.costEur ?? 0)]));
  const reg = new Map<string, Date>();
  const ftd = new Map<string, Date>();
  const earliest = (map: Map<string, Date>, id: string, d: Date | null) => {
    if (!d) return;
    const cur = map.get(id);
    if (!cur || d < cur) map.set(id, d);
  };
  for (const p of players) {
    const id = p.click?.conversationId;
    if (!id) continue;
    earliest(reg, id, p.registeredAt);
    earliest(ftd, id, p.ftdAt);
  }
  return rows.map((r) => {
    const c = conv.get(r.id);
    return {
      ...r,
      botUsername: c?.bot.username ?? "",
      language: c?.language ?? null,
      memberMessages: c?.memberMessages ?? 0,
      linksSent: sent.get(r.id) ?? 0,
      linksOpened: opened.get(r.id) ?? 0,
      registeredAt: reg.get(r.id) ?? null,
      ftdAt: ftd.get(r.id) ?? null,
      costEur: Math.round((cost.get(r.id) ?? 0) * 10_000) / 10_000,
    };
  });
}
